# VoidSpark — Plan

**VoidSpark is a localhost autonomous-research loop you point at your own code.**
It mines ideas, gate-reviews them, implements them behind a flag, runs the A/B on
your GPU, judges the result, and queues the next one — unattended, on your
machine, with your API keys and your hardware. No cloud, no account, no data
leaves your box.

> **Vision:** a PhD student clones VoidSpark, points it at their research repo,
> writes one adapter file, and wakes up to a leaderboard of ablations that
> actually ran. The loop is the product; the science is theirs.

---

## 1. What it is vs. what it drives

Two separate things — keeping this seam clean is the whole job:

| | VoidSpark (the engine) | The research repo (the target) |
|---|---|---|
| What | dashboard + queue + pipeline + agent prompts + state machine | the actual model/training code the experiments mutate |
| Generic? | yes — knows nothing about transformers | no — this is *your* codebase |
| Example | this repo | `universe-lm` / `llm-research-kit-scaling` |
| Ships in VoidSpark? | yes, the core | no — pulled in as an optional **example**, or you bring your own |

Today these are tangled: the dashboard lives in `open-superintelligence-lab-github-io`,
the engine (`autoresearch/`) lives inside `llm-research-kit-scaling`, and paths
like `/Users/vukrosic/...`, `tiny1m3m`, `models/layers.py`, and the Vast box are
hardcoded throughout the prompts. **Detangling that is phase 1.**

---

## 2. Architecture

```
voidspark/                      # the standalone repo
├── app/                        # Next.js localhost dashboard (extracted from /run, /lab, /api/*)
├── engine/
│   ├── prompts/                # idea-miner, taste, reviewer, reviser, implementer, runner
│   ├── orchestrate.sh          # the loop driver (was autoresearch/bin/orchestrate.sh)
│   ├── flip.sh                 # status state machine (idea.md frontmatter)
│   └── pipeline_snapshot.py    # queue/health snapshot
├── adapters/
│   ├── repo.ts                 # RepoAdapter interface  ← how to mutate+build the target
│   ├── compute.ts              # ComputeAdapter interface ← where experiments run
│   └── scorer.ts               # Scorer interface         ← metric parse + verdict
├── examples/
│   └── universe-lm/            # reference adapter (the llm research kit) — optional
├── voidspark.config.ts         # user fills this in: which repo, which adapter, which box
└── PLAN.md
```

The engine reads/writes one source of truth: `idea.md` frontmatter (`status`,
`round`, `updated`) in the target repo's idea folders — exactly as today. Nothing
about that changes; we only remove the hardcoded paths and model assumptions.

---

## 3. The three adapter contracts (the core design work)

Everything repo-specific hides behind these. Get them right and VoidSpark runs on
*any* codebase.

**RepoAdapter** — how to turn an idea into runnable code:
- `implementPrompt(idea)` → extra context the implementer needs (file layout, the
  flag convention, the "off-by-default, byte-identical at step 0" contract)
- `touchedFiles` → which files an experiment is allowed to edit
- `buildCheck()` → cheap import/smoke check before burning compute

**ComputeAdapter** — where it runs (`launch → poll → pull`):
- `local` (just run on this machine's GPU)
- `ssh` (your Vast/remote box — generalizes today's `remote-box.json` + runner.md)
- stretch: `kaggle`, `modal`, `runpod`
- each implements: sync code → launch detached job → poll STATUS → pull logs+results

**Scorer** — how to judge a finished run:
- `parseMetric(log)` → the number (val loss, accuracy, …)
- `verdict(control, treatment, control2)` → WIN / NULL / FAIL given a variance band

A target repo provides these via `voidspark.config.ts`. The reference
`examples/universe-lm` implements all three for the tiny1m3m transformer ablations
we run today — so it doubles as the working demo.

---

## 4. Extraction checklist (phase 1)

What has to be de-hardcoded as we pull the engine out:

- [ ] Replace `/Users/vukrosic/my-life/llm-research-kit-scaling` everywhere with a
      configured `TARGET_REPO` path
- [ ] Move the GPU box out of prompt text into the `ComputeAdapter` (today:
      `remote-box.json`, SSH lines baked into `runner.md`/`run-idea.md`)
- [ ] Pull `tiny1m3m`, seed 42, the `~0.04 variance band`, `models/layers.py`,
      `configs/llm_config.py` out of prompts → into the universe-lm adapter
- [ ] Make `launch_agent.sh` path configurable (today hardcoded in `codexLauncher.ts`),
      and fix the `mktemp` template bug while we're in there
- [ ] Parameterize agent choice (claude / codex / minimax) — already mostly done
- [ ] Localhost-first: document the env (`ANTHROPIC_API_KEY`, tmux, the dev server)

The pipeline itself (taste → definition → implement → run, no code-review gate)
ships as-is — that contract is already clean after today's changes.

---

## 5. Distribution — git repo first, npm later

Phased so we never lock an interface we haven't proven:

**Phase 1 — public git repo (clone & run).** `git clone`, `npm install`,
`npm run dev` → dashboard on `localhost:3001`. This is a *system*, not a library;
people fork it. Ship with `examples/universe-lm` so it works in minutes.

**Phase 2 — `npx voidspark init`.** A thin CLI that scaffolds `voidspark.config.ts`
in the user's repo and (optionally) pulls the example. No global install needed.

**Phase 3 — npm package** for the CLI + orchestrator, once the adapter API stops
moving. Publishing earlier just ships churn.

**Recommendation: do NOT publish to npm yet.** Repo-first.

---

## 6. The "bundle the research kit?" question — recommendation

**Yes, but as an optional example, never a hard dependency.** Two onboarding tracks:

- **Try-it track** — `voidspark init --example llm` clones the reference kit
  (universe-lm) so a newcomer watches the full loop run end-to-end on a 0.94M-param
  model in minutes. This is the demo that sells it.
- **Bring-your-own track** — `voidspark init` in their repo + fill the adapter.
  This is what PhD students actually live in long-term.

If we bundled universe-lm *as* the product, VoidSpark would look like "a transformer
ablation tool" instead of "an autoresearch engine for any repo." Keep them
separate; let the example be the on-ramp.

---

## 7. Milestones

1. **M0 — Carve out the repo.** New `voidspark` repo; move dashboard + engine in; nothing generic yet, just running standalone on localhost against the existing kit.
2. **M1 — Adapter seam.** Define the three interfaces; refactor universe-lm into `examples/universe-lm` behind them. VoidSpark core has zero transformer knowledge.
3. **M2 — `voidspark.config.ts` + `init` CLI.** A second, dummy target repo proves the adapter works on something that isn't universe-lm.
4. **M3 — Docs + README + a 5-min "watch it run" GIF.** Public launch (YouTube + both Skools).
5. **M4 — npm CLI**, only if M3 shows real pull.

---

## 8. Honest risks (so we go in eyes-open)

- **Support load.** A public localhost tool = "doesn't work on my machine" issues
  (CUDA/torch/tmux/API-key hell). This is a direct tax on the lab + Jarvis. Mitigate
  with a tight, opinionated setup and a "supported config" doc, not infinite flexibility.
- **The adapter is the hard 80%.** Making it truly repo-agnostic is most of the
  work and is invisible. M2's second target repo is the real test — don't skip it.
- **Localhost-only is a feature, not a limitation.** Lean into it: your keys, your
  GPU, your data never leaves. That's the trust story for academics.

---

## 9. Open questions (need your call)

- **Repo home:** new top-level `github.com/vukrosic/voidspark`, or under an org?
- **License:** MIT (max adoption) vs. something with a non-commercial clause?
- **Dashboard repo:** extract the UI *out* of `open-superintelligence-lab-github-io`
  into voidspark, or keep the site and have voidspark import shared components?
