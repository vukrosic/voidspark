#!/usr/bin/env bash
# monitor_loop.sh — persistent ResearchLoop watchdog agent.
#
# Every INTERVAL seconds it runs the MiniMax agent against the monitor prompt
# (autoresearch/monitor-prompt.md) and atomically refreshes the summary file the
# cockpit's Monitor panel reads (autoresearch/monitor-summary.md). The agent runs
# in headless print mode but the loop lives in a normal, attachable tmux pane —
# `tmux attach -t lab-monitor` to watch it tick. Read-only by contract: the
# prompt tells the agent to observe (curl /api/health, tmux ls) and never mutate.
#
# Usage: monitor_loop.sh <repo-dir> [interval-seconds]
set -uo pipefail

REPO="${1:?usage: monitor_loop.sh <repo-dir> [interval]}"
INTERVAL="${2:-60}"
PROMPT="$REPO/autoresearch/monitor-prompt.md"
OUT="$REPO/autoresearch/monitor-summary.md"

cd "$REPO" || { echo "[monitor] cannot cd $REPO"; exit 1; }
echo "[monitor] watching $REPO every ${INTERVAL}s — started $(date -u +%FT%TZ)"

while true; do
  if [ -f "$PROMPT" ]; then
    echo "[monitor] refresh $(date -u +%FT%TZ) …"
    # Print mode (`-p`) emits the agent's final summary text to stdout; </dev/null
    # gives an immediate stdin EOF. Write to a temp file and only swap it in on a
    # non-empty success, so a failed/rate-limited tick keeps the last good summary.
    if claude-minimax-free -p "$(cat "$PROMPT")" < /dev/null > "$OUT.tmp" 2>/dev/null && [ -s "$OUT.tmp" ]; then
      mv "$OUT.tmp" "$OUT"
      echo "[monitor] summary updated ($(wc -l < "$OUT" | tr -d ' ') lines)"
    else
      rm -f "$OUT.tmp"
      echo "[monitor] refresh failed (agent error/empty) — kept previous summary"
    fi
  else
    echo "[monitor] no prompt at $PROMPT — waiting"
  fi
  sleep "$INTERVAL"
done
