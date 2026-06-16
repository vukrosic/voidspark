import type { Result } from "@/lib/dashboard/types";
import { verdictMeta } from "@/lib/dashboard/format";

const Row = ({ label, val }: { label: string; val: number }) => (
  <>
    <dt className="text-[#faf9f6]/55">{label}</dt>
    <dd className="font-mono text-[#faf9f6]/85">{val.toFixed(4)}</dd>
  </>
);

// The A/B result block under an idea card: the three measured losses (two
// baselines + the experiment), the verdict badge, and the two deltas. Pure —
// depends only on its args and verdictMeta. Returns null when there are no
// numbers yet so the caller can render it inline without a guard.
export function renderResult(r: Result, stale = false) {
  const rows: { label: string; val: number | null }[] = [
    { label: "Baseline (ctrl)", val: r.controlVal },
    { label: "Experiment", val: r.treatmentVal },
    { label: "Baseline (ctrl2)", val: r.ctrl2Val },
  ];
  if (rows.every((x) => x.val == null)) return null;

  const verdict = r.verdict || "—";
  const vColor =
    verdict === "WIN"
      ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-200"
      : verdict === "DRIFT" || verdict === "FAIL"
        ? "border-red-400/40 bg-red-400/15 text-red-200"
        : "border-[#faf9f6]/20 bg-white/5 text-[#faf9f6]/60"; // NULL / unknown
  // For Δ: negative = experiment lower than baseline = better (green).
  const deltaText = (d: number | null) =>
    d == null ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(4)}`;
  const deltaColor = (d: number | null) =>
    d == null
      ? "text-[#faf9f6]/40"
      : d < 0
        ? "text-emerald-300"
        : d > 0
          ? "text-amber-300"
          : "text-[#faf9f6]/60";

  return (
    <div
      className={`mt-3 rounded-lg border px-3 py-3 ${
        stale ? "border-white/[0.06] bg-black/10 opacity-60" : "border-white/10 bg-black/20"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-[#faf9f6]/40">
          {stale ? "Previous run — re-coding a fix" : "A/B result"}
        </span>
        <span
          title={verdictMeta(verdict).help || verdict}
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${vColor}`}
        >
          {verdictMeta(verdict).label}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
        {rows.map((row) =>
          row.val == null ? null : (
            <Row key={row.label} label={row.label} val={row.val} />
          )
        )}
      </dl>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        <span className="text-[#faf9f6]/40">
          Δ vs ctrl{" "}
          <span className={`font-mono ${deltaColor(r.deltaCtrl)}`}>
            {deltaText(r.deltaCtrl)}
          </span>
        </span>
        <span className="text-[#faf9f6]/40">
          Δ vs ctrl2{" "}
          <span className={`font-mono ${deltaColor(r.deltaCtrl2)}`}>
            {deltaText(r.deltaCtrl2)}
          </span>
        </span>
        <span className="text-[#faf9f6]/30">(− = experiment better)</span>
      </div>
    </div>
  );
}
