'use client';

import { useCallback, useEffect, useState } from 'react';
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

async function fetchResource<T>(resource: string): Promise<Envelope<T>> {
  const r = await fetch('/api/voidbase/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource }),
  });
  return r.json();
}

function fmt(n: number | null, digits = 4): string {
  return n === null || Number.isNaN(n) ? '—' : n.toFixed(digits);
}

function shortId(id: string): string {
  return id.length > 10 ? id.slice(0, 8) : id;
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

  const load = useCallback(async () => {
    setLoading(true);
    const [h, r, c] = await Promise.all([
      fetchResource<Health>('health'),
      fetchResource<Run[]>('runs'),
      fetchResource<Comparison[]>('comparisons'),
    ]);
    if (!h.success) {
      setError(h.error ?? 'voidbase API unreachable');
      setHealth(null);
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
                    <tr key={r.id} className="border-t border-white/5">
                      <td className="px-3 py-2 font-mono text-xs text-[#faf9f6]/80">{r.name ?? shortId(r.id)}</td>
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
