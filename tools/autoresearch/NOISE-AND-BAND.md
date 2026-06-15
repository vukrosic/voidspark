# Noise & the win/null band — the rule the daemon enforces

This is the rule `queue-daemon.sh` runs on every finished treatment. Read it
before touching `finalize_one` (the verdict) or the `0.04` default in
[`queue-daemon.sh`](queue-daemon.sh) / [`baseline.sh`](baseline.sh).

## The current rule (as shipped)

```
WIN  ⟺  trt_val < champion_val − band        # default band = 0.04
NULL ⟺  trt_val inside  champion_val ± band   # logged to closed.md, never promoted
LEAK ⟺  trt_val < champion_val × 0.5          # broken eval, rejected, never promoted
```

- The bar is the **pinned champion's val** (`CHAMPION_VAL`), not the per-box
  control mean — `finalize_one` (queue-daemon.sh:511) pins it so a stray BASE
  measurement on a fresh box can't manufacture a false win (the 209 bug).
- **Champion now:** `175-alibi-slopes`, val **6.2403**, band **0.04**.

## The band is mis-calibrated — and it is hiding real wins

Measured 2026-06-15 from **all 21 ctrl runs** in `remote-results/*/results.json`:

| Noise source | 1σ | 2σ | what it is |
|---|---|---|---|
| **Within-session** (same box, same day, fixed seed/data) | **0.017** | 0.033 | the noise a paired A/B actually fights |
| **Cross-day / cross-box drift** | **0.039** | 0.078 | hardware + day variance between separate runs |

The shipped `0.04` is **2σ of the cross-box drift** — the *worst* noise — not the
paired within-session noise. Consequence, proven on our own data:

> The entire **208–216 alibi+X batch** (value-residual, canon-conv, qk-layernorm,
> swiglu, gated-attn, t5rpe, ssmax, cope, logit-scale) landed at **Δ 0.005–0.025**.
> Every one is **NULL by construction** — swallowed by the 0.04 band. If any is a
> genuine +0.01–0.02 stacking gain, **this screen cannot see it.** GPU is being
> spent in exactly the resolution zone the band is blind to.

This is the regime modded-nanogpt / OpenAI parameter-golf resolve records well
under 0.02 in. They don't have a quieter model — they **eliminate the drift term**:
treatment vs control in the *same* session on the *same* box (paired), fixed data
order, median over seeds. Drift never enters the comparison.

## The fix (do NOT just lower band to 0.02)

At 92 steps the within-session 2σ is ~0.033, so a flat 0.02 band would manufacture
**false** wins from within-session noise alone. The correct change is to remove
drift, not to shrink a drift-contaminated band:

1. **Pair it.** Judge each treatment against a control run from the *same*
   session/box (run the champion stub alongside the treatment), so only
   within-session noise is in play.
2. **Average seeds.** ≥3 seeds (`42, 123, 7`), compare medians/means.
3. Then a paired 3-seed 2-SEM band genuinely reaches **~0.01–0.015** — small
   enough to detect the stacking gains currently invisible.

Not yet wired into `finalize_one`. Until it is, treat any NULL in the 0.005–0.025
band as **inconclusive, not refuted** — the lever may be a real small win the
current screen can't resolve.

See also the research-side companion in the kit repo:
`autoresearch/PROMOTION.md` (Stage-1 screen / Stage-2 confirm) and
`autoresearch/BASELINE-CACHE-DESIGN.md` (where the `0.04` floor is stored).
