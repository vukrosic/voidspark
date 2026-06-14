# Configuration

Almost everything is configurable from the UI — you only need a `.env.local` if
you want to seed things up front. Order of precedence: UI/registry settings win;
env vars are just the initial seed.

## Environment (`.env.local`)

Copy `.env.local.example` and fill in what you need. All keys are optional.

| Variable | Purpose |
|---|---|
| `VOIDSPARK_TARGET_REPO` | Absolute path to the repo to drive. Seeds the project registry on first run. |
| *(your agent's key)* | VoidSpark needs none. If your agent CLI reads a key from the env (e.g. Claude → `ANTHROPIC_API_KEY`), set it here and it's passed through. |
| `MINIMAX_API_KEY` | Enables MiniMax as a runner and its quota readout. Without it, MiniMax UI is hidden. |
| `AGENT_LAUNCHER` | Override the vendored `scripts/launch_agent.sh`. |
| `AGENT_FALLBACK_SCRIPT` | Override the vendored `scripts/agent_with_fallback.sh`. |
| `CODEX_MODEL` | Codex model id (default `gpt-5.4-mini`). |
| `NEXT_PUBLIC_GPU_SERVER_URL` | Optional GPU status endpoint. |
| `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL` | Optional integrations. |

## The project registry

VoidSpark drives **one repo at a time**. The repos you've added live in two
files at the VoidSpark repo root — both per-machine and gitignored, so a fresh
clone starts empty:

- `projects.json` — the registry of added repos.
- `.active-project` — the id of the currently selected one.

Add a repo from the **onboarding card** (shown when the registry is empty) or the
sidebar. Switching projects re-scopes the entire dashboard — ideas, queue,
prompts, GPU box, and autorun state all follow the active repo. Removing a repo
only edits VoidSpark's registry; the target repo's work is untouched, so
re-adding it later picks up exactly where it left off.

## Choosing an agent

Open **Settings** (gear, top-right) → **Agent**. Options:

- **MiniMax (cmf)** — the cheap default; shown only when `MINIMAX_API_KEY` is set.
- **Codex** — used as the automatic fallback when MiniMax rate-limits, and
  selectable directly.

## The automation toggles

The dashboard has a few switches that decide how much runs unattended:

- **Autoresearch / Autopilot** — runs the whole pipeline end to end (gates +
  idea refill + GPU draining).
- **GPU drainer** — the loop that SSHes to the box and picks up queued runs. When
  Autoresearch is on, it owns this; otherwise toggle it directly.
- **Auto-implement** — automatically codes accepted ideas.

State for these lives in flag files inside the target repo (`autorun.flag`,
`autoimplement.flag`), so it travels with the project.

## Editing prompts

Each pipeline stage is driven by a markdown prompt in your target repo under
`autoresearch/prompts/`. Edit them from **Settings → Edit prompts** (generate
ideas, implement, runner, single run) — changes apply to the next launch.
