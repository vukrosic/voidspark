'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

// ---- /contributor?handle=<h> ------------------------------------------------
// Per-contributor dashboard: a personal drill-down off the /voidbase
// contributors list. Three panels — my experiments (grouped by state), my
// stats (champion rate + average PAIRED delta), and my claimed threads (48h
// claim countdown). Everything is derived CLIENT-SIDE from the already-allowed
// read resources (no new voidbase endpoint): we join `activity` (the only place
// that links a run id -> handle) onto the full `runs`, `champions`, and
// `comparisons` collections. Runs/threads the activity snapshot doesn't link to
// a handle simply don't show up — this view is honest about what it can attribute.

type Envelope<T> = { success: boolean; data?: T; error?: string };

type Run = {
  id: string;
  thread_name: string | null;
  name: string | null;
  status: string | null;
  verification: string | null;
  final_val_loss: number | null;
  created_at: string | null;
};

type Champion = {
  run_id: string | null;
  scope: string | null;
  val_loss: number | null;
  promoted_by: string | null;
  promoted_at: string | null;
  superseded_at: string | null;
};

type Comparison = {
  run_id: string | null;
  delta_val_loss: number | null;
  is_paired: boolean;
  verdict: string | null;
};

type Thread = {
  name: string;
  hypothesis: string | null;
  status: string | null;
  priority: number | null;
  claimed_by?: string | null;
  claimed_at?: string | null;
  claim_expires_at?: string | null;
};

type Contributor = { handle: string; role: string; runs_total: number; runs_recent: number };

type ActivityRunRef = { id: string; name?: string | null; handle?: string | null };
type Activity = {
  in_flight?: ActivityRunRef[];
  recent_runs?: ActivityRunRef[];
  contributors?: Contributor[];
};

async function fetchResource<T>(resource: string): Promise<Envelope<T>> {
  const r = await fetch('/api/voidbase/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource }),
  });
  return r.json();
}

function fmt(n: number | null | undefined, digits = 4): string {
  return n === null || n === undefined || Number.isNaN(n) ? '—' : n.toFixed(digits);
}

function signed(n: number | null | undefined, digits = 4): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return (n > 0 ? '+' : '') + n.toFixed(digits);
}

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id;
}

// time-remaining on a 48h claim, from claim_expires_at (UTC ISO-ish from Neon).
function timeRemaining(expires: string | null | undefined): { label: string; expired: boolean } | null {
  if (!expires) return null;
  const t = Date.parse(expires.replace(' ', 'T'));
  if (Number.isNaN(t)) return null;
  const ms = t - Date.now();
  if (ms <= 0) return { label: 'expired', expired: true };
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return { label: h >= 1 ? `${h}h ${m}m left` : `${m}m left`, expired: false };
}

// Which bucket a run falls into. "in-confirm" = done but still unverified
// (awaiting the paired confirm); confirmed/rejected mirror the verification
// column; failed comes off status.
type Bucket = 'failed' | 'pending' | 'in-confirm' | 'confirmed' | 'rejected';

function bucketOf(r: Run): Bucket {
  const status = (r.status ?? '').toLowerCase();
  const verif = (r.verification ?? '').toLowerCase();
  if (verif === 'rejected') return 'rejected';
  if (verif === 'confirmed') return 'confirmed';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  if (status === 'done') return 'in-confirm'; // done but unverified
  return 'pending'; // needs-run / claimed / running
}

const BUCKETS: { key: Bucket; label: string; tone: string }[] = [
  { key: 'pending', label: 'Pending', tone: 'border-white/15 bg-white/5 text-[#faf9f6]/70' },
  { key: 'in-confirm', label: 'In confirm', tone: 'border-amber-300/30 bg-amber-300/10 text-amber-200/90' },
  { key: 'confirmed', label: 'Confirmed', tone: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200' },
  { key: 'rejected', label: 'Rejected', tone: 'border-red-400/40 bg-red-400/15 text-red-200' },
  { key: 'failed', label: 'Failed', tone: 'border-white/15 bg-white/5 text-[#faf9f6]/45' },
];

function StatCard({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-center">
      <div className="text-2xl font-semibold tabular-nums text-[#faf9f6]">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-[#faf9f6]/50">{label}</div>
      {hint && <div className="mt-0.5 text-[10px] text-[#faf9f6]/35">{hint}</div>}
    </div>
  );
}

function ContributorDashboard() {
  const params = useSearchParams();
  const handle = params.get('handle') ?? '';

  const [runs, setRuns] = useState<Run[]>([]);
  const [champions, setChampions] = useState<Champion[]>([]);
  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [a, r, c, cmp, t] = await Promise.all([
      fetchResource<Activity>('activity'),
      fetchResource<Run[]>('runs'),
      fetchResource<Champion[]>('champions'),
      fetchResource<Comparison[]>('comparisons'),
      fetchResource<Thread[]>('threads'),
    ]);
    if (!a.success && !r.success) {
      setError(a.error ?? r.error ?? 'voidbase API unreachable');
      setActivity(null);
      setRuns([]);
      setChampions([]);
      setComparisons([]);
      setThreads([]);
    } else {
      setError(null);
      setActivity(a.data ?? null);
      setRuns(r.data ?? []);
      setChampions(c.data ?? []);
      setComparisons(cmp.data ?? []);
      setThreads(t.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // run id -> handle, the only handle linkage in the allowed resources. Built
  // from the live activity snapshot (in-flight + recently landed runs).
  const runIdToHandle = useMemo(() => {
    const m = new Map<string, string>();
    for (const ref of [...(activity?.in_flight ?? []), ...(activity?.recent_runs ?? [])]) {
      if (ref.id && ref.handle) m.set(ref.id, ref.handle);
    }
    return m;
  }, [activity]);

  const myRunIds = useMemo(() => {
    const s = new Set<string>();
    for (const [id, h] of runIdToHandle) if (h === handle) s.add(id);
    return s;
  }, [runIdToHandle, handle]);

  const myRuns = useMemo(() => runs.filter((r) => myRunIds.has(r.id)), [runs, myRunIds]);

  const myContributor = useMemo(
    () => (activity?.contributors ?? []).find((c) => c.handle === handle) ?? null,
    [activity, handle],
  );

  // champions attributable to me: any champion whose run_id is one of my runs.
  const myChampions = useMemo(
    () => champions.filter((c) => c.run_id && myRunIds.has(c.run_id)),
    [champions, myRunIds],
  );

  // PAIRED comparisons only (never raw delta), for my runs.
  const myPairedDeltas = useMemo(
    () =>
      comparisons
        .filter((c) => c.is_paired && c.run_id && myRunIds.has(c.run_id) && c.delta_val_loss != null)
        .map((c) => c.delta_val_loss as number),
    [comparisons, myRunIds],
  );

  // claimed threads: claimed_by is a UUID upstream and we have no handle->UUID
  // map in the allowed resources, so we match against the handle string too —
  // if a future schema stores the handle here, this lights up automatically.
  const claimFieldsExist = useMemo(
    () => threads.some((t) => 'claimed_by' in t || 'claim_expires_at' in t),
    [threads],
  );
  const myThreads = useMemo(
    () => threads.filter((t) => t.claimed_by && t.claimed_by === handle),
    [threads, handle],
  );

  const grouped = useMemo(() => {
    const g: Record<Bucket, Run[]> = {
      pending: [], 'in-confirm': [], confirmed: [], rejected: [], failed: [],
    };
    for (const r of myRuns) g[bucketOf(r)].push(r);
    return g;
  }, [myRuns]);

  const doneCount = grouped['in-confirm'].length + grouped.confirmed.length + grouped.rejected.length;
  const championRate = doneCount > 0 ? (myChampions.length / doneCount) * 100 : null;
  const avgPaired =
    myPairedDeltas.length > 0
      ? myPairedDeltas.reduce((s, d) => s + d, 0) / myPairedDeltas.length
      : null;

  if (!handle) {
    return (
      <div className="min-h-screen bg-[#0b0b0d] px-6 py-10 text-[#faf9f6]">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-2xl font-semibold">Contributor dashboard</h1>
          <p className="mt-2 text-sm text-[#faf9f6]/55">
            No handle given. Pick a contributor from the{' '}
            <Link href="/voidbase" className="text-emerald-300 hover:underline">voidbase</Link> list,
            or open <code className="text-[#faf9f6]/80">/contributor?handle=&lt;handle&gt;</code>.
          </p>
          {(activity?.contributors ?? []).length > 0 && (
            <ul className="mt-6 space-y-1 text-sm">
              {activity!.contributors!.map((c) => (
                <li key={c.handle}>
                  <Link
                    href={`/contributor?handle=${encodeURIComponent(c.handle)}`}
                    className="text-emerald-300 hover:underline"
                  >
                    {c.handle}
                  </Link>{' '}
                  <span className="text-[#faf9f6]/40">· {c.runs_total} runs</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0b0d] px-6 py-8 text-[#faf9f6]">
      <div className="mx-auto max-w-4xl">
        {/* header */}
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-sm font-semibold text-emerald-200">
                {handle.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-semibold">{handle}</h1>
                <p className="text-sm text-[#faf9f6]/55">
                  {myContributor?.role ?? 'contributor'} · personal dashboard
                </p>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              onClick={() => void load()}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <Link href="/voidbase" className="text-sm text-[#faf9f6]/60 hover:text-[#faf9f6]">
              ← voidbase
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
            <div className="font-medium">voidbase API not reachable</div>
            <div className="mt-1 text-red-200/80">{error}</div>
          </div>
        )}

        {/* note: attribution is best-effort via the activity snapshot */}
        {!error && myRuns.length === 0 && (
          <div className="mb-6 rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-[#faf9f6]/55">
            No runs are currently attributed to <span className="text-[#faf9f6]/80">{handle}</span> in
            the live activity snapshot. Runs are linked to a handle as they go in-flight or land, so
            this fills in as {handle} runs experiments.
            {myContributor && (
              <span> Lifetime: {myContributor.runs_total} runs total.</span>
            )}
          </div>
        )}

        {/* ---- panel 2: my stats (top, the gamification strip) ---- */}
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#faf9f6]/70">
            My stats
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard value={String(myContributor?.runs_total ?? myRuns.length)} label="runs total" />
            <StatCard value={String(doneCount)} label="runs done" />
            <StatCard value={String(myChampions.length)} label="champions" />
            <StatCard
              value={championRate === null ? '—' : `${championRate.toFixed(0)}%`}
              label="champion rate"
              hint={doneCount > 0 ? `${myChampions.length}/${doneCount} done` : 'no done runs'}
            />
            <StatCard
              value={signed(avgPaired)}
              label="avg paired Δ"
              hint={myPairedDeltas.length > 0 ? `${myPairedDeltas.length} paired` : 'no paired cmps'}
            />
          </div>
          <p className="mt-2 text-[11px] text-[#faf9f6]/35">
            Champion rate = champions / done runs. Average Δ uses{' '}
            <span className="text-[#faf9f6]/55">paired comparisons only</span> (same seed, same box) —
            never raw deltas.
          </p>
        </section>

        {/* ---- panel 1: my experiments ---- */}
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#faf9f6]/70">
            My experiments ({myRuns.length})
          </h2>
          <div className="space-y-4">
            {BUCKETS.map((b) => {
              const items = grouped[b.key];
              if (items.length === 0) return null;
              return (
                <div key={b.key}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${b.tone}`}>
                      {b.label}
                    </span>
                    <span className="text-xs text-[#faf9f6]/40">{items.length}</span>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-white/10">
                    <table className="w-full text-sm">
                      <tbody>
                        {items.map((r) => (
                          <tr key={r.id} className="border-t border-white/5 first:border-t-0 hover:bg-white/5">
                            <td className="px-3 py-2">
                              <Link
                                href={`/voidbase?run=${encodeURIComponent(r.id)}`}
                                className="font-mono text-xs text-emerald-200/90 hover:underline"
                                title={r.id}
                              >
                                {r.name ?? shortId(r.id)}
                              </Link>
                            </td>
                            <td className="px-3 py-2 text-xs text-[#faf9f6]/55">{r.thread_name ?? '—'}</td>
                            <td className="px-3 py-2 text-right text-xs tabular-nums text-[#faf9f6]/70">
                              {fmt(r.final_val_loss)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
            {myRuns.length === 0 && (
              <div className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-xs text-[#faf9f6]/40">
                no attributed experiments yet
              </div>
            )}
          </div>
        </section>

        {/* ---- panel 3: my claimed threads ---- */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#faf9f6]/70">
            My claimed threads
          </h2>
          {!claimFieldsExist ? (
            <div className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-xs text-[#faf9f6]/40">
              Thread claims aren’t available yet.
            </div>
          ) : myThreads.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-xs text-[#faf9f6]/40">
              No threads claimed by {handle}. Claim one on the{' '}
              <Link href="/research" className="text-emerald-300 hover:underline">research board</Link>.
            </div>
          ) : (
            <div className="space-y-2">
              {myThreads.map((t) => {
                const rem = timeRemaining(t.claim_expires_at);
                return (
                  <div
                    key={t.name}
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3"
                  >
                    <div className="min-w-0">
                      <Link href="/research" className="font-medium hover:underline">
                        {t.name}
                      </Link>
                      {t.hypothesis && (
                        <p className="mt-0.5 truncate text-xs text-[#faf9f6]/55">{t.hypothesis}</p>
                      )}
                    </div>
                    {rem && (
                      <span
                        className={`shrink-0 rounded px-2 py-0.5 text-[11px] ${
                          rem.expired
                            ? 'border border-red-400/40 bg-red-400/10 text-red-200'
                            : 'border border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                        }`}
                      >
                        {rem.label}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function ContributorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0b0b0d]" />}>
      <ContributorDashboard />
    </Suspense>
  );
}
