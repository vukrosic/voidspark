// Single source of truth for the supply governor.
//
// The autopilot keeps at least FLOOR ideas "in flight" (any idea not
// done/rejected) and never lets the pool exceed CEILING. The /api/orchestrate
// route uses these to decide how many implementers to fan out; /api/health
// mirrors them so the dashboard bar and the loop agree.
//
// History:
//   5/20  -> initial
//   12/24 (2026-06-15) — floor of 5 starved the GPU between batches
//   24/48 (2026-06-15) — doubled to keep more implementers running in parallel;
//                        the GPU drains batches fast and the miners sustain supply.
//
// Edit ONLY here — both routes import from this module.
export const FLOOR = 24;
export const CEILING = 48;
