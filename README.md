# VoidSpark

**A localhost autonomous-research loop you point at your own code.**

VoidSpark mines research ideas, gate-reviews them, implements each behind a
config flag, runs the A/B on your GPU, judges the result against a variance band,
and queues the next one — unattended. It runs entirely on your machine, with your
API keys and your hardware. Nothing leaves your box.

> Status: early extraction (M0). The dashboard runs standalone; the adapter layer
> that lets it drive *any* repo is in progress. See [PLAN.md](PLAN.md).

## Run it

```bash
npm install
cp .env.local.example .env.local   # fill in the values below
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — the whole app is one page:
generate ideas, implement them, queue GPU A/Bs, and read verdicts as the loop
runs.

### Environment

`.env.local`:

```
NEXT_PUBLIC_GPU_SERVER_URL=    # optional: GPU status endpoint
CONVEX_DEPLOYMENT=             # optional
NEXT_PUBLIC_CONVEX_URL=        # optional
```

### Requirements

- Node 20+, `tmux` (agents run in detached tmux sessions)
- A coding agent CLI on PATH (`claude`, `codex`, or `claude-minimax-free`)
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
