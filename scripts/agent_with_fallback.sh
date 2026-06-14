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
# macOS bash 3.2 / BSD grep compatible: no setsid (tree-kill via pgrep -P), and
# the marker regex uses NO `{n,m}` intervals (BSD grep caps them and errors out,
# which would silently disable detection).
set -uo pipefail

PRIMARY="${1:?usage: agent_with_fallback.sh <primary> <fallback> <prompt>}"
FALLBACK="${2:?fallback cmd required}"
PROMPT="${3:?prompt required}"

# Markers that mean "MiniMax is out of tokens / rate-limited", matched live
# against the streaming output. The real signature (from a 429) is a stream-json
# line like {... "error_status":429,"error":"rate_limit" ...} plus the Token Plan
# exhaustion message. Specific enough that a normal research transcript won't
# trip it. Override via env. NO interval quantifiers (BSD grep limitation).
MARKERS="${MINIMAX_FALLBACK_REGEX:-rate_limit|error_status[^0-9]*429|用量上限|Token Plan|insufficient_balance|insufficient_quota|insufficient balance|insufficient quota|out of tokens|out of credit}"

# Kill a pid and all its descendants (pgrep -P walks the tree). $2 = signal.
kill_tree() {
  local pid="$1" sig="${2:-TERM}" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child" "$sig"
  done
  kill -"$sig" "$pid" 2>/dev/null || true
}

# Run "<cmd> <prompt>" in the foreground. The prompt is passed as a real
# positional arg ($1) to an inner bash -c, never string-interpolated, so a
# prompt containing quotes/$/backticks can't break parsing. Any redirect baked
# into <cmd> (e.g. `< /dev/null`) is parsed by that inner bash.
run_agent() {
  bash -c "$1"' "$1"' _ "$2"
}

# NOTE: trailing-X templates ONLY. BSD mktemp (macOS /usr/bin/mktemp) does NOT
# randomize when a suffix follows the X's — `mktemp foo.XXXXXX.log` creates a
# LITERAL file `foo.XXXXXX.log`, so the 2nd concurrent worker dies "File exists"
# and $LOG ends up empty, collapsing the whole wrapper. Orchestrate fans workers
# out in parallel, so that broke every gate but one. Keep the X's at the end.
LOG="$(mktemp "${TMPDIR:-/tmp}/agent_fallback.XXXXXX")"
RCFILE="$(mktemp "${TMPDIR:-/tmp}/agent_fallback.XXXXXX")"
cleanup() { rm -f "$LOG" "$RCFILE" 2>/dev/null || true; }
trap cleanup EXIT

# Launch primary in the background, recording its exit code to RCFILE so we never
# need `wait` (which would force us to keep the job, and print a "Terminated"
# notice when we kill it). disown silences that notice; kill-by-pid still works.
( run_agent "$PRIMARY" "$PROMPT"; echo "$?" >"$RCFILE" ) >"$LOG" 2>&1 &
PRIMARY_PID=$!
disown 2>/dev/null || true

# Mirror the log to our stdout (pane/UI) in real time; disown so killing the
# tailer at the end is silent too.
tail -n +1 -f "$LOG" 2>/dev/null &
TAIL_PID=$!
disown 2>/dev/null || true

FELL_BACK=0
RC=0
# Poll while primary is alive: a marker hit means abort the retry loop NOW.
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

# Exited on its own: read the recorded code; non-zero (or missing) -> fall back.
if [ "$FELL_BACK" -eq 0 ]; then
  for _ in 1 2 3 4 5; do [ -s "$RCFILE" ] && break; sleep 0.2; done
  RC="$(cat "$RCFILE" 2>/dev/null || echo 1)"
  case "$RC" in ''|*[!0-9]*) RC=1 ;; esac
  if [ "$RC" -ne 0 ]; then
    printf '\n[voidspark] MiniMax exited rc=%s — falling back to Codex\n' "$RC"
    FELL_BACK=1
  fi
fi

# Stop mirroring before the fallback takes over stdout.
sleep 0.3
kill "$TAIL_PID" 2>/dev/null || true

if [ "$FELL_BACK" -eq 1 ]; then
  run_agent "$FALLBACK" "$PROMPT"
  RC=$?
fi

exit "$RC"
