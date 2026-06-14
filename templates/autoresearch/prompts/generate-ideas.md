# Generate-ideas prompt (idea generation only — no running, no gates)

> 🟡 **STARTER TEMPLATE — adapt this to your repo.** VoidSpark created this from
> its scaffold. The structure is generic; the bracketed `<...>` bits and the
> "fixed test" below are placeholders you should rewrite for *your* model and
> experiment harness. The reference implementation is
> [universe-lm](https://github.com/vukrosic/universe-lm).

Search for new research levers and file them as idea files. **That's the whole
job.** Do NOT plan, implement, or run anything. Just find ideas and write them
down.

---

> ## 🔴 YOU RUN UNATTENDED — ACT, DON'T ASK
> This fires from a button with no human watching. File the ideas and stop.
> Never end by asking "want me to mine more?".

> ## 🔴 THE FIXED TEST — context for what counts as an idea
> <TODO: describe your repo's fixed evaluation here. Example: "Every idea is run
> at a small fixed scale, one seed. So only file levers that are mechanisms
> (architecture / optimizer / loss), implementable in < 200 lines behind a config
> flag, and identity/zero-init so step 0 matches the baseline.">

**Repo:** `<TODO: absolute path to your research repo>`

**Generate exactly 3 new ideas this pass.**

## Step 1 — Dedup

Read `autoresearch/closed.md` (the dedup list) and skim `ls autoresearch/ideas/`
so you don't re-file anything that already exists.

## Step 2 — Search

Use web search plus sources relevant to your problem (papers, repos, blogs).
Prefer levers with **published gains at a larger scale** (lower transfer risk).

## Step 2.5 — Think it through before filing (and bail if it's weak)

For each candidate, reason about **how it would be built and why it would work**
before writing it down. Sketch the mechanism concretely: which tensors/ops
change, where it slots in, how it stays < 200 LoC and zero-init at step 0. If you
conclude it's weak (not a real mechanism, can't be zero-init, near-duplicate),
**drop it and pick another** — the goal is 3 ideas you actually believe in.

## Step 3 — File each idea

For each idea, find the next free 3-digit number (`ls autoresearch/ideas/`), then
write `autoresearch/ideas/NNN-<slug>/idea.md` (slug = kebab-case, 1-3 words):

```markdown
---
id: NNN-<slug>
status: needs-taste
round: 1
updated: <ISO timestamp>
transfer-risk: <low|med|high>
plain: <ONE line, zero jargon — what this idea tries, for a non-expert>
---

# NNN — <Title Case Name>

## Source
<paper title + arXiv id / repo / post URL>

## Mechanism
<2-4 sentences: the math or operation, precisely. Must be < 200 LoC in this repo.>

## Design sketch (how it works + how to build it)
<~5-8 lines: which files/functions change, the config flag name (`use_<feature>`),
how it stays byte-identical to the baseline at step 0, and the one-line intuition
for *why* it helps — the specific baseline weakness it targets.>

## Scale evidence
<largest scale the source showed gains at + a one-line transfer-risk justification.>

## Why it's worth a slot
<the bet in one sharp sentence: we expect X because Y; a null still tells us Z.>
```

The `plain:` line is **required** — one jargon-free sentence.

## Step 4 — Log and stop

Print a short log: for each filed idea, its `NNN — name`, source, and one-line
plain summary. Then stop — don't plan, implement, or run anything.
