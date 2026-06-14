#!/usr/bin/env bash
# Run a primary coding agent (MiniMax) and, the moment it hits a rate-limit /
# out-of-tokens condition, KILL it and re-run the same prompt with a fallback
# agent (Codex). Without this, MiniMax retries the 429 up to 10x with ~35s
# delays (`api_retry` ... `max_retries:10`), hanging the tmux pane for ~6min
# before it ever exits — far too late for an after-exit fallback to help.
#
# Usage: agent_with_fallback.sh "<primary cmd>" "<fallback cmd>" "<prompt>"
#   <primary cmd> / <fallback cmd>  full headless invocations WITHOUT the prompt
#     (the prompt is appended as a single positional arg at run time, so any
#     embedded redirect like `< /dev/null` still applies). e.g.
#       "claude-minimax-free -p --output-format stream-json --verbose < /dev/null"
#       "codex exec -m gpt-5.4-mini --dangerously-bypass-approvals-and-sandbox"
#
# Output streams live to stdout (the tmux pane / UI log viewer tails it).
# Exit code is the fallback's if we fell back, else the primary's.
#
# macOS bash 3.2 compatible; no setsid (absent on Darwin) — we tree-kill via
# pgrep -P instead.
set -uo pipefail

PRIMARY="${1:?usage: agent_with_fallback.sh <primary> <fallback> <prompt>}"
FALLBACK="${2:?fallback cmd required}"
PROMPT="${3:?prompt required}"

# Markers that mean "MiniMax is out of tokens / rate-limited" — matched live
# against the primary's streaming output. Targets the rate_limit retry events
# and the Token Plan exhaustion message specifically, so a normal research
# transcript that merely mentions "limit" doesn't trip it. Override via env.
MARKERS="${MINIMAX_FALLBACK_REGEX:-error_status[^0-9]{0,4}429|\"error\"[^a-z]{0,4}rate_limit|rate_limit_error|用量上限|Token Plan 套餐|insufficient[^a-z]{0,15}(balance|quota|credit|token)|out of (tokens|credit)}"

# Kill a pid and all its descendants (pgrep -P walks the tree). $2 = signal.
kill_tree() {
  local pid="$1" sig="${2:-TERM}" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child" "$sig"
  done
  kill -"$sig" "$pid" 2>/dev/null || true
}

# Run "<cmd> <prompt>" in the current shell. The prompt is passed as a real
# positional arg ($1) to an inner bash -c, never string-interpolated, so a
# prompt containing quotes/$/backticks can't break parsing. Any redirect baked
# into <cmd> (e.g. `< /dev/null`) is parsed by that inner bash.
run_agent() {
  bash -c "$1"' "$1"' _ "$2"
}

LOG="$(mktemp "/tmp/agent_fallback.XXXXXX.log")"
cleanup() { rm -f "$LOG" 2>/dev/null || true; }
trap cleanup EXIT

# Launch primary in the background, capturing combined output to LOG.
run_agent "$PRIMARY" "$PROMPT" >"$LOG" 2>&1 &
PRIMARY_PID=$!

# Mirror the log to our stdout (pane/UI) in real time.
tail -n +1 -f "$LOG" 2>/dev/null &
TAIL_PID=$!

FELL_BACK=0
RC=0
# Poll while primary is alive: a marker hit means abort the retry loop now.
while kill -0 "$PRIMARY_PID" 2>/dev/null; do
  if grep -qiE "$MARKERS" "$LOG"; then
    printf '\n[voidspark] MiniMax rate-limited / out of tokens — aborting retries, falling back to Codex\n'
    kill_tree "$PRIMARY_PID" TERM
    sleep 1
    kill_tree "$PRIMARY_PID" KILL
    FELL_BACK=1
    break
  fi
  sleep 1
done

# If it exited on its own, a non-zero code also triggers fallback.
if [ "$FELL_BACK" -eq 0 ]; then
  wait "$PRIMARY_PID"; RC=$?
  if [ "$RC" -ne 0 ]; then
    printf '\n[voidspark] MiniMax exited rc=%s — falling back to Codex\n' "$RC"
    FELL_BACK=1
  fi
fi

# Stop mirroring the primary's log before the fallback takes over stdout.
sleep 0.3
kill "$TAIL_PID" 2>/dev/null || true

if [ "$FELL_BACK" -eq 1 ]; then
  run_agent "$FALLBACK" "$PROMPT"
  RC=$?
fi

exit "$RC"
