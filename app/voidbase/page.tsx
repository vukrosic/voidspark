'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

// ---- voidbase view ----------------------------------------------------------
// First localhost wiring of voidspark -> voidbase. Reads the central registry
// through /api/voidbase (which proxies the voidbase API server). Read-only for
// now: health counts, recent runs, and the paired-delta comparisons table that
// surfaces the integrity model (is_paired) the new schema enforces.

type Health = {
  ok: boolean;
  db: string;
  backend?: string;
  counts?: Record<string, number>;
  error?: string;
};

type Run = {
  id: string;
  thread_name: string | null;
  name: string | null;
  seed: number | null;
  status: string | null;
  verification: string | null;
  verdict: string | null;
  final_val_loss: number | null;
  git_branch: string | null;
  created_at: string | null;
  has_eval?: boolean;
};

type EvalPoint = {
  step: number;
  val_loss: number | null;
};

type Comparison = {
  id: number;
  run_id: string | null;
  baseline_name: string | null;
  delta_val_loss: number | null;
  verdict: string | null;
  is_paired: boolean;
};

type Envelope<T> = { success: boolean; data?: T; error?: string; upstream?: string };

async function fetchResource<T>(resource: string, id?: string): Promise<Envelope<T>> {
  const r = await fetch('/api/voidbase/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(id ? { resource, id } : { resource }),
  });
  return r.json();
}

function fmt(n: number | null, digits = 4): string {
  return n === null || Number.isNaN(n) ? '—' : n.toFixed(digits);
}

function shortId(id: string): string {
  return id.length > 10 ? id.slice(0, 8) : id;
}

// Inline val-loss curve (step -> val_loss), no chart lib. Plots the registry's
// eval_points so a run's learning curve is visible right in the row.
function EvalCurve({ points }: { points: EvalPoint[] }) {
  const pts = points.filter((p) => p.val_loss != null) as { step: number; val_loss: number }[];
  if (pts.length < 2) {
    return <span className="text-xs text-[#faf9f6]/40">not enough eval points to plot</span>;
  }
  const W = 520;
  const H = 120;
  const pad = 6;
  const steps = pts.map((p) => p.step);
  const vals = pts.map((p) => p.val_loss);
  const xMin = Math.min(...steps);
  const xMax = Math.max(...steps);
  const yMin = Math.min(...vals);
  const yMax = Math.max(...vals);
  const x = (s: number) => pad + ((s - xMin) / (xMax - xMin || 1)) * (W - 2 * pad);
  const y = (v: number) => pad + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - 2 * pad);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.step).toFixed(1)} ${y(p.val_loss).toFixed(1)}`).join(' ');
  return (
    <div className="flex items-center gap-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full max-w-xl" preserveAspectRatio="none">
        <path d={d} fill="none" stroke="rgb(110 231 183)" strokeWidth={1.5} />
        {pts.map((p) => (
          <circle key={p.step} cx={x(p.step)} cy={y(p.val_loss)} r={1.6} fill="rgb(110 231 183)" />
        ))}
      </svg>
      <div className="shrink-0 text-xs text-[#faf9f6]/50">
        <div>{pts.length} pts</div>
        <div>val {fmt(yMax, 2)} → {fmt(yMin, 2)}</div>
        <div>step {xMin}–{xMax}</div>
      </div>
    </div>
  );
}

const VERIF_CLS: Record<string, string> = {
  confirmed: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200',
  unverified: 'border-amber-300/30 bg-amber-300/10 text-amber-200/90',
  rejected: 'border-red-400/40 bg-red-400/15 text-red-200',
};

export default function VoidbasePage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [evalCache, setEvalCache] = useState<Record<string, EvalPoint[]>>({});

  const toggleCurve = useCallback(
    async (runId: string) => {
      if (expanded === runId) {
        setExpanded(null);
        return;
      }
      setExpanded(runId);
      if (!evalCache[runId]) {
        const res = await fetchResource<EvalPoint[]>('eval', runId);
        setEvalCache((prev) => ({ ...prev, [runId]: res.data ?? [] }));
      }
    },
    [expanded, evalCache],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const [h, r, c] = await Promise.all([
      fetchResource<Health>('health'),
      fetchResource<Run[]>('runs'),
      fetchResource<Comparison[]>('comparisons'),
    ]);
    if (!h.success) {
      // API unreachable: show ONLY the banner — don't leave stale tables/counts
      // hanging around, which reads as "still working".
      setError(h.error ?? 'voidbase API unreachable');
      setHealth(null);
      setRuns([]);
      setComparisons([]);
      setExpanded(null);
    } else {
      setError(null);
      setHealth(h.data ?? null);
      setRuns(r.data ?? []);
      setComparisons(c.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen bg-[#0b0b0d] px-6 py-8 text-[#faf9f6]">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">voidbase</h1>
            <p className="text-sm text-[#faf9f6]/60">
              Central experiment registry — read-only localhost view via{' '}
              <code className="text-[#faf9f6]/80">/api/voidbase</code>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void load()}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <Link href="/" className="text-sm text-[#faf9f6]/60 hover:text-[#faf9f6]">
              ← cockpit
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
            <div className="font-medium">voidbase API not reachable</div>
            <div className="mt-1 text-red-200/80">{error}</div>
            <pre className="mt-2 rounded bg-black/30 p-2 text-xs text-red-200/70">
cd voidbase &amp;&amp; python3 api/server.py</pre>
          </div>
        )}

        {health?.ok && health.counts && (
          <div className="mb-8 grid grid-cols-3 gap-3 sm:grid-cols-7">
            {Object.entries(health.counts).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-white/10 bg-white/5 p-3 text-center">
                <div className="text-xl font-semibold">{v}</div>
                <div className="text-[11px] uppercase tracking-wide text-[#faf9f6]/50">{k}</div>
              </div>
            ))}
            <div className="col-span-3 self-center text-[11px] text-[#faf9f6]/40 sm:col-span-7">
              backend: {health.backend} · {health.db}
            </div>
          </div>
        )}

        {runs.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#faf9f6]/70">
              Runs ({runs.length})
            </h2>
            <div className="overflow-hidden rounded-lg border border-white/10">
              <table className="w-full text-sm">
                <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-[#faf9f6]/50">
                  <tr>
                    <th className="px-3 py-2 text-left">run</th>
                    <th className="px-3 py-2 text-left">thread</th>
                    <th className="px-3 py-2 text-right">seed</th>
                    <th className="px-3 py-2 text-right">val_loss</th>
                    <th className="px-3 py-2 text-left">status</th>
                    <th className="px-3 py-2 text-left">verification</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <Fragment key={r.id}>
                      <tr
                        className={`border-t border-white/5 ${
                          r.has_eval ? 'cursor-pointer hover:bg-white/5' : ''
                        } ${expanded === r.id ? 'bg-white/5' : ''}`}
                        onClick={r.has_eval ? () => void toggleCurve(r.id) : undefined}
                      >
                        <td className="px-3 py-2 font-mono text-xs text-[#faf9f6]/80">
                          {r.has_eval && (
                            <span className="mr-1 inline-block text-[#faf9f6]/40">
                              {expanded === r.id ? '▾' : '▸'}
                            </span>
                          )}
                          {r.name ?? shortId(r.id)}
                        </td>
                        <td className="px-3 py-2 text-[#faf9f6]/60">{r.thread_name ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.seed ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(r.final_val_loss)}</td>
                        <td className="px-3 py-2 text-[#faf9f6]/60">{r.status ?? '—'}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[11px] ${
                              VERIF_CLS[r.verification ?? ''] ?? 'border-white/15 text-[#faf9f6]/60'
                            }`}
                          >
                            {r.verification ?? '—'}
                          </span>
                        </td>
                      </tr>
                      {expanded === r.id && (
                        <tr className="border-t border-white/5 bg-black/20">
                          <td colSpan={6} className="px-4 py-4">
                            {evalCache[r.id] ? (
                              <EvalCurve points={evalCache[r.id]} />
                            ) : (
                              <span className="text-xs text-[#faf9f6]/40">loading curve…</span>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {comparisons.length > 0 && (
          <section>
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[#faf9f6]/70">
              Comparisons ({comparisons.length})
            </h2>
            <p className="mb-3 text-xs text-[#faf9f6]/45">
              <code>is_paired</code> = treatment &amp; baseline shared the same seed on the same box.
              Only paired deltas are trustworthy signal — legacy rows are unpaired.
            </p>
            <div className="overflow-hidden rounded-lg border border-white/10">
              <table className="w-full text-sm">
                <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-[#faf9f6]/50">
                  <tr>
                    <th className="px-3 py-2 text-left">run</th>
                    <th className="px-3 py-2 text-left">baseline</th>
                    <th className="px-3 py-2 text-right">Δ val_loss</th>
                    <th className="px-3 py-2 text-left">verdict</th>
                    <th className="px-3 py-2 text-center">paired?</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisons.map((c) => (
                    <tr key={c.id} className="border-t border-white/5">
                      <td className="px-3 py-2 font-mono text-xs text-[#faf9f6]/80">{shortId(c.run_id ?? '—')}</td>
                      <td className="px-3 py-2 text-[#faf9f6]/60">{c.baseline_name ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(c.delta_val_loss)}</td>
                      <td className="px-3 py-2 text-[#faf9f6]/60">{c.verdict ?? '—'}</td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[11px] ${
                            c.is_paired
                              ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200'
                              : 'border-white/15 bg-white/5 text-[#faf9f6]/50'
                          }`}
                        >
                          {c.is_paired ? 'paired' : 'unpaired'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
