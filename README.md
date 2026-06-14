# VoidSpark

**A localhost autonomous-research loop you point at your own code.**

VoidSpark mines research ideas, gate-reviews them, implements each behind a
config flag, runs the A/B on your GPU, judges the result against a variance band,
and queues the next one — unattended. It runs entirely on your machine, with your
API keys and your hardware. Nothing leaves your box.

> Status: early extraction (M0). You point it at one local research repo today;
> the generic adapter layer that will let it drive *any* repo with one config
> file is in progress. See [PLAN.md](PLAN.md).

## First run

```bash
npm install
cp .env.local.example .env.local   # optional — see Environment below
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). On a fresh clone the cockpit
shows an **onboarding card** — add the absolute path to the research repo you
want VoidSpark to drive. Don't have one? Clone the reference target
[universe-lm](https://github.com/vukrosic/universe-lm) and point VoidSpark at it.

Then open **Settings** (gear, top-right) → **GPU box (Vast.ai)** and paste the
SSH command your GPU host gives you, e.g.:

```
ssh -p 52674 root@1.2.3.4
```

VoidSpark parses the host/port/user into the repo's
`autoresearch/remote-box.json` — no JSON editing. When you rent a new instance,
just paste the new command.

From there the whole app is one page: generate ideas, implement them, queue GPU
A/Bs, and read verdicts as the loop runs.

### Environment

Everything in `.env.local` is optional — you can configure the repo (onboarding
card) and GPU box (Settings) entirely from the UI. To seed them up front:

```
VOIDSPARK_TARGET_REPO=         # abs path to the repo to drive (seeds the registry)
ANTHROPIC_API_KEY=             # for whichever agent CLI you run
AGENT_LAUNCHER=                # optional: override the vendored scripts/launch_agent.sh
CODEX_MODEL=                   # optional: default gpt-5.4-mini
NEXT_PUBLIC_GPU_SERVER_URL=    # optional: GPU status endpoint
CONVEX_DEPLOYMENT=             # optional
NEXT_PUBLIC_CONVEX_URL=        # optional
```

### Requirements

- Node 20+, `tmux` (agents run in detached tmux sessions)
- A coding agent CLI on PATH (`claude`, `codex`, or `claude-minimax-free`).
  The tmux launcher ships vendored in [`scripts/launch_agent.sh`](scripts/launch_agent.sh) —
  no external skill install needed.
- A target research repo + (optionally) a GPU box. The reference target is
  [universe-lm](https://github.com/vukrosic/universe-lm).

## How it works

The pipeline is a self-driving loop over an idea's `status` frontmatter:

```
taste → definition → implement → run → done
                                   └─ crashed → recode → run
```

Each stage is an agent reading a prompt; `flip.sh` advances the status; the
dashboard reads the queue live. There is no code-review gate — the implementer
owns correctness, and a crashed run bounces back to it.

See [PLAN.md](PLAN.md) for the architecture and the adapter contracts that will
make this work on any codebase.
