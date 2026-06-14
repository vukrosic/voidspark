"use client";

import { useCallback, useEffect, useState } from "react";

// Analytics view — pipeline timing pulled from each idea's log.jsonl transition
// history (see /api/analytics). Answers "how long does each stage take, how much
// does it vary (deviation), and what's stuck right now?". Project-scoped: it
// re-fetches whenever the active project changes (key on projectId in the page).

type StageStat = {
  state: string;
  label: string;
  count: number;
  meanMs: number;
  medianMs: number;
  stdevMs: number;
  minMs: number;
  maxMs: number;
};

type EndToEnd = {
  count: number;
  meanMs: number;
  medianMs: number;
  stdevMs: number;
  minMs: number;
  maxMs: number;
} | null;

type InFlight = {
  id: string;
  title: string;
  state: string;
  label: string;
  agent: string;
  note: string;
  elapsedMs: number;
  stuck: boolean;
};

type Totals = {
  ideasWithLogs?: number;
  finished?: number;
  inFlight?: number;
  stuck?: number;
  failures?: number;
};

type Analytics = {
  stages: StageStat[];
  endToEnd: EndToEnd;
  inFlight: InFlight[];
  reviewerOutcomes: Record<string, number>;
  totals: Totals;
};

// The reviewer's A/B verdict in plain words. "NULL" is the confusing one — it
// means "no measurable difference", NOT failed.
const VERDICT_LABEL: Record<string, { label: string; cls: string }> = {
  WIN: { label: "Improved", cls: "border-emerald-400/40 bg-emerald-400/15 text-emerald-200" },
  NULL: { label: "No change", cls: "border-white/15 bg-white/[0.05] text-[#faf9f6]/65" },
  FAIL: { label: "Worse", cls: "border-red-400/40 bg-red-400/15 text-red-200" },
  DRIFT: { label: "Invalid run", cls: "border-amber-400/40 bg-amber-400/15 text-amber-200" },
};
const verdictLabel = (v: string) =>
  VERDICT_LABEL[v.toUpperCase()] ?? {
    label: v,
    cls: "border-white/15 bg-white/[0.05] text-[#faf9f6]/65",
  };

// "2h 4m" / "34m" / "12s" — compact, two units max.
function fmtDur(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

// Each pipeline stage gets a stable accent so the bars read at a glance and
// match the home dashboard's colour language (amber=ideas, cyan=GPU, etc.).
const STAGE_ACCENT: Record<string, string> = {
  "needs-taste": "bg-amber-300/70",
  implementing: "bg-emerald-400/80",
  "needs-review": "bg-violet-400/80",
  "needs-recode": "bg-orange-400/80",
  recoding: "bg-orange-400/80",
  "needs-codereview": "bg-violet-400/80",
  "needs-run": "bg-cyan-400/70",
  running: "bg-sky-400/80",
};
const accentFor = (state: string) => STAGE_ACCENT[state] ?? "bg-white/50";

function StatCard({
  label,
  meanMs,
  medianMs,
  stdevMs,
  count,
  minMs,
  maxMs,
}: {
  label: string;
  meanMs: number;
  medianMs: number;
  stdevMs: number;
  count: number;
  minMs: number;
  maxMs: number;
}) {
  // Coefficient of variation as a quick "how consistent is this stage" read.
  const cv = meanMs > 0 ? Math.round((stdevMs / meanMs) * 100) : 0;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#faf9f6]/70">
          {label}
        </span>
        <span className="font-mono text-[10px] text-[#faf9f6]/35">
          n={count}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="font-mono text-xl tabular-nums text-[#faf9f6]">
          {fmtDur(meanMs)}
        </span>
        <span className="font-mono text-[11px] text-[#faf9f6]/45">
          ± {fmtDur(stdevMs)}
        </span>
      </div>
      <p className="mt-1 font-mono text-[10px] tabular-nums text-[#faf9f6]/35">
        median {fmtDur(medianMs)} · {fmtDur(minMs)}–{fmtDur(maxMs)}
        {count > 1 ? ` · cv ${cv}%` : ""}
      </p>
    </div>
  );
}

export default function AnalyticsView({
  onHome,
}: {
  onHome: () => void;
}) {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  // When the page last fetched, so live in-flight clocks can count up between
  // polls without re-fetching.
  const [fetchedAt, setFetchedAt] = useState<number>(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/analytics/", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) {
        setError(d.error ?? "Failed to load analytics");
        return;
      }
      setError("");
      setData({
        stages: Array.isArray(d.stages) ? d.stages : [],
        endToEnd: d.endToEnd ?? null,
        inFlight: Array.isArray(d.inFlight) ? d.inFlight : [],
        reviewerOutcomes: d.reviewerOutcomes ?? {},
        totals: d.totals ?? {},
      });
      setFetchedAt(Date.now());
    } catch {
      setError("Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  // 1s ticker so in-flight elapsed clocks stay live between 10s polls.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const stages = data?.stages ?? [];
  // Scale the comparison bars to the slowest mean stage.
  const maxMean = Math.max(1, ...stages.map((s) => s.meanMs));
  const totals = data?.totals ?? {};
  const liveDrift = now - fetchedAt; // add to server elapsed for a live clock

  return (
    <main className="min-h-screen flex-1 bg-[#1f1e1d] pt-10 text-[#faf9f6] md:pt-12">
      <div className="container mx-auto flex min-h-[calc(100vh-12rem)] max-w-3xl flex-col px-6 py-10">
        {/* Header */}
        <div className="mb-8 flex items-end justify-between gap-3 border-b border-fuchsia-300/20 pb-3">
          <div className="flex items-center gap-3">
            <span className="h-7 w-1 rounded-full bg-fuchsia-300/70" />
            <div>
              <h1 className="text-sm font-semibold uppercase tracking-[0.28em] text-fuchsia-200">
                Analytics
              </h1>
              <p className="text-[11px] text-[#faf9f6]/40">
                How long the productive stages take — mean ± deviation across
                runs. Stuck and failed-run time is excluded.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="shrink-0 text-xs uppercase tracking-[0.2em] text-fuchsia-300/70 transition hover:text-fuchsia-200"
          >
            Refresh
          </button>
        </div>

        {error && (
          <p className="mb-4 rounded-lg border border-orange-300/20 bg-orange-300/[0.06] px-4 py-3 text-xs text-orange-200">
            {error}
          </p>
        )}

        {loading && !data ? (
          <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-6 text-center text-sm text-[#faf9f6]/40">
            Loading analytics…
          </p>
        ) : (
          <>
            {/* Summary chips */}
            <div className="mb-8 flex flex-wrap gap-2 text-[11px]">
              {[
                { k: "Ideas tracked", v: totals.ideasWithLogs ?? 0 },
                { k: "Finished", v: totals.finished ?? 0 },
                { k: "In flight", v: totals.inFlight ?? 0 },
                { k: "Had failures", v: totals.failures ?? 0, alert: (totals.failures ?? 0) > 0 },
              ].map((c) => (
                <span
                  key={c.k}
                  className={`rounded-full border px-3 py-1.5 font-mono tabular-nums ${
                    c.alert
                      ? "border-orange-400/30 bg-orange-400/[0.08] text-orange-200"
                      : "border-white/10 bg-white/[0.03] text-[#faf9f6]/65"
                  }`}
                >
                  <span className="opacity-60">{c.k}</span>{" "}
                  <span className="font-semibold">{c.v}</span>
                </span>
              ))}
            </div>

            {/* Stage timing cards */}
            <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#faf9f6]/45">
              Time per stage
            </h2>
            {stages.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-6 text-center text-sm text-[#faf9f6]/40">
                No completed stage transitions yet — run the loop and they&apos;ll
                appear here.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {stages.map((s) => (
                    <StatCard key={s.state} {...s} />
                  ))}
                </div>

                {/* Comparison bars — mean duration per stage, longest = full width */}
                <div className="mt-6 space-y-2.5">
                  {stages.map((s) => (
                    <div key={s.state}>
                      <div className="mb-1 flex items-baseline justify-between text-[11px]">
                        <span className="text-[#faf9f6]/65">{s.label}</span>
                        <span className="font-mono tabular-nums text-[#faf9f6]/45">
                          {fmtDur(s.meanMs)}{" "}
                          <span className="text-[#faf9f6]/25">
                            ± {fmtDur(s.stdevMs)}
                          </span>
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className={`h-full rounded-full ${accentFor(s.state)} transition-[width] duration-500`}
                          style={{ width: `${Math.max(2, (s.meanMs / maxMean) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Reviewer outcomes — the verdict distribution, in plain words. */}
            {Object.keys(data?.reviewerOutcomes ?? {}).length > 0 && (
              <div className="mt-8">
                <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#faf9f6]/45">
                  Reviewer outcomes
                </h2>
                <p className="mb-3 text-[11px] text-[#faf9f6]/35">
                  What the reviewer concluded for each finished experiment.{" "}
                  <span className="text-[#faf9f6]/55">No change</span> = the tweak
                  made no measurable difference (not a failure).
                </p>
                {/* Win rate — the headline for a research loop: of everything
                    reviewed, what fraction actually improved the metric. */}
                {(() => {
                  const counts = data!.reviewerOutcomes;
                  const reviewed = Object.values(counts).reduce((a, b) => a + b, 0);
                  const wins = counts.WIN ?? counts.win ?? 0;
                  if (reviewed === 0) return null;
                  const pct = Math.round((wins / reviewed) * 100);
                  return (
                    <div className="mb-3 flex items-baseline gap-2">
                      <span className="font-mono text-2xl tabular-nums text-emerald-200">
                        {pct}%
                      </span>
                      <span className="text-[11px] text-[#faf9f6]/45">
                        improved — {wins} of {reviewed} reviewed
                      </span>
                    </div>
                  );
                })()}
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data!.reviewerOutcomes)
                    .sort((a, b) => b[1] - a[1])
                    .map(([v, n]) => {
                      const meta = verdictLabel(v);
                      return (
                        <span
                          key={v}
                          className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${meta.cls}`}
                        >
                          {meta.label}
                          <span className="font-mono tabular-nums opacity-80">
                            {n}
                          </span>
                        </span>
                      );
                    })}
                </div>
              </div>
            )}

            {/* End-to-end */}
            {data?.endToEnd && (
              <div className="mt-8">
                <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#faf9f6]/45">
                  End-to-end (first action → finished)
                </h2>
                <StatCard label="Idea lifetime" {...data.endToEnd} />
              </div>
            )}

            {/* In progress now — live status, auto-handled when stuck. */}
            <div className="mt-8">
              <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#faf9f6]/45">
                In progress now
              </h2>
              <p className="mb-3 text-[11px] text-[#faf9f6]/35">
                Ideas in a non-terminal state. Failed runs are auto-fixed and
                stale GPU runs auto-requeued — anything lingering past 1h is
                flagged <span className="text-orange-300">stuck</span> so you can
                see what the loop is still chewing on.
              </p>
              {(data?.inFlight ?? []).length === 0 ? (
                <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-5 text-center text-sm text-[#faf9f6]/40">
                  Nothing in flight.
                </p>
              ) : (
                <ul className="space-y-2">
                  {data!.inFlight.map((f) => (
                    <li
                      key={f.id}
                      className={`rounded-xl border px-4 py-3 ${
                        f.stuck
                          ? "border-orange-400/25 bg-orange-400/[0.06]"
                          : "border-white/10 bg-white/[0.03]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#faf9f6]">
                            {f.title}
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] text-[#faf9f6]/35">
                            {f.id} · {f.agent || "—"}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[#faf9f6]/65">
                            {f.label}
                          </span>
                          <span
                            className={`font-mono text-[11px] tabular-nums ${
                              f.stuck ? "text-orange-300" : "text-[#faf9f6]/50"
                            }`}
                          >
                            ⏱ {fmtDur(f.elapsedMs + liveDrift)}
                            {f.stuck ? " · stuck" : ""}
                          </span>
                        </div>
                      </div>
                      {f.note && (
                        <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-[#faf9f6]/45">
                          {f.note}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button
              type="button"
              onClick={onHome}
              className="mt-10 self-start text-xs uppercase tracking-[0.2em] text-[#faf9f6]/40 transition hover:text-[#faf9f6]/70"
            >
              ← Back to home
            </button>
          </>
        )}
      </div>
    </main>
  );
}
