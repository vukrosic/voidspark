# Contributing to VoidSpark

Thanks for wanting to help. VoidSpark is early — issues, fixes, and adapter work
are all welcome.

## What you need

- **Node 20+** and **npm**
- **tmux** — agents run in detached tmux sessions (`brew install tmux` /
  `apt install tmux`)
- **git**
- A **coding-agent CLI** on `PATH` for running the loop locally: one of `claude`,
  `codex`, or `claude-minimax-free`
- An **`ANTHROPIC_API_KEY`** (or whichever agent CLI you use) in `.env.local`
- *Optional:* a **target research repo** with an `autoresearch/` folder to drive
  (clone [universe-lm](https://github.com/vukrosic/universe-lm) if you don't have
  one), and a **GPU box** for the run stage

## Get running

```bash
git clone https://github.com/vukrosic/voidspark
cd voidspark
npm install
cp .env.local.example .env.local   # add your key
npm run dev                          # http://localhost:3000
```

Or let an AI agent do it — see [AGENT.md](AGENT.md).

## Before you open a PR

Run all three and make sure they're clean:

```bash
npx tsc --noEmit     # types
npm run lint         # eslint
npm run build        # production build (the real gate)
```

- Keep changes focused; one concern per PR.
- Match the surrounding code style — terse comments that explain *why*, not *what*.
- Don't commit machine-specific state: `.env.local`, `projects.json`, and
  `.active-project` are gitignored and must stay that way.
- Touching the loop's behavior? Note how you verified it (the manual flow, or a
  fresh-clone simulation).

## Where things live

- `app/` — the Next.js dashboard + `app/api/*` routes
- `lib/` — project registry, agent launcher, autorun/autopilot logic
- `scripts/` — vendored shell scripts (agent launch, monitor watchdog)
- `docs/` — the in-app Documentation tab (architecture, configuration, …)

See [docs/architecture.md](docs/architecture.md) for how the pipeline works.

## Roadmap & scope

The near-term focus is the **adapter seam** (`RepoAdapter` / `ComputeAdapter` /
`Scorer`) that will let VoidSpark drive any repo — see the Roadmap in the
[README](README.md). Adapter implementations for new repos or compute backends
are especially welcome.

By contributing you agree your contributions are licensed under the
[MIT License](LICENSE).
