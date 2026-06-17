'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Cpu, Copy, Check, Server, ShieldCheck, Download,
  CircleDot, Activity, Lock,
} from 'lucide-react';

// ---- /contribute/compute ----------------------------------------------------
// The compute-donor path: install the runner, register a box, and it claims
// approved jobs off the voidbase queue, trains, and pushes results. The live
// queue is real (read from /api/voidbase -> Neon). "Your box" is an empty state
// until the write-path + runner CLI land (design preview); once a donor box
// registers, this fills from the boxes/queue_items tables.

type Envelope<T> = { success: boolean; data?: T };
async function fetchResource<T>(resource: string): Promise<Envelope<T>> {
  const r = await fetch('/api/voidbase/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource }),
  });
  return r.json();
}

type QueueItem = {
  id: string;
  name: string | null;
  status: string | null;
  gpu_class: string | null;
  priority: number | null;
  thread_name: string | null;
};

const INSTALL = 'pip install voidbase-runner && voidbase login';
const START = 'voidbase run --gpu        # claims approved jobs, trains, pushes results';

const STATUS_CLS: Record<string, string> = {
  'needs-run': 'border-sky-400/40 bg-sky-400/10 text-sky-200',
  claimed: 'border-amber-300/40 bg-amber-300/10 text-amber-200',
  running: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200',
  done: 'border-white/20 bg-white/5 text-[#faf9f6]/60',
  failed: 'border-red-400/40 bg-red-400/15 text-red-200',
  cancelled: 'border-white/15 bg-white/5 text-[#faf9f6]/40',
};

function CopyRow({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2.5">
      <code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-[13px] text-[#faf9f6]/85">{cmd}</code>
      <button onClick={copy} className="shrink-0 rounded-md border border-white/15 bg-white/5 p-1.5 hover:bg-white/10">
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function Stepcard({ n, icon, title, children }: { n: number; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400/15 text-[11px] font-semibold tabular-nums text-emerald-300">{n}</span>
        {icon}
        <h3 className="text-sm font-semibold text-[#faf9f6]">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function ComputeDonorPage() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const load = useCallback(async () => {
    const q = await fetchResource<QueueItem[]>('queue');
    if (q.success) setQueue(q.data ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const waiting = queue.filter((q) => q.status === 'needs-run').length;

  return (
    <div className="min-h-screen bg-[#0b0b0d] px-6 py-10 text-[#faf9f6]">
      <div className="mx-auto max-w-4xl">
        <Link href="/contribute" className="inline-flex items-center gap-1.5 text-sm text-[#faf9f6]/55 hover:text-[#faf9f6]">
          <ArrowLeft className="h-4 w-4" /> Contribute
        </Link>

        <h1 className="mt-5 flex items-center gap-2 text-3xl font-semibold tracking-tight">
          <Cpu className="h-7 w-7 text-emerald-300" /> Donate compute
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] text-[#faf9f6]/60">
          Point a spare GPU at the queue. The runner claims a <em>maintainer-approved</em> experiment,
          pulls the exact code, smoke-tests it, trains, and pushes the result back — attributed to you.
          It never accepts inbound connections and you can stop it any time.
        </p>

        {/* two-step setup */}
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Stepcard n={1} icon={<Download className="h-4 w-4 text-emerald-300" />} title="Install & sign in">
            <CopyRow cmd={INSTALL} />
            <p className="mt-2 text-[12px] text-[#faf9f6]/45">One-time GitHub sign-in — no keys pasted, the CLI holds its own token.</p>
          </Stepcard>
          <Stepcard n={2} icon={<Server className="h-4 w-4 text-emerald-300" />} title="Register & run">
            <CopyRow cmd={START} />
            <p className="mt-2 text-[12px] text-[#faf9f6]/45">Self-fingerprints your GPU (class, VRAM, CUDA) and starts the claim loop.</p>
          </Stepcard>
        </div>

        {/* what it does */}
        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-[12px] text-[#faf9f6]/55">
          <span className="font-medium text-[#faf9f6]/70">Each loop:</span>
          {['claim approved job', 'pull exact code (git)', 'smoke-test', 'train', 'push run + eval curve', 'release lease'].map((s, i, a) => (
            <span key={s} className="inline-flex items-center gap-2">
              <span>{s}</span>{i < a.length - 1 && <span className="text-[#faf9f6]/25">→</span>}
            </span>
          ))}
        </div>

        {/* your box — empty state (design preview) */}
        <h2 className="mb-3 mt-10 text-sm font-semibold uppercase tracking-wide text-[#faf9f6]/50">Your box</h2>
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center">
          <Server className="mx-auto h-7 w-7 text-[#faf9f6]/30" />
          <div className="mt-2 text-sm font-medium text-[#faf9f6]/80">No GPU connected yet</div>
          <div className="mt-1 text-[13px] text-[#faf9f6]/45">Run the command above and your box appears here — live status, lease, and jobs completed.</div>
          <div className="mx-auto mt-4 max-w-md rounded-lg border border-white/10 bg-black/30 p-3 text-left">
            <div className="text-[11px] uppercase tracking-wide text-[#faf9f6]/35">example, once connected</div>
            <div className="mt-1.5 flex items-center justify-between text-[13px]">
              <span className="inline-flex items-center gap-1.5 font-mono text-[#faf9f6]/80"><Activity className="h-3.5 w-3.5 text-emerald-300" /> RTX 3060 · sm_86 · 12GB</span>
              <span className="rounded border border-emerald-400/40 bg-emerald-400/15 px-1.5 py-0.5 text-[11px] text-emerald-200">running · 8m left</span>
            </div>
          </div>
        </div>

        {/* live queue (real data) */}
        <div className="mb-3 mt-10 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#faf9f6]/50">The live queue</h2>
          <span className="text-[12px] text-[#faf9f6]/45">{waiting} waiting · {queue.length} total · from Neon</span>
        </div>
        {queue.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-[#faf9f6]/50">
                <tr>
                  <th className="px-3 py-2 text-left">experiment</th>
                  <th className="px-3 py-2 text-left">thread</th>
                  <th className="px-3 py-2 text-left">gpu</th>
                  <th className="px-3 py-2 text-right">priority</th>
                  <th className="px-3 py-2 text-left">status</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((q) => (
                  <tr key={q.id} className="border-t border-white/5">
                    <td className="px-3 py-2 font-mono text-xs text-[#faf9f6]/80">{q.name ?? q.id}</td>
                    <td className="px-3 py-2 text-[#faf9f6]/55">{q.thread_name ?? '—'}</td>
                    <td className="px-3 py-2 text-[#faf9f6]/55">{q.gpu_class ?? 'any'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#faf9f6]/70">{q.priority ?? 0}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${STATUS_CLS[q.status ?? ''] ?? 'border-white/15 text-[#faf9f6]/60'}`}>
                        <CircleDot className="h-3 w-3" />{q.status ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-6 text-center text-[13px] text-[#faf9f6]/45">
            Queue is empty right now — maintainers are curating the next batch.
          </div>
        )}

        {/* trust strip */}
        <div className="mt-8 flex flex-wrap gap-4 border-t border-white/10 pt-6 text-[12px] text-[#faf9f6]/45">
          <span className="inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> No inbound access — the runner only calls out.</span>
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Only maintainer-approved code ever runs.</span>
        </div>
      </div>
    </div>
  );
}
