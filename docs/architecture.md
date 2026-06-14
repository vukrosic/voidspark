# Architecture — how the loop works

VoidSpark is a state machine over your ideas. Every idea is a folder in your
target repo with an `idea.md`; its `status` frontmatter is the **single source
of truth**. Agents poll the folders, claim work by flipping a status, and stop
when their queue is empty. No agent talks to another directly — the only channel
is the status field.

## The pipeline

```
taste ──▶ definition ──▶ implement ──▶ run ──▶ verdict
                                        │
                                crashed ▼
                                      recode ──▶ run
```

- **Taste gate** — is this idea worth a compute slot *at all*?
- **Definition gate** — is it *fully and soundly specified* (a flag, an A/B, a
  measurable metric)?
- **Implement** — an agent writes the change behind an off-by-default flag, then
  releases it straight to the GPU queue. There is **no separate code-review
  gate**: the implementer owns correctness, and a crashed run bounces back to it.
- **Run** — the A/B executes on your GPU (see [GPU box](gpu-box.md)).
- **Verdict** — the result is judged against a variance band.

## Doer ↔ critic gates

Each gate is a **doer** paired with an adversarial **critic**. The doer produces
an artifact; the skeptical critic returns `accept` / `revise` / `reject`. On
`revise` they loop — up to a **3-round cap**, after which the idea is `accept`ed
or `reject`ed so nothing cycles forever.

## Status states

The status field moves through these values (the dashboard relabels them):

| status | meaning |
|---|---|
| `needs-taste` | Proposed — waiting for the taste gate |
| `implementing` | an agent is writing the code |
| `needs-run` | Queued for the GPU |
| `running` | executing on the GPU |
| `needs-recode` / `recoding` | a run crashed — being fixed |
| `needs-review` / `needs-codereview` | in a review step |
| `done` / `win` / `null` / `drift` / `fail` | terminal |
| `rejected` | dropped (failed a gate, or hit the recode cap) |

Status changes are made with `flip.sh`, which rewrites the frontmatter and
appends one line to the idea's `log.jsonl` — that log is what the
**Analytics** view replays for stage timing.

## Verdicts

When a run finishes, the reviewer writes a verdict into the idea's `evidence.md`:

- **WIN** — improved the metric beyond the variance band.
- **NULL** — no measurable difference (this is *not* a failure — it closes the
  question honestly).
- **FAIL** — measurably worse.
- **DRIFT** — the run was invalid (didn't reproduce the control), so the result
  doesn't count.

## Agents

Each stage is an agent reading a prompt. The runner is pluggable — `minimax`
(default), `codex`, or `claude` — and launches in a **detached tmux session** via
`scripts/launch_agent.sh`. If MiniMax hits its rate limit it is killed and the
same prompt re-runs on Codex automatically (`scripts/agent_with_fallback.sh`).

## The prime directive

The whole pipeline exists to **keep the GPU busy**. An idle box with queued work
is the one failure the loop treats as an incident: whichever upstream stage is
starving the `needs-run` queue is the thing to fix first.

See [Configuration](configuration.md) to point VoidSpark at a repo and pick an
agent, and [The research repo](research-repo.md) for what a target repo provides.
