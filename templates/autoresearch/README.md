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
├── prompts/            # one prompt per AI stage — read config.json, generic
│   ├── generate-ideas.md   # AI: mine ideas
│   ├── implement-idea.md   # AI: write the treatment code + run.json
│   └── setup-box.md        # AI: provision a fresh GPU box
├── bin/                # the deterministic last mile — NO LLM in the loop
│   ├── flip.sh         # the status state machine (generic — works as-is)
│   ├── queue-daemon.sh # drains needs-run on the GPU: run → poll → judge → flip
│   ├── _box_smoke.py   # CPU build-smoke a stub before spending GPU time
│   └── baseline.sh     # mean ± noise-band verdict (pure arithmetic)
└── closed.md           # dedup + closed-idea log
```

## Who owns what

**AI** owns the *upstream* gates only — mine ideas, taste, review, and **write
the treatment code** (`prompts/`). The **GPU last mile is drained by a plain
script** — [`bin/queue-daemon.sh`](bin/queue-daemon.sh), no LLM in the hot loop.
Run it as a loop (`queue-daemon.sh --loop 300`) and it claims every `needs-run`
idea with a valid `run.json`, CPU-smokes it, launches a fail-isolated queue in a
detached `arq` tmux on the box, polls, judges each result against the baseline
band, and flips statuses — deterministically and cron-safe. It is repo-agnostic:
the only coupling is the `drain` block of `config.json`.

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
