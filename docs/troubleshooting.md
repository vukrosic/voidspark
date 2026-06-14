# Troubleshooting

Common snags when running VoidSpark on a fresh machine, and how to clear them.

## "No project selected" / onboarding card won't go away

The registry is empty. Add your repo's absolute path in the onboarding card, or
set `VOIDSPARK_TARGET_REPO` in `.env.local`. The path must be an existing
directory — VoidSpark validates it before saving.

## Agents don't launch

- **`tmux` not found** — agents run in detached tmux sessions. Install tmux and
  make sure it's on `PATH`.
- **No agent CLI** — one of `claude`, `codex`, or `claude-minimax-free` must be
  on `PATH`. Check with `which codex` (or your runner).
- **Wrong launcher** — by default the vendored `scripts/launch_agent.sh` is used.
  Only set `AGENT_LAUNCHER` if you keep your own.
- Watch a launch live: `tmux ls`, then `tmux attach -t <session>`.

## Runs stay in "Queued · GPU" and never start

The **GPU drainer** isn't running — nothing is SSHing to the box to pick up the
queue. Turn the GPU drainer on, or enable Autoresearch (which owns it). See
[Configuration](configuration.md).

## "cannot reach the GPU box" / Test fails

- The instance is down, or the SSH command is stale — re-paste the current one in
  **Settings → GPU box**.
- Your SSH key isn't authorized on the box. The poller uses `BatchMode` (no
  password prompts), so key auth is required. See [GPU box](gpu-box.md).

## MiniMax keeps falling back to Codex

MiniMax ran out of tokens for the 5-hour window (it 429s). This is expected — the
launcher kills it and re-runs on Codex automatically. The **MiniMax** chip in the
health bar shows remaining quota and when the window resets.

## The MiniMax option / quota chip is missing

That's intentional: MiniMax UI only appears when `MINIMAX_API_KEY` is set and the
key works. Without it, Codex is the runner.

## Nothing shows in Analytics

Analytics replays each idea's `log.jsonl`. A brand-new repo has no transitions
yet — run the loop and stage timings, verdicts, and the win rate appear once
ideas start flipping through statuses.

## Still stuck?

The **Monitor** panel runs a read-only watchdog that summarizes loop health every
minute (dead panes, idle GPU, throughput, quota). It's the fastest way to see
what the loop is — or isn't — doing.
