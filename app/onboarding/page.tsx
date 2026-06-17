'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight, Check, Copy, GitBranch, Trophy, ListChecks, FlaskConical,
  GitPullRequest, Clock, ShieldAlert, BookOpen, Terminal,
} from 'lucide-react';

// ---- /onboarding ------------------------------------------------------------
// The guided "start here" for a brand-new research contributor. /contribute
// pitches the three paths; this route takes the *research* path and unfolds it
// into six concrete steps that mirror the landing-site AGENT_PROMPT — so the
// website and the product tell the same story. Every command/prompt block has a
// copy button, and the whole flow is also copyable as one agent prompt so an AI
// can drive steps 2–6 autonomously. Reads go through the same /api/voidbase
// proxy used everywhere else; step 4 inlines live `threads` when the endpoint
// is up and degrades to just a /research link when it isn't.

type Thread = {
  name: string;
  hypothesis: string | null;
  status: string | null;
  priority: number | null;
};

type Envelope<T> = { success: boolean; data?: T; error?: string };

async function fetchThreads(): Promise<Thread[]> {
  try {
    const r = await fetch('/api/voidbase/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'threads' }),
    });
    const env: Envelope<Thread[]> = await r.json();
    return env.success && Array.isArray(env.data) ? env.data : [];
  } catch {
    return [];
  }
}

// The full agent prompt — kept verbatim with the landing site so display === copy
// and the same brief works whether a human reads the steps or an agent runs them.
const AGENT_PROMPT = `You are joining the open research lab as an autonomous research agent. Set yourself up, run ONE experiment end-to-end, then open a pull request.

1. Clone the repos:
   git clone https://github.com/vukrosic/universe-lm
   git clone https://github.com/vukrosic/voidspark

2. Set up universe-lm: read README.md and CONTRIBUTING.md, create the Python env, install requirements, and download the dataset:
   python data/download_hf_data.py   # ~15GB from Hugging Face

3. Read autoresearch/champion.json for the current champion's config + val loss. Review the open research threads at voidspark /research so you don't repeat a tried idea. Every change is measured against the champion.

4. Pick ONE open thread and design a single STRUCTURAL change — attention, positional, norm, FFN, or residual — on top of the champion, behind a use_<name> flag that defaults to off. RULE 0: do NOT tune hyperparameters (no LR / weight-decay / momentum / batch / schedule).

5. Add a config row and run the paired same-seed control vs the champion (identical tokens, identical seeds) so the delta is real, not GPU noise.

6. Open a pull request to universe-lm with the code, the config, and the result table. A maintainer re-runs it on the reference box; if it beats the champion across seeds, it becomes the new champion — in the open.`;

const CLONE_BLOCK = `git clone https://github.com/vukrosic/universe-lm
git clone https://github.com/vukrosic/voidspark`;

const CHAMPION_BLOCK = `# the current record — every change is measured against this
cat universe-lm/autoresearch/champion.json`;

const PR_BLOCK = `# run the paired same-seed control vs the champion, then:
git checkout -b use_<your_mechanism>
git commit -am "use_<name>: one structural change, default off"
git push origin use_<your_mechanism>
gh pr create  # see CONTRIBUTING.md for the result-table format`;

// A reusable copyable block — a labelled <pre> with a working copy button.
function CodeBlock({
  id, label, code, copied, onCopy, mono = true,
}: {
  id: string;
  label: string;
  code: string;
  copied: string | null;
  onCopy: (id: string, text: string) => void;
  mono?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[#faf9f6]/45">
          <Terminal className="h-3.5 w-3.5 text-cyan-300/70" /> {label}
        </span>
        <button
          onClick={() => onCopy(id, code)}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-[#faf9f6]/75 transition hover:bg-white/10"
        >
          {copied === id ? (
            <><Check className="h-3.5 w-3.5 text-emerald-300" /> Copied</>
          ) : (
            <><Copy className="h-3.5 w-3.5" /> Copy</>
          )}
        </button>
      </div>
      <pre
        className={`max-h-72 overflow-auto whitespace-pre-wrap px-3 py-3 text-[12.5px] leading-relaxed text-[#faf9f6]/75 ${mono ? 'font-mono' : ''}`}
      >
        {code}
      </pre>
    </div>
  );
}

// One numbered step in the walkthrough.
function Step({
  n, icon, title, blurb, children,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  blurb: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative flex gap-4 pb-10 last:pb-0">
      {/* rail */}
      <div className="flex flex-col items-center">
        <div className="z-10 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/10 text-sm font-semibold tabular-nums text-emerald-200">
          {n}
        </div>
        <div className="mt-1 w-px flex-1 bg-white/10 last:hidden" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-2 text-base font-semibold text-[#faf9f6]">
          <span className="text-emerald-300/80">{icon}</span> {title}
        </h3>
        <div className="mt-1.5 text-sm leading-relaxed text-[#faf9f6]/60">{blurb}</div>
        {children && <div className="mt-3 space-y-3">{children}</div>}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setThreads(await fetchThreads());
  }, []);

  useEffect(() => { void load(); }, [load]);

  const copy = useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600);
    } catch {
      /* clipboard blocked — ignore */
    }
  }, []);

  // Top 3 active threads, highest priority first — the "pick one of these" list.
  const topThreads = threads
    .filter((t) => (t.status ?? 'active') === 'active')
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .slice(0, 3);

  return (
    <div className="min-h-screen bg-[#0b0b0d] px-6 py-10 text-[#faf9f6]">
      <div className="mx-auto max-w-3xl">
        {/* nav */}
        <div className="mb-10 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-emerald-400/20 text-emerald-300">◆</span>
            voidbase
          </div>
          <div className="flex items-center gap-4 text-[#faf9f6]/55">
            <Link href="/contribute" className="hover:text-[#faf9f6]">Contribute</Link>
            <Link href="/research" className="hover:text-[#faf9f6]">Threads</Link>
            <Link href="/voidbase" className="hover:text-[#faf9f6]">Browse the record</Link>
            <Link href="/" className="hover:text-[#faf9f6]">Cockpit</Link>
          </div>
        </div>

        {/* hero */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-medium text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> guided onboarding · research path
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-[11px] font-medium text-cyan-200">
            <Clock className="h-3.5 w-3.5" /> ~2 hours to your first PR
          </span>
        </div>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight">
          From a vague idea to your first PR.
        </h1>
        <p className="mt-3 max-w-xl text-[15px] text-[#faf9f6]/60">
          Six steps. Clone the repos, read the current champion, pick an open research thread,
          implement one structural change, run the paired control, and open a pull request.
          Do it yourself — or hand the whole thing to an AI agent.
        </p>

        {/* agent prompt — copy the whole flow for an AI to run steps 2–6 */}
        <div className="mt-8 overflow-hidden rounded-2xl border border-cyan-300/15 bg-[#0f0e0d]/80">
          <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
            <span className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[#faf9f6]/45">
              <Terminal className="h-3.5 w-3.5 text-cyan-300/70" /> have an AI do it — copy the agent prompt
            </span>
            <button
              onClick={() => void copy('agent', AGENT_PROMPT)}
              className="inline-flex items-center gap-1.5 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-2.5 py-1 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
            >
              {copied === 'agent' ? (
                <><Check className="h-3.5 w-3.5" /> Copied</>
              ) : (
                <><Copy className="h-3.5 w-3.5" /> Copy the agent prompt</>
              )}
            </button>
          </div>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap px-4 py-4 font-mono text-[12px] leading-relaxed text-[#faf9f6]/70">
            {AGENT_PROMPT}
          </pre>
        </div>
        <p className="mt-2 text-[13px] text-[#faf9f6]/40">
          Paste it into Claude Code, Codex, or any agent — it runs steps 2–6 and opens the PR.
          Prefer to drive it yourself? Follow the steps below.
        </p>

        {/* the six steps */}
        <div className="mt-12">
          <Step
            n={1}
            icon={<BookOpen className="h-4 w-4" />}
            title="Welcome + the mission"
            blurb={
              <>
                This is an open, distributed research lab searching for better language-model
                architectures, one paired experiment at a time. The{' '}
                <span className="text-[#faf9f6]/85">champion</span> is the single best
                configuration found so far — the live record. Your job as a contributor is to
                propose one change and prove, against that champion, that it helps. Nothing moves
                the record until an independent box reproduces it.
              </>
            }
          />

          <Step
            n={2}
            icon={<GitBranch className="h-4 w-4" />}
            title="Clone the repos"
            blurb={
              <>
                <span className="text-[#faf9f6]/85">universe-lm</span> holds the model + experiments;{' '}
                <span className="text-[#faf9f6]/85">voidspark</span> is the dashboard you&apos;re reading
                now. Then set up universe-lm per its README (Python env, requirements,{' '}
                <span className="font-mono text-[12px]">python data/download_hf_data.py</span>).
              </>
            }
          >
            <CodeBlock id="clone" label="clone both repos" code={CLONE_BLOCK} copied={copied} onCopy={copy} />
          </Step>

          <Step
            n={3}
            icon={<Trophy className="h-4 w-4" />}
            title="Read the champion"
            blurb={
              <>
                <span className="font-mono text-[12px]">autoresearch/champion.json</span> records the
                current best config and its validation loss. It is the baseline for{' '}
                <span className="text-[#faf9f6]/85">every</span> change: your experiment only counts
                if it beats this number on a paired, same-seed run. Read it before you design
                anything so you know what you&apos;re trying to improve on.
              </>
            }
          >
            <CodeBlock id="champion" label="inspect the current record" code={CHAMPION_BLOCK} copied={copied} onCopy={copy} />
          </Step>

          <Step
            n={4}
            icon={<ListChecks className="h-4 w-4" />}
            title="Browse open threads — pick one"
            blurb={
              <>
                A <span className="text-[#faf9f6]/85">thread</span> is a self-executing research
                brief: a hypothesis plus the exact prompt to run it. Pick one so you don&apos;t repeat a
                tried idea. The full board (with copyable goal prompts) lives at{' '}
                <Link href="/research" className="text-emerald-300 underline-offset-2 hover:underline">
                  /research
                </Link>
                .
              </>
            }
          >
            {topThreads.length > 0 ? (
              <div className="space-y-2">
                <div className="text-[11px] uppercase tracking-wide text-[#faf9f6]/40">
                  pick one of these active threads
                </div>
                {topThreads.map((t) => (
                  <Link
                    key={t.name}
                    href="/research"
                    className="block rounded-lg border border-white/10 bg-white/[0.02] p-3 transition hover:border-emerald-400/30 hover:bg-white/[0.04]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-[#faf9f6]">{t.name}</span>
                      <span className="shrink-0 rounded bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-200">
                        active · p{t.priority ?? 0}
                      </span>
                    </div>
                    {t.hypothesis && (
                      <p className="mt-1 text-[13px] text-[#faf9f6]/60">{t.hypothesis}</p>
                    )}
                  </Link>
                ))}
                <Link
                  href="/research"
                  className="inline-flex items-center gap-1 text-[13px] text-[#faf9f6]/70 hover:text-[#faf9f6]"
                >
                  See all threads <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : (
              <Link
                href="/research"
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-medium text-[#faf9f6] transition hover:bg-white/10"
              >
                Browse open threads at /research <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </Step>

          <Step
            n={5}
            icon={<FlaskConical className="h-4 w-4" />}
            title="Implement ONE structural change"
            blurb={
              <>
                Add a single structural mechanism — attention, positional, norm, FFN, or residual —
                behind a <span className="font-mono text-[12px]">use_&lt;name&gt;</span> flag that{' '}
                <span className="text-[#faf9f6]/85">defaults to off</span>, so the champion path is
                untouched when the flag is unset. One change per PR keeps the delta attributable.
              </>
            }
          >
            <div className="flex items-start gap-2 rounded-xl border border-amber-300/25 bg-amber-300/5 px-4 py-3 text-[13px] text-amber-100/85">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <span>
                <span className="font-semibold text-amber-100">RULE 0 — no hyperparameter tuning.</span>{' '}
                Do not sweep learning rate, weight decay, momentum, batch size, or schedule. Only
                novel <span className="font-medium">structural</span> mechanisms earn the record;
                HP search does not.
              </span>
            </div>
          </Step>

          <Step
            n={6}
            icon={<GitPullRequest className="h-4 w-4" />}
            title="Test locally + open a PR"
            blurb={
              <>
                Run the <span className="text-[#faf9f6]/85">paired same-seed control</span> — the
                champion and your candidate on identical tokens and identical seeds — so the delta
                is real, not GPU noise. Then open a PR to universe-lm with the code, the config, and
                the result table. See{' '}
                <a
                  href="https://github.com/vukrosic/universe-lm/blob/main/CONTRIBUTING.md"
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-300 underline-offset-2 hover:underline"
                >
                  CONTRIBUTING.md
                </a>{' '}
                for the exact result-table format. A maintainer re-runs it on the reference box;
                survive reproduction and it becomes the new champion.
              </>
            }
          >
            <CodeBlock id="pr" label="paired control → PR" code={PR_BLOCK} copied={copied} onCopy={copy} />
          </Step>
        </div>

        {/* footer CTAs */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-6 text-[13px] text-[#faf9f6]/45">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> ~2 hours to your first PR. No account required.
          </span>
          <div className="flex items-center gap-4">
            <Link href="/research" className="inline-flex items-center gap-1 text-[#faf9f6]/70 hover:text-[#faf9f6]">
              Open threads <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link href="/voidbase" className="inline-flex items-center gap-1 text-[#faf9f6]/70 hover:text-[#faf9f6]">
              The live record <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
