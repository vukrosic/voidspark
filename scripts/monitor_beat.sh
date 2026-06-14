#!/usr/bin/env bash
# monitor_beat.sh — heartbeat for the interactive monitor agent.
#
# Every INTERVAL seconds it types an "auto-refresh" request into the interactive
# cmf session (TARGET), so the agent re-checks the system and posts a fresh
# summary into the chat without the user having to ask. Exits on its own once the
# target session is gone. Keep INTERVAL comfortably longer than a summary takes,
# so nudges don't pile up while the agent is still answering.
#
# Usage: monitor_beat.sh <target-session> [interval-seconds]
set -uo pipefail

TARGET="${1:?usage: monitor_beat.sh <target-session> [interval]}"
INTERVAL="${2:-180}"
NUDGE="Auto-refresh: re-run the read-only checks (curl /api/health/, curl -X POST /api/gpu-usage/, tmux ls) and the issue checklist, then post a fresh one-screen status summary."

echo "[beat] nudging $TARGET every ${INTERVAL}s — started $(date -u +%FT%TZ)"
while true; do
  sleep "$INTERVAL"
  tmux has-session -t "$TARGET" 2>/dev/null || { echo "[beat] $TARGET gone — exiting"; exit 0; }
  tmux send-keys -t "$TARGET" -l "$NUDGE"
  tmux send-keys -t "$TARGET" Enter
  echo "[beat] nudged $TARGET at $(date -u +%FT%TZ)"
done
