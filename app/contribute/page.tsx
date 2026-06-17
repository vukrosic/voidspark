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

  const load = useCallback(async () => {
    const [h, c] = await Promise.all([
      fetchResource<Health>('health'),
      fetchResource<Champion[]>('champions'),
    ]);
    if (h.success) setCounts(h.data?.counts ?? null);
    if (c.success && c.data && c.data.length) setChampion(c.data[0]);
  }, []);

  useEffect(() => { void load(); }, [load]);

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
