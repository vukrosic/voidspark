'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

// ---- /gallery — Mechanism Gallery / Champion Lineage ------------------------
// This is NOT the per-experiment leaderboard (app/leaderboard) which lists every
// WIN/NULL/FAIL idea. This page shows the *champion lineage*: the chain of
// promotions over time — each new champion, who invented it, its val loss, and
// how much it improved on the champion it replaced. It's the strongest
// recruiting signal we have: "real people's ideas became part of the model."
//
// Data is derived CLIENT-SIDE from the already-allowed resources
// (champions ⨝ runs, plus the activity contributor list) — no new voidbase
// endpoint. See the TODO below: a server-side `GET /lineage` (champions ⨝ runs
// ⨝ contributors, ordered by promoted_at, delta computed server-side) would be
// cleaner and would carry the inventor handle directly. Today the `runs`
// resource does not expose contributor_id/handle, so inventor attribution is
// best-effort (matched via the activity contributor/recent-run lists) and falls
// back to "anonymous" when it can't be resolved.
//
// TODO(voidbase): add `GET /lineage` to voidbase/api/server.py returning
//   champions joined to runs and contributors (run.name, contributors.handle,
//   git_branch/commit) ordered by promoted_at, with prev-champion delta computed
//   server-side; then add 'lineage' to the proxy ALLOWED set and read it here.

type Envelope<T> = { success: boolean; data?: T; error?: string };

async function fetchResource<T>(resource: string): Promise<Envelope<T>> {
  const r = await fetch('/api/voidbase/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource }),
  });
  return r.json();
}

// champions row, per db/schema.sql
type Champion = {
  id: number;
  scope: string;
  run_id: string | null;
  val_loss: number | null;
  promoted_by: string | null;
  promoted_at: string | null;
  superseded_at: string | null;
  reason: string | null;
};

// runs row, per voidbase/api/server.py runs()
type Run = {
  id: string;
  name: string | null;
  thread_name: string | null;
  final_val_loss: number | null;
  git_branch: string | null;
  git_commit: string | null;
  created_at: string | null;
};

// activity.recent_runs / contributors carry the only run->handle hints available
// in the allowed resources today.
type Activity = {
  recent_runs?: { id: string; name: string | null; handle: string | null }[];
  contributors?: { handle: string; role: string }[];
};

// A resolved lineage entry — one champion with its run + inventor + delta.
type LineageEntry = {
  champion: Champion;
  runName: string;
  handle: string | null;
  valLoss: number | null;
  deltaVsPrev: number | null; // val_loss(this) - val_loss(prev champion); negative = improvement
  prLink: string | null;
};

function fmt(n: number | null, digits = 4): string {
  return n == null || Number.isNaN(n) ? '—' : n.toFixed(digits);
}

function fmtDelta(n: number | null): string {
  if (n == null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(4)}`;
}

function shortId(id: string | null): string {
  if (!id) return '—';
  return id.length > 10 ? id.slice(0, 8) : id;
}

// Relative "Xago" timestamp, matching the language used across the app.
function ago(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Build a github compare/commit URL when we can. The runs resource exposes a
// branch and commit but not the repo, so we link to the universe-lm repo where
// experiment code lives. Commit link is the most stable.
const EXPERIMENT_REPO = 'https://github.com/vukrosic/universe-lm';
function prLinkFor(run: Run | undefined): string | null {
  if (!run) return null;
  if (run.git_commit) return `${EXPERIMENT_REPO}/commit/${run.git_commit}`;
  if (run.git_branch && run.git_branch !== 'main') {
    return `${EXPERIMENT_REPO}/tree/${run.git_branch}`;
  }
  return null;
}

export default function GalleryPage() {
  const [champions, setChampions] = useState<Champion[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [c, r, a] = await Promise.all([
      fetchResource<Champion[]>('champions'),
      fetchResource<Run[]>('runs'),
      fetchResource<Activity>('activity'),
    ]);
    if (!c.success) {
      setError(c.error ?? 'voidbase API unreachable');
      setChampions([]);
      setRuns([]);
      setActivity(null);
      setLoading(false);
      return;
    }
    setChampions(c.data ?? []);
    setRuns(r.success ? r.data ?? [] : []);
    setActivity(a.success ? a.data ?? null : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Derive the lineage client-side: order champions oldest->newest by
  // promoted_at so each delta is computed against the previous champion, then
  // present newest-first.
  const lineage = useMemo<LineageEntry[]>(() => {
    if (champions.length === 0) return [];

    const runById = new Map<string, Run>();
    for (const r of runs) runById.set(r.id, r);

    // Best-effort run_id -> handle from the activity snapshot's recent runs.
    const handleByRunId = new Map<string, string>();
    for (const rr of activity?.recent_runs ?? []) {
      if (rr.id && rr.handle) handleByRunId.set(rr.id, rr.handle);
    }

    // Oldest first so delta is "this vs the one it replaced".
    const asc = [...champions].sort((a, b) => {
      const ta = a.promoted_at ? Date.parse(a.promoted_at) : 0;
      const tb = b.promoted_at ? Date.parse(b.promoted_at) : 0;
      return ta - tb;
    });

    const built: LineageEntry[] = asc.map((champ, i) => {
      const run = champ.run_id ? runById.get(champ.run_id) : undefined;
      const valLoss = champ.val_loss ?? run?.final_val_loss ?? null;
      const prev = asc[i - 1];
      const prevVal = prev ? prev.val_loss ?? null : null;
      const deltaVsPrev =
        valLoss != null && prevVal != null ? valLoss - prevVal : null;
      const handle = champ.run_id ? handleByRunId.get(champ.run_id) ?? null : null;
      return {
        champion: champ,
        runName: run?.name ?? (champ.run_id ? shortId(champ.run_id) : champ.scope),
        handle,
        valLoss,
        deltaVsPrev,
        prLink: prLinkFor(run),
      };
    });

    // Present newest first.
    return built.reverse();
  }, [champions, runs, activity]);

  // Headline strip: current champion val loss, count, cumulative improvement
  // (first champion val_loss - current val_loss; positive = total gain).
  const headline = useMemo(() => {
    if (lineage.length === 0) {
      return { current: null as number | null, count: 0, cumulative: null as number | null };
    }
    const current = lineage[0]?.valLoss ?? null; // newest first
    const firstVal = lineage[lineage.length - 1]?.valLoss ?? null;
    const cumulative =
      current != null && firstVal != null ? firstVal - current : null;
    return { current, count: lineage.length, cumulative };
  }, [lineage]);

  return (
    <div className="min-h-screen bg-[#0b0b0d] px-6 py-10 text-[#faf9f6]">
      <div className="mx-auto max-w-4xl">
        {/* nav */}
        <div className="mb-10 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-emerald-400/20 text-emerald-300">◆</span>
            voidbase
          </div>
          <div className="flex items-center gap-4 text-[#faf9f6]/55">
            <Link href="/leaderboard" className="hover:text-[#faf9f6]">All experiments</Link>
            <Link href="/voidbase" className="hover:text-[#faf9f6]">Browse the record</Link>
            <Link href="/contribute" className="hover:text-[#faf9f6]">Contribute</Link>
            <Link href="/" className="hover:text-[#faf9f6]">Cockpit</Link>
          </div>
        </div>

        {/* hero */}
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-medium text-emerald-200">
          <Trophy /> mechanism gallery · champion lineage
        </div>
        <h1 className="max-w-2xl text-3xl font-semibold leading-tight tracking-tight">
          Ideas that became the model.
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] text-[#faf9f6]/60">
          Every promotion that moved the record — newest first — with the
          mechanism, who invented it, and how much it improved on the champion it
          replaced. Each champion had to be paired and independently reproduced
          before it counted. Want to see every experiment (including the nulls
          and fails)? That&apos;s the{' '}
          <Link href="/leaderboard" className="text-emerald-300 hover:underline">
            full leaderboard
          </Link>
          .
        </p>

        {/* headline strip */}
        <div className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:grid-cols-3">
          {[
            { value: fmt(headline.current), label: 'current champion val-loss' },
            { value: String(headline.count), label: 'champions promoted' },
            {
              value:
                headline.cumulative != null
                  ? `−${headline.cumulative.toFixed(4)}`
                  : '—',
              label: 'total improvement since first',
            },
          ].map((s) => (
            <div key={s.label} className="bg-[#0b0b0d] px-4 py-5 text-center">
              <div className="text-2xl font-semibold tabular-nums text-[#faf9f6]">{s.value}</div>
              <div className="mt-1 text-[11px] uppercase tracking-wide text-[#faf9f6]/45">{s.label}</div>
            </div>
          ))}
        </div>

        {/* error */}
        {error && (
          <div className="mt-8 rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
            <div className="font-medium">voidbase API not reachable</div>
            <div className="mt-1 text-red-200/80">{error}</div>
            <pre className="mt-2 rounded bg-black/30 p-2 text-xs text-red-200/70">
cd voidbase &amp;&amp; python3 api/server.py</pre>
          </div>
        )}

        {/* refresh */}
        <div className="mt-8 mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#faf9f6]/55">
            The lineage
          </h2>
          <button
            onClick={() => void load()}
            className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {/* lineage timeline */}
        {!error && loading && lineage.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-[#faf9f6]/40">
            Loading champion lineage…
          </div>
        )}
        {!error && !loading && lineage.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-[#faf9f6]/40">
            No champions promoted yet. The first idea to survive reproduction lands here.
          </div>
        )}

        <ol className="relative space-y-4 border-l border-white/10 pl-6">
          {lineage.map((e, i) => {
            const isCurrent = i === 0; // newest first
            const improved = e.deltaVsPrev != null && e.deltaVsPrev < 0;
            const worsened = e.deltaVsPrev != null && e.deltaVsPrev > 0;
            return (
              <li key={e.champion.id} className="relative">
                {/* timeline node */}
                <span
                  className={`absolute -left-[31px] top-2 inline-flex h-3 w-3 items-center justify-center rounded-full border ${
                    isCurrent
                      ? 'border-emerald-400 bg-emerald-400'
                      : 'border-white/30 bg-[#0b0b0d]'
                  }`}
                />
                <div
                  className={`rounded-2xl border p-5 transition hover:bg-white/[0.04] ${
                    isCurrent
                      ? 'border-emerald-400/40 bg-emerald-400/[0.06]'
                      : 'border-white/10 bg-white/[0.03]'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {isCurrent && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
                            <Trophy /> current
                          </span>
                        )}
                        <h3 className="truncate font-mono text-base font-semibold text-[#faf9f6]">
                          {e.runName}
                        </h3>
                      </div>
                      <div className="mt-1 text-[13px] text-[#faf9f6]/55">
                        invented by{' '}
                        {e.handle ? (
                          <span className="font-medium text-[#faf9f6]/85">@{e.handle}</span>
                        ) : (
                          <span className="italic text-[#faf9f6]/45">anonymous</span>
                        )}
                        {' · '}
                        {ago(e.champion.promoted_at)}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-5 text-right">
                      <div>
                        <div className="text-lg font-semibold tabular-nums text-[#faf9f6]">
                          {fmt(e.valLoss)}
                        </div>
                        <div className="text-[10px] uppercase tracking-wide text-[#faf9f6]/40">val-loss</div>
                      </div>
                      <div>
                        <div
                          className={`text-lg font-semibold tabular-nums ${
                            improved
                              ? 'text-emerald-300'
                              : worsened
                                ? 'text-red-300'
                                : 'text-[#faf9f6]/50'
                          }`}
                        >
                          {fmtDelta(e.deltaVsPrev)}
                        </div>
                        <div className="text-[10px] uppercase tracking-wide text-[#faf9f6]/40">
                          {i === lineage.length - 1 ? 'first champion' : 'Δ vs previous'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {e.champion.reason && (
                    <p className="mt-3 border-t border-white/5 pt-3 text-[13px] leading-relaxed text-[#faf9f6]/65">
                      {e.champion.reason}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-[#faf9f6]/45">
                    {e.champion.scope && (
                      <span>
                        scope <span className="text-[#faf9f6]/70">{e.champion.scope}</span>
                      </span>
                    )}
                    {e.champion.run_id && (
                      <span>
                        run <span className="font-mono text-[#faf9f6]/70">{shortId(e.champion.run_id)}</span>
                      </span>
                    )}
                    {e.prLink && (
                      <a
                        href={e.prLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-300/80 hover:text-emerald-200 hover:underline"
                      >
                        view experiment code ↗
                      </a>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {/* footer cross-link */}
        <div className="mt-12 flex items-center justify-between border-t border-white/10 pt-6 text-[13px] text-[#faf9f6]/45">
          <span>Your idea could be the next entry.</span>
          <Link
            href="/contribute"
            className="inline-flex items-center gap-1 text-[#faf9f6]/70 hover:text-[#faf9f6]"
          >
            Contribute an idea ↗
          </Link>
        </div>
      </div>
    </div>
  );
}

// Tiny inline trophy glyph so we don't add an icon import dependency just for
// this page (lucide is available, but the gallery only needs one mark).
function Trophy() {
  return <span aria-hidden className="text-[12px] leading-none">🏆</span>;
}
