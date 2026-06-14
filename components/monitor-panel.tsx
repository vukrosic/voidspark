"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  LoaderCircle,
  Play,
  RefreshCw,
  Settings2,
  Square,
  X,
} from "lucide-react";
import { MarkdownRenderer } from "@/components/markdown-renderer";

// ---- Monitor panel ----------------------------------------------------------
// Right-docked watchdog view. A floating button opens it; while open it polls
// /api/monitor every 15s for the latest summary the lab-monitor agent wrote.
// Start/Stop controls the tmux agent; the prompt that tells it what to watch is
// editable here and persisted server-side. The summary itself is rendered
// markdown — the agent is instructed to emit a terse sectioned report.

type Status = {
  alive: boolean;
  summary: string;
  summaryAgeMs: number | null;
  prompt: string;
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
  const [data, setData] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  // Don't clobber an in-progress prompt edit when a poll lands.
  const editingRef = useRef(false);

  const poll = useCallback(async () => {
    try {
      const d = await fetch("/api/monitor/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status" }),
      }).then((r) => r.json());
      if (d?.success) {
        setData(d);
        if (!editingRef.current) setPromptDraft(d.prompt ?? "");
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

  const act = useCallback(
    async (action: "start" | "stop" | "save-prompt") => {
      setBusy(true);
      try {
        const d = await fetch("/api/monitor/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "save-prompt" ? { action, prompt: promptDraft } : { action }
          ),
        }).then((r) => r.json());
        if (d?.success) {
          setData(d);
          if (action === "save-prompt") {
            editingRef.current = false;
            setShowSettings(false);
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [promptDraft]
  );

  const alive = data?.alive ?? false;

  return (
    <>
      {/* Floating opener — bottom-right. */}
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

      {/* Right dock. */}
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
                onClick={poll}
                title="Re-read the latest summary"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/12 text-[#faf9f6]/55 transition hover:border-white/30 hover:text-white"
              >
                <RefreshCw className="h-3 w-3" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSettings((v) => !v);
                  editingRef.current = !showSettings;
                }}
                title="Edit what the monitor watches"
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition ${
                  showSettings
                    ? "border-white/30 bg-white/[0.08] text-white"
                    : "border-white/12 text-[#faf9f6]/55 hover:border-white/30 hover:text-white"
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

          {/* Settings — edit the watch prompt. */}
          {showSettings ? (
            <div className="border-b border-white/10 bg-black/20 px-4 py-3">
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-[#faf9f6]/45">
                Monitor prompt — what to watch for
              </label>
              <textarea
                value={promptDraft}
                onChange={(e) => {
                  editingRef.current = true;
                  setPromptDraft(e.target.value);
                }}
                spellCheck={false}
                className="h-56 w-full resize-y rounded-md border border-white/12 bg-[#1f1e1d] px-2.5 py-2 font-mono text-[11px] leading-snug text-[#faf9f6]/85 focus:border-white/30 focus:outline-none"
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
                <span className="text-[10px] text-[#faf9f6]/35">
                  Applies on the next refresh ({data?.interval ?? 60}s loop)
                </span>
              </div>
            </div>
          ) : null}

          {/* Summary body. */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {data?.summary ? (
              <div className="text-sm leading-relaxed text-[#faf9f6]/85">
                <MarkdownRenderer content={data.summary} />
              </div>
            ) : (
              <div className="mt-8 text-center text-xs text-[#faf9f6]/40">
                {alive
                  ? "Waiting for the first summary… (the agent refreshes about once a minute)"
                  : "Monitor is stopped. Press Start to launch the watchdog agent."}
              </div>
            )}
          </div>

          <div className="border-t border-white/10 px-4 py-2 text-[10px] text-[#faf9f6]/35">
            tmux session <code className="text-[#faf9f6]/55">lab-monitor</code> · attach to watch it tick
          </div>
        </aside>
      ) : null}
    </>
  );
}
