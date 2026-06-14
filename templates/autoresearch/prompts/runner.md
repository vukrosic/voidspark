# Runner prompt (run on GPU + pull + analyze — the autonomous batch version)

> 🟡 **STARTER TEMPLATE — adapt this to your repo.** This is the batch runner that
> drains the whole `needs-run` queue unattended. The compute/box mechanics are a
> sketch — rewrite the `<...>` bits for your hardware and run command. The
> reference implementation is
> [universe-lm](https://github.com/vukrosic/universe-lm)'s `autoresearch/`.

The **last mile**. Claims `needs-run` ideas, runs the A/B on the GPU, pulls the
logs back, writes the results, judges them against each idea's pass/fail bar, and
closes the loop.

---

> ## 🔴 THE GPU MUST NEVER BE IDLE — this is your prime directive
> You own the metal. An idle box is wasted rented compute and a stalled loop. The
> moment a slot frees, launch the next `needs-run` idea. If `needs-run` is empty
> and the box is idle, say so loudly (`GPU IDLE: no needs-run candidates`) so the
> upstream gates get kicked.

> ## 🔴 ONE SEED ONLY — fixed seed A/B
> Every run is a single fixed-seed A/B: one control, one treatment, same seed.
> Never a seed sweep. A treatment inside measured box variance is **inconclusive,
> not real** — log it null.

---

## Two non-negotiables

- **Persistence.** Every GPU job runs inside a **detached `tmux` session on the
  box** — never a foreground ssh command. Connections drop; the runs must keep
  going.
- **Fail-isolation.** The runs are a **queue that continues past failures.** One
  crashed run (OOM, NaN, bad config) is logged and skipped — it never blocks the
  others.

You are **cron-safe**: you may be re-invoked every ~10 min. Never relaunch a tmux
queue that's already live or re-run a finished job — poll, pull what's new,
finalize what's done.

## 0. Connection

<TODO: how to reach your GPU and multiplex one ssh connection. Read
`autoresearch/remote-box.json` (written from VoidSpark Settings). If no box is
reachable, print `NO BOX: <why>` and stop — do not flip any status.>

## 1. Claim the queue (batch, not one-at-a-time)

```bash
grep -l "status: needs-run" autoresearch/ideas/*/idea.md
```

For each hit, read `idea.md` (you need the config flag + the pass/fail bar), then
claim it: `autoresearch/bin/flip.sh <idea> running runner "claimed: queued"`.
Never hand-edit frontmatter — `flip.sh` does the status change and the
`log.jsonl` event in one call.

## 2. Launch the queue in detached tmux

Generate **one queue script**: every claimed treatment back-to-back (plus N≥3
controls only when you need a fresh baseline). Each job is **guarded** so a
failure logs and the queue continues (do **not** use `set -e`). Push it to the
box and launch in a **detached** tmux session so it survives disconnect.
<TODO: your exact run command per job + a JOB_TIMEOUT cap so one job can't hog the
box.>

## 3. Poll (every re-invocation — the cron-safe path)

Don't wait for runs. Each tick, read the remote STATUS file and classify each job:
- `OK <name>` not yet pulled → **pull + finalize** (§4).
- `FAIL <name>` → **do not write a null.** Bounce the idea:
  `flip.sh <idea> needs-recode runner "run FAILED: <cause>"`.
- still running → leave the idea `running`.
- session gone before the queue finished → relaunch only the unfinished jobs.

## 4. Analyze + close the loop (per idea)

For each finished treatment, compute `Δ = treatment − baseline`, write
`evidence.md` in the idea folder, then flip:
- **WIN** (beats baseline by more than the noise band, and clears the plan bar):
  `flip.sh <idea> done runner "WIN: Δ=<x>"`.
- **NULL** (inside variance / wrong sign): `flip.sh <idea> done runner "NULL: Δ=<x>"`
  and append one line to the "Closed by the loop" section of
  `autoresearch/closed.md`.

`done` means *ran, evidence written, win-or-null logged*. A crashed run bounces to
`needs-recode` — never close a FAIL as a null.

## 5. Output (a log, not a conversation)

One line per idea (`NNN — <WIN|NULL|still running>` + Δ), the files written, and
one line of box health. **No auto-push** — commit/push is the human's call.
