# Scripts

Helper shell scripts that ship vendored with VoidSpark so a fresh clone runs
without any of the author's machine-specific `~/.agents` tooling. The app calls
these directly (see `lib/codexLauncher.ts` and the monitor routes); you rarely
run them by hand.

All four are macOS `bash 3.2` / BSD-userland compatible.

## Agent launch

### `launch_agent.sh`
Launches an arbitrary coding agent in a **detached tmux session**.

```
launch_agent.sh <session-name> <agent-cmd> "<prompt>" ["<post-cmd>"]
```

- `<agent-cmd>` — the runner invocation *without* the prompt, e.g.
  `claude-minimax-free -p` or
  `codex exec -m gpt-5.4-mini --dangerously-bypass-approvals-and-sandbox`.
  The prompt is appended as a final quoted positional argument.
- `<post-cmd>` — optional shell run *after* the agent exits, on the same line
  (e.g. a `curl` to a done endpoint + `tmux kill-session`). Only meaningful for
  a headless agent that actually exits; omit it for interactive REPL agents.

Long prompts are written to a temp file and typed via a short `cat` indirection
so terminal bracketed-paste behaviour can't corrupt them. Overridable with the
`AGENT_LAUNCHER` env var.

### `agent_with_fallback.sh`
Runs a primary agent and, the instant it hits a rate-limit / out-of-tokens
condition, **kills it and re-runs the same prompt with a fallback** agent.

```
agent_with_fallback.sh "<primary cmd>" "<fallback cmd>" "<prompt>"
```

Used to fall MiniMax → Codex on a 429 without waiting out MiniMax's ~6 min of
internal retries. Output streams live to stdout (the tmux pane / log viewer
tails it). Exit code is the fallback's if it fell back, else the primary's.
Overridable with `AGENT_FALLBACK_SCRIPT`.

## Monitor watchdog

These back the cockpit's Monitor panel (the persistent `lab-monitor` agent).

### `monitor_loop.sh`
Persistent, read-only watchdog. Every `INTERVAL` seconds it runs the MiniMax
agent against `autoresearch/monitor-prompt.md` and atomically refreshes
`autoresearch/monitor-summary.md`, which the Monitor panel reads.

```
monitor_loop.sh <repo-dir> [interval-seconds]   # default 60s
```

Runs in an attachable tmux pane — `tmux attach -t lab-monitor` to watch it tick.
Read-only by contract: the prompt tells the agent to observe (curl `/api/health`,
`tmux ls`) and never mutate.

### `monitor_beat.sh`
Heartbeat for the *interactive* monitor agent. Every `INTERVAL` seconds it types
an auto-refresh request into a running `cmf` session so it re-checks the system
and posts a fresh summary without you asking. Exits on its own once the target
session is gone.

```
monitor_beat.sh <target-session> [interval-seconds]   # default 180s
```
