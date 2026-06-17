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

type InFlight = {
  id: string;
  name: string | null;
  status: string | null;
  age_s: number | null;
  box: string | null;
  handle: string | null;
};
type RecentRun = {
  id: string;
  name: string | null;
  status: string | null;
  final_val_loss: number | null;
  verification: string | null;
  age_s: number | null;
  handle: string | null;
  box: string | null;
};
type Activity = {
  backend?: string;
  queue?: Record<string, number>;
  in_flight?: InFlight[];
  active_boxes?: { label: string | null; handle: string | null; in_flight: number }[];
  recent_runs?: RecentRun[];
  contributors?: { handle: string; role: string; runs_total: number; runs_recent: number }[];
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

function ago(s: number | null): string {
  if (s == null) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
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
  const [activity, setActivity] = useState<Activity | null>(null);
  const [live, setLive] = useState(true);

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

  // Live activity: poll the in-flight snapshot every 3s so the operator can
  // watch concurrent work stream in. Also re-pulls runs so finished work
  // appears without a manual refresh. Toggle off to stop polling.
  useEffect(() => {
    if (!live) return;
    let alive = true;
    const tick = async () => {
      const a = await fetchResource<Activity>('activity');
      if (alive && a.success) setActivity(a.data ?? null);
    };
    void tick();
    const iv = setInterval(() => {
      void tick();
      void load();
    }, 3000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [live, load]);

  const inFlight = activity?.in_flight ?? [];
  const q = activity?.queue ?? {};

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

        {health?.ok && (
          <section className="mb-8 rounded-lg border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[#faf9f6]/70">
                <span className={`inline-block h-2 w-2 rounded-full ${live ? 'animate-pulse bg-emerald-400' : 'bg-white/30'}`} />
                Live activity
              </h2>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-[#faf9f6]/50">
                  {(q['running'] ?? 0) + (q['claimed'] ?? 0)} in flight · {q['needs-run'] ?? 0} queued
                </span>
                <button
                  onClick={() => setLive((v) => !v)}
                  className="rounded border border-white/15 bg-white/5 px-2 py-1 hover:bg-white/10"
                >
                  {live ? 'Pause' : 'Go live'}
                </button>
              </div>
            </div>

            {/* status chips */}
            <div className="mb-4 flex flex-wrap gap-2 text-[11px]">
              {(['needs-run', 'claimed', 'running', 'done', 'failed'] as const).map((s) => (
                <span key={s} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                  <span className="font-semibold tabular-nums">{q[s] ?? 0}</span>
                  <span className="ml-1 text-[#faf9f6]/45">{s}</span>
                </span>
              ))}
            </div>

            {inFlight.length > 0 ? (
              <div className="mb-4 overflow-hidden rounded-md border border-white/10">
                <table className="w-full text-xs">
                  <thead className="bg-white/5 text-[10px] uppercase tracking-wide text-[#faf9f6]/45">
                    <tr>
                      <th className="px-3 py-1.5 text-left">working on</th>
                      <th className="px-3 py-1.5 text-left">status</th>
                      <th className="px-3 py-1.5 text-left">box</th>
                      <th className="px-3 py-1.5 text-left">who</th>
                      <th className="px-3 py-1.5 text-right">for</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inFlight.map((j) => (
                      <tr key={j.id} className="border-t border-white/5">
                        <td className="px-3 py-1.5 font-mono text-[#faf9f6]/80">{j.name ?? shortId(j.id)}</td>
                        <td className="px-3 py-1.5">
                          <span className={`rounded px-1.5 py-0.5 ${j.status === 'running' ? 'bg-emerald-400/15 text-emerald-200' : 'bg-amber-300/10 text-amber-200/90'}`}>
                            {j.status}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-[#faf9f6]/60">{j.box ?? '—'}</td>
                        <td className="px-3 py-1.5 text-[#faf9f6]/60">{j.handle ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[#faf9f6]/50">{ago(j.age_s)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mb-4 rounded-md border border-dashed border-white/10 px-3 py-3 text-center text-xs text-[#faf9f6]/40">
                nothing in flight right now
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1.5 text-[10px] uppercase tracking-wide text-[#faf9f6]/45">Active boxes</div>
                {(activity?.active_boxes ?? []).length > 0 ? (
                  <ul className="space-y-1 text-xs">
                    {activity!.active_boxes!.map((b, i) => (
                      <li key={i} className="flex justify-between rounded bg-white/5 px-2 py-1">
                        <span className="text-[#faf9f6]/75">{b.label ?? '—'}{b.handle ? ` · ${b.handle}` : ''}</span>
                        <span className="tabular-nums text-emerald-200/80">{b.in_flight} running</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-[#faf9f6]/35">no boxes busy</div>
                )}
              </div>
              <div>
                <div className="mb-1.5 text-[10px] uppercase tracking-wide text-[#faf9f6]/45">Contributors</div>
                {(activity?.contributors ?? []).length > 0 ? (
                  <ul className="space-y-1 text-xs">
                    {activity!.contributors!.map((c) => (
                      <li key={c.handle} className="flex justify-between rounded bg-white/5 px-2 py-1 hover:bg-white/10">
                        <Link
                          href={`/contributor?handle=${encodeURIComponent(c.handle)}`}
                          className="text-[#faf9f6]/75 hover:text-emerald-200 hover:underline"
                          title={`Open ${c.handle}'s dashboard`}
                        >
                          {c.handle} <span className="text-[#faf9f6]/35">{c.role}</span>
                        </Link>
                        <span className="tabular-nums text-[#faf9f6]/50">{c.runs_total} runs{c.runs_recent ? ` · ${c.runs_recent} recent` : ''}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-[#faf9f6]/35">no contributors yet</div>
                )}
              </div>
            </div>

            {(activity?.recent_runs ?? []).length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-[10px] uppercase tracking-wide text-[#faf9f6]/45">
                  Landed in the last 30 min
                </div>
                <ul className="space-y-1 text-xs">
                  {activity!.recent_runs!.map((r) => (
                    <li key={r.id} className="flex items-center justify-between rounded bg-white/5 px-2 py-1">
                      <span className="font-mono text-[#faf9f6]/75">{r.name ?? shortId(r.id)}</span>
                      <span className="flex items-center gap-3">
                        <span className="text-[#faf9f6]/45">{r.handle ?? '—'}</span>
                        <span className="tabular-nums text-[#faf9f6]/70">{fmt(r.final_val_loss)}</span>
                        <span className={`rounded border px-1 py-0.5 text-[10px] ${VERIF_CLS[r.verification ?? ''] ?? 'border-white/15 text-[#faf9f6]/50'}`}>
                          {r.verification ?? '—'}
                        </span>
                        <span className="text-[#faf9f6]/35">{ago(r.age_s)} ago</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
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
