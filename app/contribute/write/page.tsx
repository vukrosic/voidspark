'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, GitPullRequest, Copy, Check, GitMerge, Bot, FileCode2, ListChecks,
} from 'lucide-react';

// ---- /contribute/write ------------------------------------------------------
// The "write experiments" path: contributors bring their OWN AI (Claude / Codex /
// etc.), claim a brief (topic + self-contained prompt), let their AI generate the
// experiment code, and open a PR. No API keys ever change hands — GitHub's PR +
// merge IS the review gate. Design preview: briefs are illustrative; they'll be
// served from Neon (ideas in `needs-implement` with a prompt) once the write-path
// lands, and the PR button will deep-link the repo's new-file flow.

type Brief = {
  id: string;
  area: string;
  title: string;
  why: string;
  est: string;
  prompt: string;
};

// The shared preamble every brief shares — the champion + run contract. Kept in
// one place so the prompts stay consistent with what the box actually runs.
const CONTRACT = `REPO: github.com/vukrosic/universe-lm — model code + experiment
stubs live together; the GPU box trains directly from it.
CHAMPION to beat: configs.llm_config.Tiny1M3MAlibiConfig + flags
use_deepnet_alpha, use_poly_alibi, with dataclass overrides
muon_momentum=0.90, muon_lr=0.048, adamw_lr=0.012 (carry ALL of these).

DELIVERABLE — ONE PR (follow autoresearch/RUN-CONTRACT.md exactly):
  1. Implement your mechanism in the model behind a NEW \`use_<name>\` flag —
     the repo's established pattern (see the existing use_* flags in
     configs/llm_config.py + the model). Default it OFF so it's non-invasive.
  2. _arq_<your-idea>.py: \`C\` = a subclass of the champion config that turns
     your flag ON and carries the champion overrides above.
  3. run.json -> {"name","arq_file","job_timeout":"12m"} + idea.md (hypothesis,
     the lever, why it may help, a 1-line falsifiable claim).

RULES: tiny1m3m tier. STRUCTURAL mechanisms only — never sweep
LR / weight-decay / momentum / batch / schedule / init. Add minimal params;
initialise so step-0 ≈ champion (no free regression). PR title
"experiment: <your-idea>". A maintainer reviews & merges, then it enters the queue.`;

const BRIEFS: Brief[] = [
  {
    id: 'gated-attn-output',
    area: 'attention',
    title: 'Learned per-head output gate',
    why: 'Let each head decide how much it writes back, before W_O — cheap, structural, may sharpen head specialisation.',
    est: '~15 min in your AI',
    prompt: `You are contributing an experiment to voidbase (open LM-architecture search).

GOAL: a NOVEL STRUCTURAL mechanism — a learned per-head scalar gate on the
attention output, applied to each head's contribution BEFORE the output
projection W_O. Gate = sigmoid(g_h), g_h a per-head parameter init at 0 so the
sigmoid starts at 0.5 *or* init so step-0 matches the champion exactly.

${CONTRACT}`,
  },
  {
    id: 'depthwise-conv-ffn',
    area: 'FFN',
    title: 'Depthwise-conv token mixing in the FFN',
    why: 'Give the FFN a tiny local-context view (depthwise conv over the sequence) before the channel MLP.',
    est: '~20 min in your AI',
    prompt: `You are contributing an experiment to voidbase (open LM-architecture search).

GOAL: a NOVEL STRUCTURAL mechanism — add a depthwise 1D convolution (small
kernel, e.g. 3) over the sequence dimension at the FFN input, mixing local token
context per-channel before the existing channel MLP. Causal padding only.
Initialise the conv as near-identity so step-0 ≈ champion.

${CONTRACT}`,
  },
  {
    id: 'per-head-temperature',
    area: 'attention',
    title: 'Learnable per-head softmax temperature',
    why: 'A single learned temperature per head lets some heads stay sharp and others diffuse — one param per head.',
    est: '~10 min in your AI',
    prompt: `You are contributing an experiment to voidbase (open LM-architecture search).

GOAL: a NOVEL STRUCTURAL mechanism — a learnable per-head temperature on the
attention logits: scale QK^T by exp(t_h) (t_h per-head param, init 0 so it starts
at the champion's scaling). This is a structural mechanism, NOT a global
hyperparameter — every head gets its own learned value, trained end-to-end.

${CONTRACT}`,
  },
];

function Step({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
        {icon}
      </div>
      <div>
        <div className="text-sm font-medium text-[#faf9f6]">{title}</div>
        <div className="text-[13px] text-[#faf9f6]/55">{body}</div>
      </div>
    </div>
  );
}

function BriefCard({ brief }: { brief: Brief }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(brief.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked — preview only */ }
  };
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="inline-block rounded-full border border-violet-400/30 bg-violet-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-violet-200">
            {brief.area}
          </span>
          <h3 className="mt-2 text-base font-semibold text-[#faf9f6]">{brief.title}</h3>
          <p className="mt-1 text-sm text-[#faf9f6]/55">{brief.why}</p>
        </div>
        <span className="shrink-0 text-[11px] text-[#faf9f6]/40">{brief.est}</span>
      </div>

      <pre className="mt-4 max-h-44 overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-[#faf9f6]/70 whitespace-pre-wrap">
{brief.prompt}
      </pre>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-[13px] font-medium hover:bg-white/10"
        >
          {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy prompt'}
        </button>
        <a
          href={`https://github.com/vukrosic/universe-lm/new/main?filename=_arq_${brief.id}.py`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 text-[13px] font-medium text-violet-100 hover:bg-violet-400/20"
        >
          <GitPullRequest className="h-4 w-4" /> Start a PR
        </a>
      </div>
    </div>
  );
}

export default function WriteExperimentsPage() {
  return (
    <div className="min-h-screen bg-[#0b0b0d] px-6 py-10 text-[#faf9f6]">
      <div className="mx-auto max-w-4xl">
        <Link href="/contribute" className="inline-flex items-center gap-1.5 text-sm text-[#faf9f6]/55 hover:text-[#faf9f6]">
          <ArrowLeft className="h-4 w-4" /> Contribute
        </Link>

        <h1 className="mt-5 flex items-center gap-2 text-3xl font-semibold tracking-tight">
          <GitPullRequest className="h-7 w-7 text-violet-300" /> Write experiments
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] text-[#faf9f6]/60">
          Bring your own AI. Each brief is a self-contained prompt — paste it into Claude, Codex, or
          whatever you use, let it write the experiment code, and open a pull request. No keys, no
          accounts to share. GitHub’s review is the gate.
        </p>

        {/* how it works */}
        <div className="mt-7 grid gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:grid-cols-4">
          <Step icon={<ListChecks className="h-4 w-4 text-violet-300" />} title="1 · Claim a brief" body="Pick one below and copy its prompt." />
          <Step icon={<Bot className="h-4 w-4 text-violet-300" />} title="2 · Run your AI" body="It writes the arq stub + run.json + idea.md." />
          <Step icon={<FileCode2 className="h-4 w-4 text-violet-300" />} title="3 · Open a PR" body="Push the generated files to the repo." />
          <Step icon={<GitMerge className="h-4 w-4 text-emerald-300" />} title="4 · Merged → queued" body="A maintainer reviews; then a GPU runs it." />
        </div>

        <div className="mt-8 mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#faf9f6]/50">
            Open briefs ({BRIEFS.length})
          </h2>
          <span className="text-[11px] text-[#faf9f6]/35">design preview · briefs will come from the curated queue</span>
        </div>
        <div className="space-y-4">
          {BRIEFS.map((b) => <BriefCard key={b.id} brief={b} />)}
        </div>
      </div>
    </div>
  );
}
