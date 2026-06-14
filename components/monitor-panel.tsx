"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  LoaderCircle,
  Play,
  RefreshCw,
  Settings2,
  Square,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
import { MarkdownRenderer } from "@/components/markdown-renderer";

// ---- Monitor panel ----------------------------------------------------------
// Right-docked watchdog view with two tabs:
//   Summary  — the markdown report the lab-monitor agent writes each minute,
//              polled from /api/monitor every 15s.
//   Terminal — the live tmux pane (default lab-monitor), polled from
//              /api/tmux-log; an input box types into it via /api/tmux send.
// Settings (gear) edits two persisted things: the agent's base prompt and the
// issue checklist it evaluates every tick (GPU idle, stuck runs, stalls, …).

type Status = {
  alive: boolean;
  summary: string;
  summaryAgeMs: number | null;
  prompt: string;
  issues: string;
  interval: number;
};

function ago(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export default function MonitorPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"summary" | "terminal">("summary");
  const [data, setData] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const [issuesDraft, setIssuesDraft] = useState("");
  // Don't clobber an in-progress edit when a poll lands.
  const editingRef = useRef(false);

  // Terminal tab state.
  const [termSession, setTermSession] = useState("lab-monitor");
  const [termText, setTermText] = useState("");
  const [termInput, setTermInput] = useState("");
  const termRef = useRef<HTMLPreElement | null>(null);

  // --- status poll (alive dot + summary) ---
  const poll = useCallback(async () => {
    try {
      const d = await fetch("/api/monitor/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status" }),
      }).then((r) => r.json());
      if (d?.success) {
        setData(d);
        if (!editingRef.current) {
          setPromptDraft(d.prompt ?? "");
          setIssuesDraft(d.issues ?? "");
        }
      }
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    poll();
    const id = setInterval(poll, 15_000);
    return () => clearInterval(id);
  }, [open, poll]);

  // --- terminal poll (only while the Terminal tab is showing) ---
  const pollTerm = useCallback(async () => {
    try {
      const d = await fetch("/api/tmux-log/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: termSession }),
      }).then((r) => r.json());
      if (d?.success) setTermText(d.text || "(no output)");
      else setTermText(d?.error || "(session not found)");
    } catch {
      /* keep last */
    }
  }, [termSession]);

  useEffect(() => {
    if (!open || tab !== "terminal") return;
    pollTerm();
    const id = setInterval(pollTerm, 3_000);
    return () => clearInterval(id);
  }, [open, tab, pollTerm]);

  // Keep the terminal scrolled to the newest output.
  useEffect(() => {
    if (tab === "terminal" && termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [termText, tab]);

  const act = useCallback(
    async (action: "start" | "stop" | "save-prompt" | "save-issues") => {
      setBusy(true);
      try {
        const payload: Record<string, unknown> = { action };
        if (action === "save-prompt") payload.prompt = promptDraft;
        if (action === "save-issues") payload.issues = issuesDraft;
        const d = await fetch("/api/monitor/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).then((r) => r.json());
        if (d?.success) {
          setData(d);
          if (action === "save-prompt" || action === "save-issues") {
            editingRef.current = false;
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [promptDraft, issuesDraft]
  );

  const sendTerm = useCallback(async () => {
    const keys = termInput;
    setTermInput("");
    await fetch("/api/tmux/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send", name: termSession, keys }),
    }).catch(() => {});
    setTimeout(pollTerm, 400);
  }, [termInput, termSession, pollTerm]);

  const alive = data?.alive ?? false;

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Open the monitor watchdog"
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full border border-white/15 bg-[#262524] px-4 py-2.5 text-xs font-medium text-[#faf9f6]/80 shadow-xl shadow-black/40 transition hover:border-white/30 hover:text-white"
        >
          <span className={`h-2 w-2 rounded-full ${alive ? "bg-emerald-400" : "bg-white/30"}`} aria-hidden />
          <Activity className="h-3.5 w-3.5" aria-hidden />
          Monitor
        </button>
      ) : null}

      {open ? (
        <aside className="fixed right-0 top-0 z-40 flex h-screen w-full max-w-md flex-col border-l border-white/10 bg-[#1f1e1d] shadow-2xl shadow-black/50">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-white/10 bg-[#262524] px-4 py-3">
            <span className={`h-2.5 w-2.5 rounded-full ${alive ? "bg-emerald-400" : "bg-white/30"}`} aria-hidden />
            <span className="text-sm font-medium text-[#faf9f6]">Monitor</span>
            <span className="text-[11px] text-[#faf9f6]/45">
              {alive ? `live · updated ${ago(data?.summaryAgeMs ?? null)}` : "stopped"}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {alive ? (
                <button
                  type="button"
                  onClick={() => act("stop")}
                  disabled={busy}
                  title="Stop the monitor agent"
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-rose-400/40 bg-rose-400/10 px-2 text-[11px] font-medium text-rose-200 transition hover:bg-rose-400/20 disabled:opacity-50"
                >
                  {busy ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> : <Square className="h-3 w-3" aria-hidden />}
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => act("start")}
                  disabled={busy}
                  title="Start the monitor agent (MiniMax in tmux, refreshes every minute)"
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-400/40 bg-emerald-400/10 px-2 text-[11px] font-medium text-emerald-200 transition hover:bg-emerald-400/20 disabled:opacity-50"
                >
                  {busy ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> : <Play className="h-3 w-3" aria-hidden />}
                  Start
                </button>
              )}
              <button
                type="button"
                onClick={() => { setShowSettings((v) => !v); editingRef.current = !showSettings; }}
                title="Edit the watch prompt + issue checklist"
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition ${
                  showSettings ? "border-white/30 bg-white/[0.08] text-white" : "border-white/12 text-[#faf9f6]/55 hover:border-white/30 hover:text-white"
                }`}
              >
                <Settings2 className="h-3 w-3" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                title="Close"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/12 text-[#faf9f6]/55 transition hover:border-white/30 hover:text-white"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 border-b border-white/10 px-3 pt-2">
            {(["summary", "terminal"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`inline-flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-1.5 text-xs font-medium transition ${
                  tab === t
                    ? "border-violet-400 text-[#faf9f6]"
                    : "border-transparent text-[#faf9f6]/45 hover:text-[#faf9f6]/80"
                }`}
              >
                {t === "summary" ? <Activity className="h-3 w-3" aria-hidden /> : <TerminalIcon className="h-3 w-3" aria-hidden />}
                {t === "summary" ? "Summary" : "Terminal"}
              </button>
            ))}
          </div>

          {/* Settings drawer — prompt + issue checklist. */}
          {showSettings ? (
            <div className="max-h-[55vh] overflow-y-auto border-b border-white/10 bg-black/20 px-4 py-3">
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-[#faf9f6]/45">
                Issue checklist — flagged every tick
              </label>
              <textarea
                value={issuesDraft}
                onChange={(e) => { editingRef.current = true; setIssuesDraft(e.target.value); }}
                spellCheck={false}
                className="h-44 w-full resize-y rounded-md border border-white/12 bg-[#1f1e1d] px-2.5 py-2 font-mono text-[11px] leading-snug text-[#faf9f6]/85 focus:border-white/30 focus:outline-none"
              />
              <div className="mt-2 mb-4">
                <button
                  type="button"
                  onClick={() => act("save-issues")}
                  disabled={busy}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-violet-400/50 bg-violet-400/15 px-2.5 text-[11px] font-medium text-violet-100 transition hover:bg-violet-400/25 disabled:opacity-50"
                >
                  {busy ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> : null}
                  Save issues
                </button>
              </div>

              <label className="mb-1 block text-[11px] uppercase tracking-wide text-[#faf9f6]/45">
                Base prompt — how it reports
              </label>
              <textarea
                value={promptDraft}
                onChange={(e) => { editingRef.current = true; setPromptDraft(e.target.value); }}
                spellCheck={false}
                className="h-40 w-full resize-y rounded-md border border-white/12 bg-[#1f1e1d] px-2.5 py-2 font-mono text-[11px] leading-snug text-[#faf9f6]/85 focus:border-white/30 focus:outline-none"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => act("save-prompt")}
                  disabled={busy}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-violet-400/50 bg-violet-400/15 px-2.5 text-[11px] font-medium text-violet-100 transition hover:bg-violet-400/25 disabled:opacity-50"
                >
                  {busy ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> : null}
                  Save prompt
                </button>
                <span className="text-[10px] text-[#faf9f6]/35">Applies on the next refresh ({data?.interval ?? 60}s loop)</span>
              </div>
            </div>
          ) : null}

          {/* Body */}
          {tab === "summary" ? (
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {data?.summary ? (
                <div className="text-sm leading-relaxed text-[#faf9f6]/85">
                  <MarkdownRenderer content={data.summary} />
                </div>
              ) : (
                <div className="mt-8 text-center text-xs text-[#faf9f6]/40">
                  {alive
                    ? "Waiting for the first summary… (refreshes about once a minute)"
                    : "Monitor is stopped. Press Start to launch the watchdog agent."}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="text-[10px] uppercase tracking-wide text-[#faf9f6]/40">session</span>
                <input
                  value={termSession}
                  onChange={(e) => setTermSession(e.target.value.trim())}
                  spellCheck={false}
                  className="h-6 flex-1 rounded border border-white/12 bg-[#1f1e1d] px-2 font-mono text-[11px] text-[#faf9f6]/85 focus:border-white/30 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={pollTerm}
                  title="Refresh now"
                  className="inline-flex h-6 w-6 items-center justify-center rounded border border-white/12 text-[#faf9f6]/55 transition hover:border-white/30 hover:text-white"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden />
                </button>
              </div>
              <pre
                ref={termRef}
                className="mx-3 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border border-white/10 bg-black/40 p-2.5 font-mono text-[11px] leading-snug text-[#faf9f6]/80"
              >
                {termText || "(loading…)"}
              </pre>
              <div className="flex items-center gap-2 p-3">
                <input
                  value={termInput}
                  onChange={(e) => setTermInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") sendTerm(); }}
                  placeholder={`type into ${termSession} + Enter…`}
                  spellCheck={false}
                  className="h-8 flex-1 rounded-md border border-white/12 bg-[#1f1e1d] px-2.5 font-mono text-[11px] text-[#faf9f6]/85 focus:border-white/30 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={sendTerm}
                  className="inline-flex h-8 items-center rounded-md border border-white/15 bg-white/[0.04] px-3 text-[11px] font-medium text-[#faf9f6]/80 transition hover:border-white/30 hover:text-white"
                >
                  Send
                </button>
              </div>
            </div>
          )}

          <div className="border-t border-white/10 px-4 py-2 text-[10px] text-[#faf9f6]/35">
            tmux <code className="text-[#faf9f6]/55">lab-monitor</code> · summary refreshes every {data?.interval ?? 60}s
          </div>
        </aside>
      ) : null}
    </>
  );
}
