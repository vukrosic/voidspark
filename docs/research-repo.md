# The research repo

VoidSpark is the **engine**; your research repo is the **target** it drives. The
engine knows nothing about your model — it only reads and writes an
`autoresearch/` folder inside your repo. The reference target is
[universe-lm](https://github.com/vukrosic/universe-lm); clone it to see a working
example, or add this structure to your own repo.

## `autoresearch/` layout

```
autoresearch/
├── ideas/
│   └── <slug>/
│       ├── idea.md        # the idea + `status` frontmatter (source of truth)
│       ├── log.jsonl      # one line per status flip (powers Analytics)
│       └── evidence.md    # the reviewer's verdict after a run
├── prompts/               # one markdown prompt per pipeline stage
│   ├── generate-ideas.md
│   ├── implement-idea.md
│   ├── runner.md
│   └── run-idea.md
├── bin/
│   ├── flip.sh            # the status state machine
│   ├── orchestrate.sh     # the loop driver
│   └── queue-daemon.sh    # the GPU drainer
├── remote-box.json        # GPU box connection (written from Settings)
├── autorun.flag           # automation toggles travel with the repo
└── autoimplement.flag
```

## An idea

Each idea is a folder whose `idea.md` carries frontmatter the engine owns:

```markdown
---
status: needs-taste
round: 0
updated: 2026-06-14
---

# 142 — Cosine gate on the MLP branch

Add an off-by-default `mlp_cosine_gate` flag that … (A vs B, measured on val loss).
```

The contract for an idea's code change:

- **Off by default** — a single flag toggles it; with the flag off the run must be
  **byte-identical** to the control at step 0.
- **One measurable metric** — the A/B is decided by a number (val loss, accuracy)
  against a variance band.
- **Self-contained** — touches only the files an experiment is allowed to edit.

## Bringing your own repo

Today the engine assumes the `autoresearch/` convention above (the
[universe-lm](https://github.com/vukrosic/universe-lm) layout). The generic
**adapter layer** — `RepoAdapter` / `ComputeAdapter` / `Scorer`, which will let
any repo plug in with one config file — is on the roadmap (see the README). Until
then, the fastest path is to copy the example's `autoresearch/` folder and adapt
its prompts to your codebase.
