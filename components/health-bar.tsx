"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  Cpu,
  Gauge,
  Lightbulb,
  LoaderCircle,
  Sparkles,
  Trophy,
} from "lucide-react";

// ---- System health bar ------------------------------------------------------
// One sticky strip at the top of the cockpit that answers "is the loop alive?"
// at a glance. Polls the read-only /api/health snapshot every 5s (workers,
// dead panes, idea pool, throughput, GPU drainer) and /api/minimax-usage every
// 30s (quota is a slower upstream call). The master Autoresearch toggle lives
// here — its state is owned by the page, passed in so there's one source of
// truth. Nothing here mutates the pipeline except that toggle.

type Health = {
  ok: boolean;
  flags: { autopilot: string | null; autorun: string | null; autoimplement: string | null };
  workers: {
    live: { session: string; ageMs: number; idea: string | null; status: string; stale: boolean }[];
    dead: string[];
  };
  gpu: { alive: boolean; upMs: number | null; autorun: string | null };
  ideas: { inFlight: number; needsRun: number; total: number; floor: number; ceiling: number };
  throughput: { flipsLastHour: number; lastFlipMs: number | null };
  best: { val: number; idea: string } | null;
};

type Minimax = {
  ok: boolean;
  intervalPercent?: number;
  weeklyPercent?: number;
  exhausted?: boolean;
};

// ms -> compact "4m" / "2h" / "3d" / "12s".
function ago(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

type Tone = "ok" | "warn" | "bad" | "muted";

const toneRing: Record<Tone, string> = {
  ok: "border-emerald-400/25",
  warn: "border-amber-400/40",
  bad: "border-rose-400/45",
  muted: "border-white/10",
};
const toneText: Record<Tone, string> = {
  ok: "text-emerald-300",
  warn: "text-amber-300",
  bad: "text-rose-300",
  muted: "text-[#faf9f6]",
};

// Styled hover tooltip. Pure CSS: it only fades in after the cursor has rested
// for ~600ms (delay applied in the hover variant), so a quick pass doesn't flash
// it; leaving hides it immediately. whitespace-pre-line keeps multi-line text.
function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="group/tip relative">
      {children}
      <div className="pointer-events-none absolute left-0 top-full z-50 mt-1.5 w-max max-w-xs whitespace-pre-line rounded-md border border-white/15 bg-[#2f2e2c] px-2.5 py-1.5 text-[11px] leading-snug text-[#faf9f6]/90 opacity-0 shadow-xl shadow-black/50 transition-opacity duration-150 group-hover/tip:opacity-100 group-hover/tip:delay-[600ms]">
        {text}
      </div>
    </div>
  );
}

function Chip({
  icon,
  label,
  value,
  sub,
  tone = "muted",
  title,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: Tone;
  title?: string;
}) {
  const body = (
    <div
      className={`flex min-w-[96px] flex-col rounded-md border bg-white/[0.03] px-2.5 py-1.5 ${toneRing[tone]}`}
    >
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[#faf9f6]/45">
        {icon}
        {label}
      </span>
      <span className={`text-base font-medium leading-tight ${toneText[tone]}`}>{value}</span>
      {sub ? <span className="text-[10px] text-[#faf9f6]/40">{sub}</span> : null}
    </div>
  );
  return title ? <Tip text={title}>{body}</Tip> : body;
}

export default function HealthBar({
  autoresearchOn,
  busy,
  onToggle,
}: {
  autoresearchOn: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  const [health, setHealth] = useState<Health | null>(null);
  const [minimax, setMinimax] = useState<Minimax | null>(null);
  const [reaping, setReaping] = useState(false);

  useEffect(() => {
    let alive = true;
    const pull = () =>
      fetch("/api/health/")
        .then((r) => r.json())
        .then((d) => {
          if (alive && d?.ok) setHealth(d);
        })
        .catch(() => {});
    pull();
    const id = setInterval(pull, 5_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const pull = () =>
      fetch("/api/minimax-usage/")
        .then((r) => r.json())
        .then((d) => {
          if (alive) setMinimax(d);
        })
        .catch(() => {});
    pull();
    const id = setInterval(pull, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Kill every dead w_<n> pane the snapshot reported, then refresh quickly.
  const reap = useCallback(async () => {
    if (!health?.workers.dead.length || reaping) return;
    setReaping(true);
    try {
      await Promise.all(
        health.workers.dead.map((name) =>
          fetch("/api/tmux/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "kill", name }),
          }).catch(() => {})
        )
      );
      const d = await fetch("/api/health/").then((r) => r.json());
      if (d?.ok) setHealth(d);
    } finally {
      setReaping(false);
    }
  }, [health, reaping]);

  const liveCount = health?.workers.live.length ?? 0;
  const staleCount = health?.workers.live.filter((w) => w.stale).length ?? 0;
  const deadCount = health?.workers.dead.length ?? 0;
  const inFlight = health?.ideas.inFlight ?? 0;
  const floor = health?.ideas.floor ?? 5;
  const lastFlipMs = health?.throughput.lastFlipMs ?? null;
  // The loop is "stalled" when autoresearch is on but nothing has flipped in a
  // while — the single signal that something upstream is wedged.
  const stalled = autoresearchOn && lastFlipMs != null && lastFlipMs > 20 * 60_000;

  const overall: Tone = !health
    ? "muted"
    : stalled || (autoresearchOn && !health.gpu.alive)
      ? "bad"
      : staleCount > 0 || deadCount > 0 || inFlight < floor || minimax?.exhausted
        ? "warn"
        : autoresearchOn
          ? "ok"
          : "muted";

  const dot =
    overall === "ok"
      ? "bg-emerald-400"
      : overall === "warn"
        ? "bg-amber-400"
        : overall === "bad"
          ? "bg-rose-400"
          : "bg-white/30";

  return (
    <div className="sticky top-0 z-30 w-full border-b border-white/10 bg-[#262524] shadow-lg shadow-black/30">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2">
        {/* Master Autoresearch toggle — the primary control, on top. */}
        <Tip
          text={
            autoresearchOn
              ? "Autoresearch is ON — ideas, implement, gates, and GPU runs all self-run. Click to stop."
              : "Autoresearch is OFF. Click to run the entire loop automatically."
          }
        >
          <button
            type="button"
            onClick={onToggle}
            disabled={busy}
            className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${
              autoresearchOn
                ? "border-violet-400/60 bg-violet-400/20 text-violet-100 hover:bg-violet-400/30 focus:ring-violet-400/40"
                : "border-white/15 bg-white/[0.04] text-[#faf9f6]/60 hover:border-white/30 hover:text-white focus:ring-white/20"
            }`}
          >
            {busy ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className={`h-3.5 w-3.5 ${autoresearchOn ? "fill-violet-200/30" : ""}`} aria-hidden />
            )}
            {busy ? "Saving" : autoresearchOn ? "Autoresearch on" : "Autoresearch off"}
          </button>
        </Tip>

        <span className={`mr-1 inline-block h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />

        {/* Chips */}
        <Chip
          icon={<Bot className="h-3 w-3" aria-hidden />}
          label="Workers"
          value={liveCount}
          sub={
            health?.workers.live[0]?.idea
              ? `${health.workers.live[0].idea.split("-")[0]} · ${ago(health.workers.live[0].ageMs)}`
              : "idle"
          }
          tone={staleCount > 0 ? "warn" : liveCount > 0 ? "ok" : "muted"}
          title={
            health?.workers.live.length
              ? health.workers.live
                  .map((w) => `${w.session} ${w.status || "?"} ${ago(w.ageMs)}${w.stale ? " (stale)" : ""}`)
                  .join("\n")
              : "No live gate workers"
          }
        />

        <Chip
          icon={<Cpu className="h-3 w-3" aria-hidden />}
          label="GPU drainer"
          value={health ? (health.gpu.alive ? "live" : "down") : "—"}
          sub={health?.gpu.alive ? `up ${ago(health.gpu.upMs)}` : health?.gpu.autorun ? "on, no session" : "off"}
          tone={!health ? "muted" : health.gpu.alive ? "ok" : autoresearchOn ? "bad" : "muted"}
          title="lab-autorun — the loop that SSHes to the box and drains the GPU queue"
        />

        {deadCount > 0 ? (
          <Tip text={`Dead tmux panes (no live worker):\n${health?.workers.dead.join("\n")}\n\nClick to reap.`}>
            <button
              type="button"
              onClick={reap}
              disabled={reaping}
              className={`flex min-w-[96px] flex-col rounded-md border bg-white/[0.03] px-2.5 py-1.5 text-left transition hover:bg-white/[0.06] ${toneRing.warn}`}
            >
              <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-amber-300/70">
                {reaping ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> : <AlertTriangle className="h-3 w-3" aria-hidden />}
                Dead panes
              </span>
              <span className="text-base font-medium leading-tight text-amber-300">{deadCount}</span>
              <span className="text-[10px] text-amber-300/60">{reaping ? "reaping…" : "click to reap"}</span>
            </button>
          </Tip>
        ) : null}

        <Chip
          icon={<Lightbulb className="h-3 w-3" aria-hidden />}
          label="In flight"
          value={
            <>
              {inFlight}
              <span className="ml-1 text-[11px] font-normal text-[#faf9f6]/40">/ {floor}</span>
            </>
          }
          sub={inFlight < floor ? "refilling" : "above floor"}
          tone={inFlight < floor ? "warn" : "ok"}
          title="Ideas not yet done/rejected. Below the floor, the miner generates more."
        />

        <Chip
          icon={<Cpu className="h-3 w-3" aria-hidden />}
          label="GPU queue"
          value={health?.ideas.needsRun ?? "—"}
          sub="needs-run"
          tone="muted"
          title="Ideas waiting for the GPU box"
        />

        <Chip
          icon={<Activity className="h-3 w-3" aria-hidden />}
          label="Flips / hr"
          value={health?.throughput.flipsLastHour ?? "—"}
          sub={lastFlipMs != null ? `last ${ago(lastFlipMs)} ago` : "no flips"}
          tone={stalled ? "bad" : "muted"}
          title="Status changes in the last hour, and time since the most recent one"
        />

        <Chip
          icon={<Gauge className="h-3 w-3" aria-hidden />}
          label="MiniMax"
          value={minimax?.ok && minimax.intervalPercent != null ? `${Math.round(minimax.intervalPercent)}% left` : "—"}
          sub={minimax?.ok && minimax.weeklyPercent != null ? `${Math.round(minimax.weeklyPercent)}% week left` : minimax?.exhausted ? "exhausted" : ""}
          tone={
            !minimax?.ok
              ? "muted"
              : minimax.exhausted
                ? "bad"
                : (minimax.intervalPercent ?? 100) < 20
                  ? "warn"
                  : "ok"
          }
          title="MiniMax 5-hour interval quota remaining. At 0 it 429s and the launcher falls back to Codex."
        />

        {health?.best ? (
          <Chip
            icon={<Trophy className="h-3 w-3" aria-hidden />}
            label="Best loss"
            value={health.best.val.toFixed(3)}
            sub={health.best.idea.split("-").slice(1).join("-") || health.best.idea}
            tone="ok"
            title={`Best val loss so far — ${health.best.idea}`}
          />
        ) : null}
      </div>
    </div>
  );
}
