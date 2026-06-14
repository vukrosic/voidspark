# Implement-idea prompt (one idea → working experiment code)

> 🟡 **STARTER TEMPLATE — adapt this to your repo.** The bracketed `<...>` bits
> (repo path, file names, config flag convention, the fixed test) are
> placeholders. Rewrite them for your codebase. Keep the `{{IDEA_SLUG}}` and
> `{{DONE_URL}}` tokens exactly — VoidSpark substitutes them at launch.

Take **one specific idea** and turn it into ready-to-run experiment code in this
repo. The idea to implement is:

**`{{IDEA_SLUG}}`** → `autoresearch/ideas/{{IDEA_SLUG}}/idea.md`

---

> ## 🔴 YOU RUN UNATTENDED — ACT, DON'T ASK
> This fires from a button with no human watching. Implement the idea and write
> the code down. Never end by asking "should I continue?" — just do it, then stop.

> ## 🔴 THE FIXED TEST — never change it
> <TODO: your repo's fixed test. Example: "Runs at one small scale, one seed. The
> change must be < 200 LoC behind a config flag, off by default, and
> byte-identical to the baseline at step 0 (zero/identity init).">

**Repo:** `<TODO: absolute path to your research repo>`

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
(e.g. `<your model file>`, `<your config file>`), the config flag name
(`use_<feature>`), how it stays zero-init at step 0, the run command, and how the
final metric is read. Keep it tight.

## Step 3 — Implement

Make the change behind the `use_<feature>` flag, **off by default** so the
baseline path is untouched. Keep it minimal and < 200 LoC. Then confirm:
- it imports cleanly,
- the flag toggles the behavior,
- with the flag **off**, step-0 output matches the baseline.

Follow the run convention in `prompts/runner.md` so the experiment is ready to
launch (you don't have to run full training here — just make it runnable and note
the exact command in the `## Plan` section).

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
