'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

// ---- research board ---------------------------------------------------------
// Author + browse research THREADS, the agenda that drives the loop. A thread is
// a self-executing brief: it carries the full `goal_prompt` a contributor hands
// straight to their AI, which writes one experiment and opens a PR (GitHub is
// the gate — no auth, no DB creds). Threads live in Neon (`threads` table) and
// every run/queue row is tagged with `thread_name`, so a "sweep" is just a batch
// of config rows enqueued under one thread. Reads + writes go through
// /api/voidbase (write:{...} forwards an upstream POST).

type Thread = {
  name: string;
  hypothesis: string | null;
  goal_prompt: string | null;
  kind: string | null;
  submit_via: string | null;
  status: string | null;
  priority: number | null;
  repo_url: string | null;
  updated_at: string | null;
  // claim / status — expired claims read back null (server auto-releases lazily).
  claimed_by: string | null;
  claimed_at: string | null;
  claim_expires_at: string | null;
  // "is this hot" signal — runs landed under this thread in the last 7 days.
  run_count_last_7d: number | null;
};

type Envelope<T> = { success: boolean; data?: T; error?: string };

async function fetchThreads(): Promise<Thread[]> {
  const r = await fetch('/api/voidbase/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource: 'threads' }),
  });
  const env: Envelope<Thread[]> = await r.json();
  return env.success && Array.isArray(env.data) ? env.data : [];
}

async function saveThread(t: Partial<Thread>): Promise<Envelope<Thread>> {
  const r = await fetch('/api/voidbase/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource: 'threads', write: t }),
  });
  return r.json();
}

// Claim / release ride the same write path (write:{...} -> upstream POST
// /threads); the upstream switches on `action`. The proxy returns the raw
// upstream JSON in `data`, which carries an `error` string on a rejected claim.
async function claimThread(name: string, handle: string): Promise<Envelope<Thread & { error?: string }>> {
  const r = await fetch('/api/voidbase/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource: 'threads', write: { action: 'claim', name, claimed_by: handle } }),
  });
  return r.json();
}

async function releaseThread(name: string): Promise<Envelope<Thread & { error?: string }>> {
  const r = await fetch('/api/voidbase/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resource: 'threads', write: { action: 'release', name } }),
  });
  return r.json();
}

// "42h left" — time remaining on a claim before it lazily auto-releases.
function claimTimeLeft(expiresAt: string | null): string {
  if (!expiresAt) return '';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return '';
  const h = Math.round(ms / 3_600_000);
  return h > 0 ? `${h}h left` : 'expiring';
}

const STATUS_ORDER: Record<string, number> = { active: 0, paused: 1, closed: 2 };

const BLANK = {
  name: '',
  kind: 'question',
  submit_via: 'pr',
  priority: 1,
  hypothesis: '',
  goal_prompt: '',
};

export default function ResearchBoard() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ ...BLANK });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setThreads(await fetchThreads());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!form.name.trim()) {
      setMsg('name is required');
      return;
    }
    setSaving(true);
    setMsg(null);
    const res = await saveThread({
      ...form,
      name: form.name.trim(),
      priority: Number(form.priority) || 0,
    });
    setSaving(false);
    if (res.success) {
      setMsg(`saved "${form.name.trim()}"`);
      setForm({ ...BLANK });
      setShowForm(false);
      void load();
    } else {
      setMsg(res.error || 'save failed');
    }
  };

  const copy = async (name: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(name);
      setTimeout(() => setCopied((c) => (c === name ? null : c)), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  const claim = async (name: string) => {
    const handle = window.prompt(`Claim "${name}" as (your handle):`)?.trim();
    if (!handle) return;
    setMsg(null);
    const res = await claimThread(name, handle);
    const err = res.error || res.data?.error;
    setMsg(err ? `claim failed: ${err}` : `claimed "${name}" as ${handle}`);
    void load();
  };

  const release = async (name: string) => {
    setMsg(null);
    const res = await releaseThread(name);
    const err = res.error || res.data?.error;
    setMsg(err ? `release failed: ${err}` : `released "${name}"`);
    void load();
  };

  const sorted = [...threads].sort((a, b) => {
    const s = (STATUS_ORDER[a.status ?? ''] ?? 9) - (STATUS_ORDER[b.status ?? ''] ?? 9);
    if (s !== 0) return s;
    return (b.priority ?? 0) - (a.priority ?? 0);
  });

  const field = 'w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-[#faf9f6] placeholder:text-[#faf9f6]/30 focus:border-white/30 focus:outline-none';

  return (
    <div className="min-h-screen bg-[#0b0b0d] px-6 py-8 text-[#faf9f6]">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">research threads</h1>
            <p className="text-sm text-[#faf9f6]/60">
              The agenda that drives the loop. Each thread is a self-executing brief —
              hand its <span className="text-[#faf9f6]/80">goal prompt</span> to an AI, it
              opens a PR.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowForm((s) => !s)}
              className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-400/20"
            >
              {showForm ? 'Close' : '+ New thread'}
            </button>
            <button
              onClick={() => void load()}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <Link href="/voidbase" className="text-sm text-[#faf9f6]/60 hover:text-[#faf9f6]">
              voidbase →
            </Link>
          </div>
        </div>

        {msg && (
          <div className="mb-4 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-[#faf9f6]/80">
            {msg}
          </div>
        )}

        {showForm && (
          <div className="mb-6 rounded-lg border border-white/15 bg-white/[0.03] p-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-[#faf9f6]/60">
                name (unique slug)
                <input
                  className={field}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="positional-decay-stacking"
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs text-[#faf9f6]/60">
                  kind
                  <select
                    className={field}
                    value={form.kind}
                    onChange={(e) => setForm({ ...form, kind: e.target.value })}
                  >
                    <option value="question">question</option>
                    <option value="sweep">sweep</option>
                  </select>
                </label>
                <label className="text-xs text-[#faf9f6]/60">
                  submit
                  <select
                    className={field}
                    value={form.submit_via}
                    onChange={(e) => setForm({ ...form, submit_via: e.target.value })}
                  >
                    <option value="pr">PR</option>
                    <option value="neon">neon</option>
                  </select>
                </label>
                <label className="text-xs text-[#faf9f6]/60">
                  priority
                  <input
                    type="number"
                    className={field}
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                  />
                </label>
              </div>
            </div>
            <label className="mt-3 block text-xs text-[#faf9f6]/60">
              hypothesis (one falsifiable line)
              <input
                className={field}
                value={form.hypothesis}
                onChange={(e) => setForm({ ...form, hypothesis: e.target.value })}
                placeholder="Does mechanism X stack super-additively on champion 323?"
              />
            </label>
            <label className="mt-3 block text-xs text-[#faf9f6]/60">
              goal prompt (the full brief an AI executes end-to-end)
              <textarea
                className={`${field} h-40 font-mono text-xs leading-relaxed`}
                value={form.goal_prompt}
                onChange={(e) => setForm({ ...form, goal_prompt: e.target.value })}
                placeholder={
                  'GOAL: …\nRead autoresearch/champion.json. Implement ONE structural mechanism behind a use_<name> flag (default False). Add a config row + paired 3-seed confirm vs champion. Open a PR to universe-lm. Do NOT tune LR/wd/momentum/batch (RULE 0).'
                }
              />
            </label>
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => void submit()}
                disabled={saving}
                className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 text-sm text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save thread'}
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {sorted.length === 0 && !loading && (
            <p className="text-sm text-[#faf9f6]/40">No threads yet — author one above.</p>
          )}
          {sorted.map((t) => (
            <div
              key={t.name}
              className="rounded-lg border border-white/10 bg-white/[0.02] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] uppercase text-[#faf9f6]/50">
                      {t.kind ?? 'question'}
                    </span>
                    <span className="rounded border border-sky-400/20 bg-sky-400/5 px-1.5 py-0.5 text-[10px] uppercase text-sky-200/70">
                      via {t.submit_via ?? 'pr'}
                    </span>
                  </div>
                  {t.hypothesis && (
                    <p className="mt-1 text-sm text-[#faf9f6]/70">{t.hypothesis}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-[11px] ${
                      t.status === 'active'
                        ? 'bg-emerald-400/10 text-emerald-200'
                        : t.status === 'closed'
                          ? 'bg-white/5 text-[#faf9f6]/40'
                          : 'bg-amber-400/10 text-amber-200'
                    }`}
                  >
                    {t.status ?? 'active'}
                  </span>
                  <span className="text-[11px] text-[#faf9f6]/40">p{t.priority ?? 0}</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {(t.run_count_last_7d ?? 0) > 0 && (
                  <span className="rounded border border-orange-400/20 bg-orange-400/5 px-1.5 py-0.5 text-[11px] text-orange-200/80">
                    🔥 {t.run_count_last_7d} run{t.run_count_last_7d === 1 ? '' : 's'} this week
                  </span>
                )}
                {t.claimed_by ? (
                  <>
                    <span className="rounded border border-violet-400/25 bg-violet-400/10 px-2 py-0.5 text-[11px] text-violet-200">
                      👤 claimed by {t.claimed_by}
                      {claimTimeLeft(t.claim_expires_at) &&
                        ` · ${claimTimeLeft(t.claim_expires_at)}`}
                    </span>
                    <button
                      onClick={() => void release(t.name)}
                      className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-[#faf9f6]/70 hover:bg-white/10"
                    >
                      Release
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => void claim(t.name)}
                    className="rounded border border-violet-400/30 bg-violet-400/10 px-2 py-0.5 text-[11px] text-violet-200 hover:bg-violet-400/20"
                  >
                    Claim this
                  </button>
                )}
              </div>
              {t.goal_prompt && (
                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wide text-[#faf9f6]/40">
                      goal prompt
                    </span>
                    <button
                      onClick={() => void copy(t.name, t.goal_prompt ?? '')}
                      className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-[#faf9f6]/70 hover:bg-white/10"
                    >
                      {copied === t.name ? 'copied ✓' : 'copy prompt'}
                    </button>
                  </div>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-black/30 p-2 font-mono text-[11px] leading-relaxed text-[#faf9f6]/70">
                    {t.goal_prompt}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
