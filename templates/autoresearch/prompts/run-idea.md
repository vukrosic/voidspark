# Run-idea prompt (one idea → A/B on the GPU → verdict)

> 🟡 **STARTER TEMPLATE — adapt this to your repo.** The box mechanics below are a
> sketch; rewrite the `<...>` bits for your compute (local GPU, Vast.ai, etc.) and
> your run command. Keep the `{{IDEA_SLUG}}` and `{{DONE_URL}}` tokens exactly —
> VoidSpark substitutes them at launch.

Run **one specific idea's** A/B, bring back the numbers, judge it, and close the
loop. The idea to run is:

**`{{IDEA_SLUG}}`** → `autoresearch/ideas/{{IDEA_SLUG}}/idea.md`

This is a **manual one-shot** launched from the lab UI's "Run next" button — you
run **this one idea only**, not the whole queue. The autonomous batch version is
[`runner.md`](runner.md); read it for the compute mechanics, then apply them to
just this idea.

---

> ## 🔴 YOU RUN UNATTENDED — ACT, DON'T ASK
> No human is watching. Run the A/B, record the result, flip the status, and
> stop. Never end by asking "should I continue?".

## The compute

<TODO: how to reach your GPU. Example: read `autoresearch/remote-box.json` for the
SSH connection (`ssh`, `remote_repo`, `remote_venv`); multiplex one ssh
connection and route every command through it; set the venv on PATH.> The
connection box config is written from VoidSpark **Settings → GPU box**.

## Steps

1. **Confirm the claim:** the app should already have flipped this idea to
   `running`. Check `status:` in `idea.md`. If it is still `needs-run`, claim it:
   `autoresearch/bin/flip.sh {{IDEA_SLUG}} running run-button "claimed by Run-next"`.
2. Read `idea.md` (the `## Plan` section has the config flag, run command, and the
   pass/fail bar). Sync code to the box.
3. **Run the A/B** for this one idea (control = flag off, treatment = flag on,
   same seed). <TODO: your exact run command + how the final metric is read.>
4. **Pull + record** logs and a `results.json` under
   `remote-results/<date>-<tier>/` (pick a stable schema and reuse it). Write
   `evidence.md` in the idea folder: treatment metric, `Δ vs baseline`, the
   verdict vs the bar (WIN / NULL / FAIL), and the baseline line.
5. **Close the loop:**
   - finished and judged → `flip.sh {{IDEA_SLUG}} done run-button "Δ=<x>; <WIN|NULL>"`
   - run crashed (OOM/NaN/bad flag) → **do not write a null** →
     `flip.sh {{IDEA_SLUG}} needs-recode run-button "run FAILED: <1-line cause>"`

## Finally — last command you run

Ping the app so it closes this local tmux session for you:

```bash
curl -s -X POST {{DONE_URL}} -H 'Content-Type: application/json' -d '{"slug":"{{IDEA_SLUG}}"}'
```

The session closes ~2s after this. Run only this one idea, then stop.
