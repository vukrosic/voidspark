'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Cpu, GitPullRequest, FlaskConical, ArrowRight, ShieldCheck, GitMerge,
  CircleDot, Trophy, Server, Coins, ListChecks, Compass,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

// ---- /contribute ------------------------------------------------------------
// The entry point for the distributed platform: the three ways to contribute
// (compute / tokens / research) and the integrity pipeline that connects them.
// UI-first / design pass — the contribution CTAs are wired to the read API for
// live numbers; the write actions (connect box, submit idea) are stubbed until
// the voidbase write-path lands. Everything funnels through the curation gate:
// nothing runs on a GPU or moves the champion without operator approval.

type Envelope<T> = { success: boolean; data?: T; error?: string };

async function fetchResource<T>(resource: string): Promise<Envelope<T>> {
  const r = await fetch('/api/voidbase/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource }),
  });
  return r.json();
}

type Health = { ok: boolean; counts?: Record<string, number> };
type Champion = { scope: string; val_loss: number | null; run_id: string | null };

// The live activity feed (voidbase /activity, Postgres-only). recent_runs is
// what lands here — runs that hit the registry in the last 30 min, each tagged
// with the contributor handle (null → "anonymous" until #14's attribution
// flows through). in_flight is what a donor box is training right now.
type RecentRun = {
  id: string;
  name: string | null;
  status: string | null;
  final_val_loss: number | null;
  verification: string | null;
  age_s: number | null;
  handle: string | null;
};
type InFlight = { id: string; name: string | null; age_s: number | null; handle: string | null };
type Activity = { recent_runs?: RecentRun[]; in_flight?: InFlight[] };

// Relative age, matching the /voidbase view's `ago()` (seconds → s/m/h).
function ago(s: number | null): string {
  if (s == null) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

// Verification → colour, so a reproduced result reads green at a glance.
const VERIF_CLS: Record<string, string> = {
  confirmed: 'border-emerald-400/40 text-emerald-300',
  rejected: 'border-rose-400/40 text-rose-300',
  unverified: 'border-amber-300/30 text-amber-200/80',
};

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-semibold tabular-nums text-[#faf9f6]">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-[#faf9f6]/45">{label}</div>
    </div>
  );
}

// One contribution path: icon, pitch, the begin→end steps, and a CTA.
function PathCard({
  icon, accent, title, pitch, steps, cta, onCta,
}: {
  icon: React.ReactNode;
  accent: string;
  title: string;
  pitch: string;
  steps: string[];
  cta: string;
  onCta: () => void;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-white/20 hover:bg-white/[0.05]">
      <div className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl ${accent}`}>
        {icon}
      </div>
      <h3 className="text-base font-semibold text-[#faf9f6]">{title}</h3>
      <p className="mt-1 text-sm text-[#faf9f6]/55">{pitch}</p>
      <ol className="mt-4 flex-1 space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px] text-[#faf9f6]/70">
            <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] tabular-nums text-[#faf9f6]/60">
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
      <button
        onClick={onCta}
        className="mt-5 inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-medium text-[#faf9f6] transition hover:bg-white/10"
      >
        {cta} <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

// The integrity spine — every contribution travels this left→right.
function PipelineStage({
  icon, label, sub, tone,
}: { icon: React.ReactNode; label: string; sub: string; tone: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full border ${tone}`}>
        {icon}
      </div>
      <div className="text-xs font-medium text-[#faf9f6]">{label}</div>
      <div className="mt-0.5 max-w-[7.5rem] text-[10px] leading-tight text-[#faf9f6]/45">{sub}</div>
    </div>
  );
}

export default function ContributePage() {
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [champion, setChampion] = useState<Champion | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  // null until the first poll resolves → lets us show a "waiting for the loop"
  // line instead of flashing an empty feed on load.
  const [activityLoaded, setActivityLoaded] = useState(false);

  const load = useCallback(async () => {
    const [h, c] = await Promise.all([
      fetchResource<Health>('health'),
      fetchResource<Champion[]>('champions'),
    ]);
    if (h.success) setCounts(h.data?.counts ?? null);
    if (c.success && c.data && c.data.length) setChampion(c.data[0]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Live activity ticker: poll the recent-runs snapshot every 20s so a visitor
  // sees the loop actually moving — the strongest "this lab is alive" signal on
  // the front door. Pauses while the tab is hidden (no point hammering the proxy
  // for a page nobody's watching).
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      if (document.hidden) return;
      const a = await fetchResource<Activity>('activity');
      if (a.success && a.data) setActivity(a.data);
      setActivityLoaded(true);
    };
    const start = () => { if (!interval) { void tick(); interval = setInterval(tick, 20000); } };
    const stop = () => { if (interval) clearInterval(interval); interval = null; };
    const onVis = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVis);
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const champVal = champion?.val_loss != null ? champion.val_loss.toFixed(4) : '6.1720';

  return (
    <div className="min-h-screen bg-[#0b0b0d] px-6 py-10 text-[#faf9f6]">
      <div className="mx-auto max-w-5xl">
        {/* nav */}
        <div className="mb-10 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-emerald-400/20 text-emerald-300">◆</span>
            voidbase
          </div>
          <div className="flex items-center gap-4 text-[#faf9f6]/55">
            <Link href="/gallery" className="hover:text-[#faf9f6]">Champion lineage</Link>
            <Link href="/voidbase" className="hover:text-[#faf9f6]">Browse the record</Link>
            <Link href="/leaderboard" className="hover:text-[#faf9f6]">Leaderboard</Link>
            <Link href="/" className="hover:text-[#faf9f6]">Cockpit</Link>
          </div>
        </div>

        {/* hero */}
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-medium text-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> open distributed lab · localhost preview
        </div>
        <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight">
          A research lab anyone can power.
        </h1>
        <p className="mt-3 max-w-xl text-[15px] text-[#faf9f6]/60">
          voidbase searches for better language-model architectures, one paired experiment at a
          time. Donate a GPU, donate tokens, or submit research — and every result is independently
          reproduced before it’s allowed to move the record.
        </p>

        {/* live strip */}
        <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:grid-cols-4">
          {[
            { value: champVal, label: 'champion val-loss' },
            { value: String(counts?.runs ?? 11), label: 'experiments' },
            { value: String(counts?.comparisons ?? 14), label: 'paired comparisons' },
            { value: '1', label: 'GPUs online' },
          ].map((s) => (
            <div key={s.label} className="bg-[#0b0b0d] px-4 py-5">
              <Stat value={s.value} label={s.label} />
            </div>
          ))}
        </div>

        {/* live activity ticker — proof the loop is moving right now */}
        {(() => {
          const inFlight = activity?.in_flight ?? [];
          const recent = activity?.recent_runs ?? [];
          const hasFeed = inFlight.length > 0 || recent.length > 0;
          return (
            <div className="mt-8 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
                <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[#faf9f6]/55">
                  <span className="relative flex h-2 w-2">
                    {hasFeed && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
                    )}
                    <span className={`relative inline-flex h-2 w-2 rounded-full ${hasFeed ? 'bg-emerald-400' : 'bg-[#faf9f6]/25'}`} />
                  </span>
                  Live activity
                </span>
                <span className="text-[10px] text-[#faf9f6]/35">updates every 20s</span>
              </div>
              <div className="divide-y divide-white/5">
                {inFlight.slice(0, 3).map((j) => (
                  <div key={`f-${j.id}`} className="flex items-center justify-between px-4 py-2 text-[13px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 rounded border border-sky-400/40 px-1.5 py-0.5 text-[10px] text-sky-300">training</span>
                      <span className="truncate font-mono text-[#faf9f6]/80">{j.name ?? j.id.slice(0, 8)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3 text-[#faf9f6]/45">
                      <span>{j.handle ?? 'anonymous'}</span>
                      <span className="tabular-nums text-[#faf9f6]/35">{ago(j.age_s)}</span>
                    </span>
                  </div>
                ))}
                {recent.slice(0, 6).map((r) => (
                  <div key={`r-${r.id}`} className="flex items-center justify-between px-4 py-2 text-[13px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-mono text-[#faf9f6]/80">{r.name ?? r.id.slice(0, 8)}</span>
                      {r.final_val_loss != null && (
                        <span className="shrink-0 tabular-nums text-[#faf9f6]/55">{r.final_val_loss.toFixed(4)}</span>
                      )}
                      <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${VERIF_CLS[r.verification ?? ''] ?? 'border-white/15 text-[#faf9f6]/45'}`}>
                        {r.verification ?? '—'}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3 text-[#faf9f6]/45">
                      <span>{r.handle ?? 'anonymous'}</span>
                      <span className="tabular-nums text-[#faf9f6]/35">{ago(r.age_s)} ago</span>
                    </span>
                  </div>
                ))}
                {!hasFeed && (
                  <div className="px-4 py-3 text-[13px] text-[#faf9f6]/40">
                    {activityLoaded
                      ? 'The loop is quiet right now — runs will stream in here as boxes train and report.'
                      : 'Loading the live feed…'}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* new-contributor onramp — the research path expanded into 6 guided steps */}
        <Link
          href="/onboarding"
          className="mt-8 flex items-center justify-between gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/[0.07] px-4 py-3 transition hover:border-emerald-400/50 hover:bg-emerald-400/10"
        >
          <span className="flex items-center gap-2.5 text-sm text-[#faf9f6]/85">
            <Compass className="h-4 w-4 text-emerald-300" />
            New here? Follow the guided onboarding — clone, read the champion, pick a thread, open your first PR.
            <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[11px] font-medium text-cyan-200">
              ~2 hours
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-emerald-200">
            Start <ArrowRight className="h-4 w-4" />
          </span>
        </Link>

        {/* ideas that became champion — recruiting signal, surfaced first */}
        <Link
          href="/gallery"
          className="mt-10 flex items-center justify-between gap-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.06] px-5 py-4 transition hover:border-emerald-400/60 hover:bg-emerald-400/10"
        >
          <div className="flex items-center gap-3">
            <Trophy className="h-5 w-5 shrink-0 text-emerald-300" />
            <div>
              <div className="text-sm font-semibold text-[#faf9f6]">Here are ideas that became champion</div>
              <div className="text-[13px] text-[#faf9f6]/55">
                Real contributors&apos; mechanisms that moved the record — see the champion lineage,
                with each inventor credited.
              </div>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-emerald-300" />
        </Link>

        {/* three paths */}
        <h2 className="mb-4 mt-12 text-sm font-semibold uppercase tracking-wide text-[#faf9f6]/50">
          Three ways to contribute
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <PathCard
            icon={<Cpu className="h-5 w-5 text-emerald-300" />}
            accent="bg-emerald-400/15"
            title="Donate compute"
            pitch="Point a spare GPU at the queue. It claims approved jobs, trains, and pushes results — fully sandboxed."
            steps={[
              'Install the runner (one command)',
              'Register your box — it self-fingerprints',
              'It claims a queued experiment & trains',
              'Results push back, attributed to you',
            ]}
            cta="Connect a GPU"
            onCta={() => router.push('/contribute/compute')}
          />
          <PathCard
            icon={<GitPullRequest className="h-5 w-5 text-violet-300" />}
            accent="bg-violet-400/15"
            title="Write experiments"
            pitch="Bring your own AI. Turn a research brief into experiment code and open a pull request — your tokens, your tools, our review gate."
            steps={[
              'Claim an open brief (a topic + prompt)',
              'Run it in your AI — Claude, Codex, anything',
              'It writes the experiment code + run spec',
              'Open a PR — a maintainer reviews & merges',
            ]}
            cta="Browse briefs"
            onCta={() => router.push('/contribute/write')}
          />
          <PathCard
            icon={<FlaskConical className="h-5 w-5 text-sky-300" />}
            accent="bg-sky-400/15"
            title="Propose research"
            pitch="Have a hypothesis? Propose a falsifiable lever. It becomes a brief someone codes, a box runs, and — if it survives reproduction — the record, with your name on it."
            steps={[
              'Browse the open record',
              'Propose an idea (a falsifiable lever)',
              'It becomes a brief others can code',
              'Reproduced → it can become champion',
            ]}
            cta="Start onboarding"
            onCta={() => router.push('/onboarding')}
          />
        </div>

        {/* integrity pipeline */}
        <h2 className="mb-1 mt-14 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[#faf9f6]/50">
          <ShieldCheck className="h-4 w-4 text-emerald-300" /> How a result earns the record
        </h2>
        <p className="mb-6 max-w-2xl text-[13px] text-[#faf9f6]/50">
          The gate is the product. Anyone can submit and anyone can compute, but a result only counts
          when it’s <span className="text-[#faf9f6]/80">paired</span> (same seed, same box) and an
          independent box <span className="text-[#faf9f6]/80">reproduces</span> it. Until then it’s
          public but untrusted.
        </p>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-start justify-between gap-2">
            <PipelineStage icon={<CircleDot className="h-4 w-4 text-sky-300" />} label="Proposed" sub="anyone proposes a lever · Neon" tone="border-sky-400/40 text-sky-300" />
            <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-[#faf9f6]/25" />
            <PipelineStage icon={<GitMerge className="h-4 w-4 text-violet-300" />} label="Coded" sub="AI writes it → PR merged · GitHub" tone="border-violet-400/40 text-violet-300" />
            <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-[#faf9f6]/25" />
            <PipelineStage icon={<ListChecks className="h-4 w-4 text-amber-300" />} label="Curated" sub="maintainer approves → queue" tone="border-amber-300/40 text-amber-300" />
            <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-[#faf9f6]/25" />
            <PipelineStage icon={<Server className="h-4 w-4 text-[#faf9f6]/70" />} label="Run" sub="a donor GPU trains it · local" tone="border-white/25 text-[#faf9f6]/70" />
            <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-[#faf9f6]/25" />
            <PipelineStage icon={<ShieldCheck className="h-4 w-4 text-emerald-300" />} label="Reproduced" sub="another box confirms it" tone="border-emerald-400/40 text-emerald-300" />
            <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-[#faf9f6]/25" />
            <PipelineStage icon={<Trophy className="h-4 w-4 text-emerald-300" />} label="Champion" sub="the live record" tone="border-emerald-400/60 bg-emerald-400/10 text-emerald-300" />
          </div>
        </div>

        {/* footer */}
        <div className="mt-12 flex items-center justify-between border-t border-white/10 pt-6 text-[13px] text-[#faf9f6]/45">
          <span className="inline-flex items-center gap-1.5"><Coins className="h-3.5 w-3.5" /> No payment, no account required to browse.</span>
          <Link href="/voidbase" className="inline-flex items-center gap-1 text-[#faf9f6]/70 hover:text-[#faf9f6]">
            See the live record <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
