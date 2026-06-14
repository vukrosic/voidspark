# `autoresearch/` — starter scaffold

**VoidSpark created this folder.** It's the contract between VoidSpark (the
cockpit) and your repo (the target it drives). VoidSpark reads and writes *only*
this folder — your model code is untouched.

> 🟡 **This is a starter, not a finished pipeline.** The directory structure, the
> generic machinery (`bin/flip.sh`), and the prompts all work as-is — but they
> read your repo's specifics from **one file: [`config.json`](config.json)**.
> Fill that in (repo path, run command, config-flag convention, fixed test,
> metric, compute) and the prompts pick it up automatically; until you do, the AI
> agents VoidSpark launches won't know how to build or run your experiments. The
> reference implementation to copy from is
> [universe-lm](https://github.com/vukrosic/universe-lm).

## What's here

```
autoresearch/
├── config.json         # ← THE ONE FILE TO EDIT (repo path, run cmd, fixed test…)
├── ideas/
│   └── NNN-<slug>/
│       ├── idea.md     # the idea + `status` frontmatter (source of truth)
│       └── log.jsonl   # one line per status flip (powers Analytics)
├── prompts/            # one prompt per pipeline stage — read config.json, generic
│   ├── generate-ideas.md
│   ├── implement-idea.md
│   ├── run-idea.md
│   └── runner.md
├── bin/
│   └── flip.sh         # the status state machine (generic — works as-is)
└── closed.md           # dedup + closed-idea log
```

## Statuses an idea moves through

`needs-taste → needs-implement → implementing → needs-run → running → done`
(or `needs-recode` / `needs-review` / `rejected`). Every transition goes through
`bin/flip.sh`, which rewrites the `idea.md` frontmatter and appends to
`log.jsonl` in one call — never hand-edit both.

## Next steps

1. **Edit `config.json`** — replace every `<...>` value with your repo's
   specifics (repo path, run command, config-flag convention, fixed test, metric,
   scorer). This is the only file you have to fill in; the prompts read from it.
2. In VoidSpark, open **Settings → GPU box** and paste your Vast.ai SSH command
   (this writes `autoresearch/remote-box.json`, which `config.json`'s `compute`
   field points at).
3. Add your first real idea (or let "Generate ideas" mine some), then implement
   and run it from the dashboard.

Automation flags (`autorun.flag`, `autoimplement.flag`, `autopilot.flag`) are
**absent on purpose** — their presence means ON. VoidSpark creates them when you
flip the toggles in the UI, so nothing auto-starts before you've configured a box.
