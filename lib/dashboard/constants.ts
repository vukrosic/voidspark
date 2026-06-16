export const IDEAS_PROMPT_PATH = "autoresearch/prompts/generate-ideas.md";
export const IMPLEMENT_PROMPT_PATH = "autoresearch/prompts/implement-idea.md";
export const RUN_PROMPT_PATH = "autoresearch/prompts/run-idea.md";
export const RUNNER_PROMPT_PATH = "autoresearch/prompts/runner.md";
export const SETUP_BOX_PROMPT_PATH = "autoresearch/prompts/setup-box.md";
export const REMOTE_BOX_PATH = "autoresearch/remote-box.json";
export const IMPLEMENT_SESSION_PREFIX = "lab-implement-";
export const RUN_SESSION_PREFIX = "lab-run-";
export const GENERATE_SESSION_PREFIX = "lab-generate";

// Keep in sync with AGENTS in lib/codexLauncher.ts. minimax is the default.
export const AGENT_OPTIONS: { id: string; label: string }[] = [
  { id: "minimax", label: "MiniMax (cmf)" },
  { id: "codex", label: "Codex" },
  // Deterministic GPU drainer (queue-daemon.sh) — no LLM in the run loop. The
  // gate workers safely fall back to MiniMax; only autorun routes to the daemon.
  { id: "daemon", label: "Daemon (no-AI GPU)" },
];

// Human-readable labels + colour for each on-disk pipeline status. The raw
// status string (what flip.sh writes) stays the source of truth — this only
// renames them for display, so the jargon ("needs-taste", "needs-recode")
// reads clearly without touching the agents' state machine. Hover shows raw.
export const STATUS_META: Record<string, { label: string; cls: string }> = {
  "needs-taste": { label: "Proposed", cls: "border-amber-300/25 bg-amber-300/5 text-amber-200/80" },
  implementing: { label: "Implementing", cls: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200/90" },
  "needs-run": { label: "Queued · GPU", cls: "border-cyan-300/25 bg-cyan-300/10 text-cyan-200/90" },
  running: { label: "Running · GPU", cls: "border-sky-300/40 bg-sky-300/15 text-sky-100" },
  "needs-recode": { label: "Fixing", cls: "border-orange-300/25 bg-orange-300/10 text-orange-200/90" },
  recoding: { label: "Fixing", cls: "border-orange-300/25 bg-orange-300/10 text-orange-200/90" },
  "needs-review": { label: "Review", cls: "border-violet-300/25 bg-violet-300/10 text-violet-200/90" },
  done: { label: "Done", cls: "border-[#faf9f6]/20 bg-white/5 text-[#faf9f6]/70" },
  rejected: { label: "Rejected", cls: "border-red-300/25 bg-red-300/5 text-red-200/80" },
  win: { label: "Improved", cls: "border-emerald-400/40 bg-emerald-400/15 text-emerald-200" },
  null: { label: "No change", cls: "border-[#faf9f6]/20 bg-white/5 text-[#faf9f6]/60" },
  drift: { label: "Invalid run", cls: "border-red-400/40 bg-red-400/15 text-red-200" },
  fail: { label: "Worse", cls: "border-red-400/40 bg-red-400/15 text-red-200" },
};

// The A/B verdict (from evidence.md) in plain words. "NULL" especially confuses
// — it does NOT mean failed, it means the change made no measurable difference
// (the loss delta fell inside the noise band between the two baselines).
export const VERDICT_META: Record<string, { label: string; help: string }> = {
  WIN: { label: "Improved", help: "Beat the baseline beyond the noise band." },
  NULL: {
    label: "No change",
    help: "No measurable difference — the change neither helped nor hurt (delta within the two-baseline noise band).",
  },
  FAIL: { label: "Worse", help: "Did worse than the baseline." },
  DRIFT: {
    label: "Invalid run",
    help: "Baselines disagreed too much — the comparison can't be trusted, not a real result.",
  },
};

// GPU utilization (%) at or below which the box counts as doing no work. An
// idle 3060 reads ~0%; training pins it to 80–100%, so a small floor cleanly
// separates "idle" from "training" without flapping on dips between steps.
export const GPU_IDLE_UTIL = 5;
// Don't surface a momentary idle blip — only show the "gpu idle" timer once the
// box has been idle continuously for at least this long.
export const GPU_IDLE_MIN_MS = 5_000;
// A busy blip should not clear the idle clock immediately. Require the GPU to
// stay above the busy threshold for this long before we say the box is "busy"
// again and reset the idle timer.
export const GPU_BUSY_MIN_MS = 5_000;
// The GPU box gets a second, more explicit idle timer in the UI, but only after
// it's been idle long enough to matter. That keeps brief pauses from blinking
// in and out of the card.
export const GPU_IDLE_BOX_MIN_MS = 10_000;

// Statuses that mean an experiment is finished — they show the full training
// curve and live in the "Finished experiments" section at the bottom.
export const FINISHED_STATUSES = new Set([
  "done",
  "win",
  "null",
  "drift",
  "fail",
  "rejected",
]);
