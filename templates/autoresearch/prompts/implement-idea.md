# Implement-idea prompt (one idea → working experiment code)

> 🟢 **One file to fill in.** This prompt is generic — repo path, file names,
> the config-flag convention, and the fixed test all come from
> `autoresearch/config.json`. Edit that file, not this one. Keep the
> `{{IDEA_SLUG}}` and `{{DONE_URL}}` tokens exactly — VoidSpark substitutes them
> at launch.

Take **one specific idea** and turn it into ready-to-run experiment code in this
repo. The idea to implement is:

**`{{IDEA_SLUG}}`** → `autoresearch/ideas/{{IDEA_SLUG}}/idea.md`

---

> ## 🔴 YOU RUN UNATTENDED — ACT, DON'T ASK
> This fires from a button with no human watching. Implement the idea and write
> the code down. Never end by asking "should I continue?" — just do it, then stop.

> ## 🔴 THE FIXED TEST — never change it
> Defined in `autoresearch/config.json`: runs at `tier` (one fixed scale, `seed`).
> The change must fit within `loc_budget` behind the `config_flag`, **off by
> default**, and satisfy `init_constraint` (step 0 byte-identical to the baseline).

> ## 🔴 THE BASELINE IS THE CHAMPION — always check `autoresearch/champion.json`
> The baseline is **not** the bare model — it is the current **champion** (the
> best architecture so far, the stack of every promoted win). Read
> `autoresearch/champion.json`:
> - Your treatment **stacks on top of the champion**: subclass its `config_class`
>   (not the bare base), so your change builds on every prior win.
> - "Step 0 byte-identical" and the control both mean **vs the champion**, not the
>   bare model. With your flag off, the output must equal the champion's.
> - Empty `stub` ⇒ no champion yet; fall back to the bare base config.
>
> This is how wins compound: each new idea = champion + one new lever. The daemon
> judges you against the champion's `val` and, if you beat it, promotes you to the
> new champion automatically — no re-measure, no LLM.

**Repo:** the `repo_path` in `autoresearch/config.json`.

Before you start: `git status` and `git diff` (another agent may be editing the
same files). Never rebase, never push.

## Step 1 — Claim it (tracking)

```bash
autoresearch/bin/flip.sh {{IDEA_SLUG}} implementing implement-button "claimed by implement button"
```

Then read the whole `autoresearch/ideas/{{IDEA_SLUG}}/idea.md` — the mechanism,
design sketch, and the bet are already written. Follow the design sketch.

## Step 2 — Plan (inside idea.md)

Append a `## Plan` section to the **bottom of
`autoresearch/ideas/{{IDEA_SLUG}}/idea.md`** (do NOT create a separate plan.md, and
do NOT touch the frontmatter). State: the exact files/functions you'll change
(see `model_files` in `autoresearch/config.json`), the flag name (per the
`config_flag` convention), how it satisfies `init_constraint` at step 0, the
`run_command`, and how the `metric` is read. Keep it tight.

## Step 3 — Implement

Make the change behind the flag (`config_flag` convention), **off by default** so
the baseline path is untouched. Keep it minimal and within `loc_budget`. Then
confirm:
- it imports cleanly,
- the flag toggles the behavior,
- with the flag **off**, step-0 output matches the baseline (`init_constraint`).

Follow the run convention in `PIPELINE.md` so the experiment is ready to launch
(you don't have to run full training here — just make it runnable and note the
exact command in the `## Plan` section).

## Step 4 — Mark done, signal the app, and stop

```bash
autoresearch/bin/flip.sh {{IDEA_SLUG}} needs-run implement-button "code ready; runnable"
```

If you get genuinely blocked, bounce it back instead of leaving it stuck:

```bash
autoresearch/bin/flip.sh {{IDEA_SLUG}} needs-review implement-button "blocked: <one-line reason>"
```

Print a short log: idea slug, files changed, the flag name, the run command, and
the final status.

**Finally — this is the last command you run.** Ping the app so it puts the idea
in the GPU queue and closes this tmux session for you:

```bash
curl -s -X POST {{DONE_URL}} -H 'Content-Type: application/json' -d '{"slug":"{{IDEA_SLUG}}"}'
```

The session closes ~2s after this call — that's expected. You are done with this
one idea.
