'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { MarkdownPanel } from '@/components/markdown-panel';

// ---- Types ------------------------------------------------------------------
type LeaderboardRow = {
  id: string;
  title: string;
  tier: string;
  verdict: string;          // WIN | NULL | FAIL | DRIFT (uppercase)
  delta: number | null;
  controlVal: number | null;
  treatmentVal: number | null;
  ctrl2Val: number | null;
  date: string;
  updated: string;
  evidencePath: string;
  ideaPath: string;
  plain: string;
};

type Run = {
  role: 'control' | 'treatment' | 'control2';
  label: string;
  steps: number[];
  valLosses: number[];
};

// Match the verdict colours used elsewhere in the app (STATUS_META in
// app/page.tsx). DRIFT and FAIL both map to red so a "drift" verdict doesn't
// silently hide in the table.
const VERDICT_META: Record<string, { label: string; cls: string; dot: string }> = {
  WIN: { label: 'Win', cls: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200', dot: 'bg-emerald-400' },
  NULL: { label: 'Null', cls: 'border-white/20 bg-white/5 text-[#faf9f6]/70', dot: 'bg-[#faf9f6]/35' },
  FAIL: { label: 'Fail', cls: 'border-red-400/40 bg-red-400/15 text-red-200', dot: 'bg-red-400' },
  DRIFT: { label: 'Drift', cls: 'border-red-400/40 bg-red-400/15 text-red-200', dot: 'bg-red-400' },
};

function verdictMeta(v: string) {
  const k = v.toUpperCase();
  return (
    VERDICT_META[k] ?? {
      label: v || '—',
      cls: 'border-amber-300/25 bg-amber-300/5 text-amber-200/80',
      dot: 'bg-amber-300',
    }
  );
}

function fmt(n: number | null, digits = 4): string {
  return n === null || Number.isNaN(n) ? '—' : n.toFixed(digits);
}

function fmtDelta(n: number | null): string {
  if (n === null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(4)}`;
}

// Filter verbs from the spec: win / null / fail. DRIFT is included with FAIL
// because it's effectively a "negative" verdict — the user can still toggle it
// off if they only want clean wins/nulls.
const FILTER_VERDICTS = ['WIN', 'NULL', 'FAIL'] as const;
type FilterVerdict = (typeof FILTER_VERDICTS)[number];

type SortKey = 'delta-asc' | 'delta-desc' | 'verdict' | 'date-desc' | 'date-asc';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'delta-asc', label: 'Δ vs ctrl · best first' },
  { value: 'delta-desc', label: 'Δ vs ctrl · worst first' },
  { value: 'verdict', label: 'Verdict group · Δ inside' },
  { value: 'date-desc', label: 'Newest first' },
  { value: 'date-asc', label: 'Oldest first' },
];

// ---- Inline curve plot ------------------------------------------------------
// Tiny SVG line plot of val_loss over steps. No chart library — keeps the page
// lean and avoids a deps bump. Three runs (ctrl, treatment, ctrl2) overlaid.
function CurvePlot({ runs }: { runs: Run[] }) {
  const W = 320;
  const H = 120;
  const PAD = 8;
  if (runs.length === 0 || runs.every((r) => r.steps.length === 0)) {
    return (
      <div className="flex h-[120px] items-center justify-center text-xs text-[#faf9f6]/40">
        No curve data
      </div>
    );
  }
  const allSteps = runs.flatMap((r) => r.steps);
  const allLosses = runs.flatMap((r) => r.valLosses);
  const xMin = Math.min(...allSteps);
  const xMax = Math.max(...allSteps);
  const yMin = Math.min(...allLosses);
  const yMax = Math.max(...allLosses);
  const xR = xMax - xMin || 1;
  const yR = yMax - yMin || 1;

  const colors: Record<Run['role'], string> = {
    control: 'rgba(250,249,246,0.55)', // muted cream for ctrl
    control2: 'rgba(250,249,246,0.30)',
    treatment: 'rgba(251,191,36,0.95)', // amber for the experiment
  };

  return (
    <svg width={W} height={H} className="block">
      <rect x={0} y={0} width={W} height={H} fill="rgba(0,0,0,0.25)" rx={6} />
      {runs.map((r) => {
        if (r.steps.length === 0) return null;
        const pts = r.steps
          .map((s, i) => {
            const x = PAD + ((s - xMin) / xR) * (W - 2 * PAD);
            const y = PAD + (1 - (r.valLosses[i] - yMin) / yR) * (H - 2 * PAD);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ');
        return (
          <polyline
            key={r.role}
            points={pts}
            fill="none"
            stroke={colors[r.role]}
            strokeWidth={r.role === 'treatment' ? 1.6 : 1.1}
          />
        );
      })}
      <text x={PAD} y={H - 2} fontSize={9} fill="rgba(250,249,246,0.45)">
        {xMin}→{xMax} steps · Δ {fmtDelta(yMin - yMax)}
      </text>
    </svg>
  );
}

// ---- Page -------------------------------------------------------------------
export default function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [verdictFilter, setVerdictFilter] = useState<Set<FilterVerdict>>(
    () => new Set(FILTER_VERDICTS)
  );
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [sort, setSort] = useState<SortKey>('delta-asc');

  // Per-row UI state
  const [openEvidenceFor, setOpenEvidenceFor] = useState<string | null>(null);
  const [openCurveFor, setOpenCurveFor] = useState<string | null>(null);
  const [curveRuns, setCurveRuns] = useState<Run[]>([]);
  const [curveLoading, setCurveLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/leaderboard/', { method: 'POST' });
      const data = await res.json();
      if (data.success) setRows(data.rows ?? []);
      else setError(data.error ?? 'failed to load');
    } catch (e) {
      setError((e as Error).message ?? 'network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Tiers for the dropdown — derived from data so we don't hardcode.
  const tiers = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.tier) set.add(r.tier);
    return ['all', ...Array.from(set).sort()];
  }, [rows]);

  // Apply filter + sort. Verdict filter matches the button toggles — DRIFT
  // rides along with FAIL by default (and the FAIL toggle selects both).
  const visible = useMemo(() => {
    const filtered = rows.filter((r) => {
      const v = r.verdict.toUpperCase();
      if (v === 'WIN' && !verdictFilter.has('WIN')) return false;
      if (v === 'NULL' && !verdictFilter.has('NULL')) return false;
      if ((v === 'FAIL' || v === 'DRIFT') && !verdictFilter.has('FAIL')) return false;
      if (tierFilter !== 'all' && r.tier !== tierFilter) return false;
      return true;
    });

    const verdictRank: Record<string, number> = { WIN: 0, NULL: 1, FAIL: 2, DRIFT: 3 };
    const byDeltaAsc = (a: LeaderboardRow, b: LeaderboardRow) => {
      if (a.delta === null && b.delta === null) return 0;
      if (a.delta === null) return 1;
      if (b.delta === null) return -1;
      return a.delta - b.delta;
    };

    const sorted = [...filtered];
    switch (sort) {
      case 'delta-asc':
        sorted.sort(byDeltaAsc);
        break;
      case 'delta-desc':
        sorted.sort((a, b) => -byDeltaAsc(a, b));
        break;
      case 'verdict':
        sorted.sort((a, b) => {
          const va = verdictRank[a.verdict.toUpperCase()] ?? 99;
          const vb = verdictRank[b.verdict.toUpperCase()] ?? 99;
          if (va !== vb) return va - vb;
          return byDeltaAsc(a, b);
        });
        break;
      case 'date-desc':
        sorted.sort((a, b) => (b.date || b.updated).localeCompare(a.date || a.updated));
        break;
      case 'date-asc':
        sorted.sort((a, b) => (a.date || a.updated).localeCompare(b.date || b.updated));
        break;
    }
    return sorted;
  }, [rows, verdictFilter, tierFilter, sort]);

  const openCurve = useCallback(async (id: string) => {
    if (openCurveFor === id) {
      setOpenCurveFor(null);
      return;
    }
    setOpenCurveFor(id);
    setCurveLoading(true);
    setCurveRuns([]);
    try {
      const res = await fetch('/api/training-curve/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!data.error) setCurveRuns(data.runs ?? []);
    } finally {
      setCurveLoading(false);
    }
  }, [openCurveFor]);

  const toggleVerdict = (v: FilterVerdict) => {
    setVerdictFilter((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  };

  // Summary chips — quick counts at the top.
  const counts = useMemo(() => {
    const c = { win: 0, null: 0, fail: 0, drift: 0 };
    for (const r of rows) {
      const v = r.verdict.toUpperCase();
      if (v === 'WIN') c.win++;
      else if (v === 'NULL') c.null++;
      else if (v === 'FAIL') c.fail++;
      else if (v === 'DRIFT') c.drift++;
    }
    return c;
  }, [rows]);

  return (
    <div className="min-h-screen bg-[#1f1e1d] text-[#faf9f6]">
      <header className="border-b border-white/10 px-6 py-5">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.25em] text-[#faf9f6]/40">
              VoidSpark
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Finished Experiments — Leaderboard
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-[#faf9f6]/55">
              Every idea the reviewer has called WIN / NULL / FAIL or DRIFT, sorted by delta against
              its matched control. Click <span className="text-amber-200/80">Evidence</span> to
              open the full write-up, or <span className="text-amber-200/80">Curve</span> to overlay
              the val-loss trace against the control run.
            </p>
          </div>
          <Link
            href="/"
            className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs uppercase tracking-[0.18em] text-[#faf9f6]/55 transition hover:border-white/30 hover:text-[#faf9f6]"
          >
            ← Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {/* Summary chips */}
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          {([
            { key: 'WIN', count: counts.win, meta: VERDICT_META.WIN },
            { key: 'NULL', count: counts.null, meta: VERDICT_META.NULL },
            { key: 'FAIL', count: counts.fail, meta: VERDICT_META.FAIL },
            { key: 'DRIFT', count: counts.drift, meta: VERDICT_META.DRIFT },
          ] as const).map(({ key, count, meta }) => (
            <span
              key={key}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 ${meta.cls}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
              <span className="font-semibold">{meta.label}</span>
              <span className="text-[#faf9f6]/55">{count}</span>
            </span>
          ))}
          <button
            type="button"
            onClick={load}
            className="ml-auto rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#faf9f6]/55 transition hover:border-white/30 hover:text-[#faf9f6]"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {/* Filter bar */}
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#faf9f6]/40">
              Verdict
            </span>
            {FILTER_VERDICTS.map((v) => {
              const on = verdictFilter.has(v);
              const meta = VERDICT_META[v];
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => toggleVerdict(v)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
                    on
                      ? `${meta.cls}`
                      : 'border-white/10 bg-transparent text-[#faf9f6]/35 hover:border-white/20 hover:text-[#faf9f6]/60'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${on ? meta.dot : 'bg-[#faf9f6]/20'}`} />
                  {meta.label}
                </button>
              );
            })}
            {verdictFilter.has('FAIL') && counts.drift > 0 && (
              <span className="text-[10px] text-[#faf9f6]/35">
                (FAIL includes {counts.drift} drift)
              </span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#faf9f6]/40">
              Tier
            </span>
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[11px] text-[#faf9f6] focus:border-white/30 focus:outline-none"
            >
              {tiers.map((t) => (
                <option key={t} value={t}>
                  {t === 'all' ? 'All tiers' : t}
                </option>
              ))}
            </select>
            <span className="ml-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#faf9f6]/40">
              Sort
            </span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[11px] text-[#faf9f6] focus:border-white/30 focus:outline-none"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.04] text-[10px] uppercase tracking-[0.2em] text-[#faf9f6]/45">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Idea</th>
                <th className="px-3 py-3 text-left font-semibold">Tier</th>
                <th className="px-3 py-3 text-left font-semibold">Verdict</th>
                <th className="px-3 py-3 text-right font-semibold">Δ vs ctrl</th>
                <th className="px-3 py-3 text-right font-semibold">Control val</th>
                <th className="px-3 py-3 text-right font-semibold">Treatment val</th>
                <th className="px-3 py-3 text-left font-semibold">Date</th>
                <th className="px-3 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[#faf9f6]/40">
                    Loading leaderboard…
                  </td>
                </tr>
              )}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[#faf9f6]/40">
                    No finished experiments match the current filter.
                  </td>
                </tr>
              )}
              {visible.map((r) => {
                const meta = verdictMeta(r.verdict);
                const isOpen = openCurveFor === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className="bg-white/[0.015] align-top transition hover:bg-white/[0.04]">
                      <td className="px-4 py-3">
                        <div className="font-medium text-[#faf9f6]">{r.title}</div>
                        <div className="mt-0.5 line-clamp-2 text-[11px] text-[#faf9f6]/50">
                          {r.plain}
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px] text-[#faf9f6]/65">{r.tier}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${meta.cls}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                      </td>
                      <td className={`px-3 py-3 text-right font-mono text-[12px] ${r.delta !== null && r.delta < 0 ? 'text-emerald-300' : r.delta !== null && r.delta > 0 ? 'text-red-300' : 'text-[#faf9f6]/55'}`}>
                        {fmtDelta(r.delta)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-[12px] text-[#faf9f6]/65">
                        {fmt(r.controlVal)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-[12px] text-[#faf9f6]/85">
                        {fmt(r.treatmentVal)}
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px] text-[#faf9f6]/55">
                        {r.date || '—'}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setOpenEvidenceFor(r.evidencePath)}
                            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#faf9f6]/70 transition hover:border-amber-300/40 hover:text-amber-200"
                          >
                            Evidence
                          </button>
                          <button
                            type="button"
                            onClick={() => openCurve(r.id)}
                            className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition ${
                              isOpen
                                ? 'border-amber-300/50 bg-amber-300/15 text-amber-100'
                                : 'border-white/10 bg-white/[0.04] text-[#faf9f6]/70 hover:border-amber-300/40 hover:text-amber-200'
                            }`}
                          >
                            {isOpen ? 'Hide curve' : 'Curve'}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-black/30">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="flex items-start gap-4">
                            <div className="shrink-0">
                              {curveLoading ? (
                                <div className="flex h-[120px] w-[320px] items-center justify-center text-xs text-[#faf9f6]/40">
                                  Loading curve…
                                </div>
                              ) : (
                                <CurvePlot runs={curveRuns} />
                              )}
                            </div>
                            <div className="flex-1 text-[11px] leading-relaxed text-[#faf9f6]/55">
                              <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#faf9f6]/40">
                                Run roles
                              </div>
                              <div className="grid grid-cols-3 gap-3 text-[11px]">
                                {(['control', 'treatment', 'control2'] as const).map((role) => {
                                  const r2 = curveRuns.find((x) => x.role === role);
                                  return (
                                    <div key={role}>
                                      <div className="font-mono text-[#faf9f6]/70">{role}</div>
                                      <div className="text-[#faf9f6]/40">
                                        {r2 ? `${r2.steps.length} steps` : 'no data'}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {!loading && rows.length > 0 && (
          <div className="mt-3 text-[11px] text-[#faf9f6]/35">
            Showing {visible.length} of {rows.length} finished experiments.
          </div>
        )}
      </main>

      <MarkdownPanel
        path={openEvidenceFor}
        title={openEvidenceFor ?? ''}
        onClose={() => setOpenEvidenceFor(null)}
      />
    </div>
  );
}