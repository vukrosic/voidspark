"use client";

import { useState } from "react";

// The val-loss RECORD TIMELINE — the lead section of the results view.
// Reset to the current GPU box's era: the "record to beat" is the clean
// baseline mean from the Phase-2 baseline cache, and only wins measured on this
// box count. Older wins ran on different GPUs against buggy controls (vals
// 6.25–6.39, not comparable to the current ~6.43 baseline) and are tucked into
// a collapsed "archived" disclosure, never shown as standing records.
//
// Data is fetched once by the parent (app/page.tsx) and passed in, so the same
// /api/research-records payload feeds both this timeline and the merged
// "All experiments" section below it.

export type RecordEvent = {
  slug: string;
  val: number | null;
  delta: number | null;
  date: string;
  note: string;
  runningBest: number | null;
  improved: boolean;
};

export type ClosedEvent = {
  slug: string;
  verdict: string;
  val: number | null;
  delta: number | null;
  date: string;
  note: string;
};

export type Baseline = {
  val: number;
  band: number;
  gpu: string;
  boxKey: string;
  eraStart: string;
} | null;

export type RecordsData = {
  records: RecordEvent[];
  archivedRecords: ClosedEvent[];
  closed: ClosedEvent[];
  counts: Record<string, number>;
  bestVal: number | null;
  baseline: Baseline;
};

export default function ResearchRecords({ data }: { data: RecordsData | null }) {
  const [showArchived, setShowArchived] = useState(false);

  if (!data) return null;

  const { records, archivedRecords, bestVal, baseline } = data;

  return (
    <section className="mt-16 w-full max-w-2xl">
      <div className="mb-5 flex items-end justify-between gap-3 border-b border-yellow-300/20 pb-3">
        <div className="flex items-center gap-3">
          <span className="h-7 w-1 rounded-full bg-yellow-300/70" />
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.28em] text-yellow-200">
              Record timeline
            </h2>
            <p className="text-[11px] text-[#faf9f6]/40">
              Lowest val loss over time on the current box. ★ = a new record.
            </p>
          </div>
        </div>
        {bestVal != null && (
          <span
            title="current best val loss — the standing record to beat"
            className="shrink-0 rounded-full border border-yellow-300/30 bg-yellow-300/10 px-3 py-1 font-mono text-xs tabular-nums text-yellow-100"
          >
            best {bestVal.toFixed(4)}
          </span>
        )}
      </div>

      {/* The standing baseline this board is reset to. */}
      {baseline && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-[11px]">
          <span className="font-semibold uppercase tracking-[0.18em] text-[#faf9f6]/55">
            Record to beat
          </span>
          <span className="font-mono tabular-nums text-yellow-100">
            {baseline.val.toFixed(4)}
          </span>
          <span className="font-mono tabular-nums text-[#faf9f6]/35">
            ±{baseline.band.toFixed(3)} band
          </span>
          {baseline.gpu && (
            <span className="text-[#faf9f6]/35">
              · {baseline.gpu} baseline · since {baseline.eraStart}
            </span>
          )}
        </div>
      )}

      {!baseline && records.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-6 text-center text-sm text-[#faf9f6]/45">
          No baseline measured on this box yet — the record timeline starts once
          the daemon measures the control bracket.
        </p>
      ) : (
        <ol className="relative space-y-2 border-l border-white/10 pl-5">
          {/* Baseline is the FIRST point on the timeline — the line every record
              is measured against. Renders as a hollow node (not a ★ win) dated to
              the box's era start, so the timeline always reads baseline → wins. */}
          {baseline && (
            <li className="relative">
              <span className="absolute -left-[1.42rem] top-2 h-2.5 w-2.5 rounded-full border border-yellow-300/60 bg-[#1f1e1d]" />
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-semibold text-[#faf9f6]/75">
                    baseline · record to beat
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-[#faf9f6]/45">
                    {baseline.eraStart}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums">
                  <span className="text-yellow-100">val {baseline.val.toFixed(4)}</span>
                  <span className="text-[#faf9f6]/35">±{baseline.band.toFixed(3)} band</span>
                  {baseline.gpu && <span className="text-[#faf9f6]/35">{baseline.gpu}</span>}
                </div>
              </div>
            </li>
          )}
          {records.length === 0 && (
            <li className="relative">
              <span className="absolute -left-[1.42rem] top-2 h-2.5 w-2.5 rounded-full border border-dashed border-white/25 bg-transparent" />
              <p className="px-4 py-2 text-[11px] text-[#faf9f6]/40">
                No win has beaten the baseline yet — the next record lands here.
              </p>
            </li>
          )}
          {records.map((r, i) => (
            <li key={`${r.slug}-${i}`} className="relative">
              <span
                className={`absolute -left-[1.42rem] top-2 h-2.5 w-2.5 rounded-full border ${
                  r.improved
                    ? "border-yellow-300 bg-yellow-300"
                    : "border-white/25 bg-[#1f1e1d]"
                }`}
              />
              <div
                className={`rounded-xl border px-4 py-3 ${
                  r.improved
                    ? "border-yellow-300/25 bg-yellow-300/[0.05]"
                    : "border-white/10 bg-white/[0.02]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-semibold text-[#faf9f6]">
                    {r.improved && <span className="mr-1 text-yellow-300">★</span>}
                    {r.slug}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-[#faf9f6]/45">
                    {r.date}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums">
                  {r.val != null && (
                    <span className="text-yellow-100">val {r.val.toFixed(4)}</span>
                  )}
                  {r.delta != null && (
                    <span className="text-emerald-300/80">Δ {r.delta.toFixed(4)}</span>
                  )}
                  {r.runningBest != null && (
                    <span className="text-[#faf9f6]/35">
                      best so far {r.runningBest.toFixed(4)}
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* Cross-box wins from before this baseline era — collapsed, for context. */}
      {archivedRecords.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowArchived((s) => !s)}
            className="text-[11px] uppercase tracking-[0.18em] text-[#faf9f6]/35 transition hover:text-[#faf9f6]/65"
          >
            {showArchived ? "Hide" : "Show"} {archivedRecords.length} archived win
            {archivedRecords.length === 1 ? "" : "s"} from earlier boxes
          </button>
          {showArchived && (
            <ul className="mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-2">
              {archivedRecords.map((a, i) => (
                <li
                  key={`${a.slug}-${i}`}
                  className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.01] px-3 py-1.5 font-mono text-[10px] tabular-nums text-[#faf9f6]/35"
                  title="ran on a different GPU/control — not comparable to the current baseline"
                >
                  <span className="truncate">{a.slug}</span>
                  <span className="shrink-0">
                    {a.val != null ? a.val.toFixed(4) : "—"} · {a.date}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
