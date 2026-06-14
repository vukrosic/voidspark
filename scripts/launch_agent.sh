#!/usr/bin/env bash
# Launch an arbitrary coding agent in a detached tmux session.
# Usage: launch_agent.sh <session-name> <agent-cmd> "<prompt>" ["<post-cmd>"]
#   <agent-cmd>  the runner invocation WITHOUT the prompt, e.g.
#                  "codex -m gpt-5.4-mini --dangerously-bypass-approvals-and-sandbox"
#                  "codex exec -m ... --dangerously-bypass-approvals-and-sandbox"
#                  "claude-minimax-free"   /   "claude-minimax-free -p"
#                The prompt is appended as a final quoted positional argument.
#   <post-cmd>   optional shell run AFTER the agent exits, on the same line:
#                  <agent-cmd> "<prompt>" ; <post-cmd>
#                Only useful with a headless agent that actually exits (e.g.
#                a curl to a done endpoint + `tmux kill-session`). Omit/empty
#                for interactive agents that stay in their REPL.
#
# Generalised sibling of launch_codex.sh so the UI can launch codex, minimax,
# or any other agent without the runner being hardcoded.
#
# Robustness notes (same as launch_codex.sh):
#  - Long prompts sent via `send-keys -l` can trigger terminal bracketed-paste
#    behavior, so we write the prompt to a temp file and type only a short
#    command that reads it at runtime.
#  - Enter must be a SEPARATE send-keys call.
set -euo pipefail

NAME="${1:?usage: launch_agent.sh <session-name> <agent-cmd> \"<prompt>\" [\"<post-cmd>\"]}"
AGENT_CMD="${2:?agent command required}"
PROMPT="${3:?prompt required}"
POST_CMD="${4:-}"
START_DIR="${PWD}"

rm -f /tmp/agent_prompt_"${NAME}".*.txt 2>/dev/null || true
PROMPT_FILE="$(mktemp "/tmp/agent_prompt_${NAME}.XXXXXX.txt")"
printf '%s' "$PROMPT" > "$PROMPT_FILE"

tmux kill-session -t "$NAME" 2>/dev/null || true
tmux new-session -d -s "$NAME" -x 200 -y 50 -c "$START_DIR"
sleep 1

# Keep the typed command short; the shell expands $(cat ...) at submit time.
# When a post-cmd is given, chain it after the agent on the same line so it runs
# once the (headless) agent process exits: <agent> "<prompt>" ; <post-cmd>
if [ -n "$POST_CMD" ]; then
  tmux send-keys -t "$NAME" -l "${AGENT_CMD} \"\$(cat $PROMPT_FILE)\" ; ${POST_CMD}"
else
  tmux send-keys -t "$NAME" -l "${AGENT_CMD} \"\$(cat $PROMPT_FILE)\""
fi
sleep 0.6
tmux send-keys -t "$NAME" Enter

echo "launched agent session '$NAME' (cmd: ${AGENT_CMD}; prompt: $PROMPT_FILE)"
echo "tail:  tmux capture-pane -t $NAME -p | grep -v '^[[:space:]]*\$' | tail"
echo "kill:  tmux kill-session -t $NAME"
