# Issue triage prompt

You are triaging a single GitHub issue in the `voidspark` repository. Triage is
sorting, not solving: decide *what this issue is*, *how big it is*, and *what
should happen to it next*. Do not implement anything. Do not open a worktree or
edit code. You read, you classify, you route.

## Read these first (skip anything that doesn't exist)

1. The issue body below — title, description, any acceptance criteria.
2. `AGENTS.md` / `CLAUDE.md` / `CONTRIBUTING.md` for house rules and scope.
3. `README.md`, then the specific files the issue names or clearly implies.
   Open them. Do not guess at file contents you can cheaply read.
4. `gh issue list --state open --limit 100` to check for duplicates / overlap.

## Issue under triage

- Repo: `voidspark`
- Number: #52
- Title: `Ablation generator: turn a winning run into N single-component-off proposals`

```markdown
## Summary

Add an **ablation generator**: given a winning run, automatically emit N follow-up idea proposals, each turning off exactly one component of the winning config. Feed these into the existing idea queue.

Ported idea from the (now archived) `autoresearch-ai` CLI command `researchloop-ablate`.

## Why

Right now the loop's `generate-ideas` step produces fresh ideas from scratch. After a win, the highest-value next experiments are *structured ablations* of that win ("does it still work without component X?"), not new vibes. This turns a single win into a disciplined ablation study automatically — exactly the rigor an unattended loop needs to produce trustworthy claims.

## Proposed behavior

- New `lib/ablate.ts`: parse the winning run's config flags, emit one proposal per toggleable component (each disabling a single component, all else held fixed).
- Surface as an action on a winning leaderboard entry ("Generate ablations") and/or auto-enqueue after a confirmed win in the autorun loop.
- Each generated proposal lands in the normal `ideas/` queue (same schema as `templates/autoresearch/ideas/`) so it flows through the existing implement → run → judge path.

## Source reference

`autoresearch-ai` (archived to `my-life/archive/autoresearch-ai`): `bin/researchloop-ablate.js`, and `docs/feature-ideas.md` → "Ablation generator".

## Depends on / pairs with

Best combined with the multi-seed + significance judge work (Tier 1) so ablation deltas are evaluated with proper variance, not single-run noise.

```

## What to decide

1. **Type** — bug · feature · enhancement · refactor · docs · question ·
   chore · duplicate · invalid. Pick exactly one primary type.
2. **Severity / priority** — for bugs: how broken and how widely (P0 breaks the
   app for everyone → P3 cosmetic). For non-bugs: impact vs. effort.
3. **Complexity** — trivial · small · medium · large. Base this on the *files
   and surfaces actually touched*, not the prose length.
4. **Affected files** — the concrete paths a fix would most likely touch. Name
   them at `path` granularity. "Unknown" is a valid answer if the issue is too
   vague to locate — and that itself is a triage signal (needs-info).
5. **Duplicate / overlap** — does an existing open issue already cover this? If
   so, name the number.
6. **Readiness** — is the contract clear enough that an implementer (human or
   agent) could start without asking questions? If not, what's the ONE missing
   thing.
7. **Disposition** — exactly one next action:
   - `agent-ready` — clear contract, machine-checkable, an agent can take it.
   - `good-first` — small, well-scoped, low blast radius.
   - `needs-info` — blocked on a question; state the question.
   - `needs-human` — judgment call, architecture, auth/payments, or risky.
   - `duplicate` — close in favor of #N.
   - `wontfix / invalid` — out of scope or not actionable; say why.

## Rules

- Be specific and grounded in files you actually read. "Looks straightforward"
  is not triage. Name the surface, the risk, the blocker.
- Do NOT classify complexity from the issue's word count. A one-line issue can
  be a large change; a long issue can be a one-liner.
- Do NOT propose a full implementation. One sentence on the likely approach is
  enough to justify the complexity rating — no more.
- Do NOT edit files, create branches, or run `gh issue comment` / `gh issue
  edit` yourself. The terminal output is the deliverable; it is posted to the
  issue automatically once you stop.
- If the repo has a label set, recommend labels by name but assume they may not
  all exist — recommendations only, you are not applying them.

## How to deliver

Write the triage report directly in the terminal in exactly the markdown
structure below, then exit. The chat is for your thinking; the report block is
what gets posted. Emit the report exactly once.

## Required output format

```markdown
# Triage report

**Model:** <your model name>
**Type:** <bug|feature|enhancement|refactor|docs|question|chore|duplicate|invalid>
**Severity:** <P0|P1|P2|P3 for bugs, or impact:high/med/low for non-bugs>
**Complexity:** <trivial|small|medium|large>
**Disposition:** <agent-ready|good-first|needs-info|needs-human|duplicate|wontfix|invalid>
**Duplicate of:** <#N or "none">
**Recommended labels:** <comma-separated, or "none">

## What this is
One or two sentences, plain language, on what the issue actually asks for.

## Affected files
- `path/one` — why
- `path/two` — why
(or "Unknown — issue does not localize to specific files" + what's missing)

## Readiness
Is the contract clear enough to start? If not, the ONE blocking question.

## Likely approach
One sentence. Just enough to justify the complexity rating.

## Risk / blast radius
Nearby behavior a change here could break, or "localized, low risk."

## Recommended next action
One concrete sentence matching the Disposition above.
```
