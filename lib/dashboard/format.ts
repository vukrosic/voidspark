import type { Session, SessionTagKind } from "./types";
import { VERDICT_META, STATUS_META, FINISHED_STATUSES } from "./constants";

// The A/B verdict (from evidence.md) in plain words. "NULL" especially confuses
// — it does NOT mean failed, it means the change made no measurable difference
// (the loss delta fell inside the noise band between the two baselines).
export function verdictMeta(v: string): { label: string; help: string } {
  return VERDICT_META[v?.toUpperCase()] ?? { label: v || "—", help: "" };
}

export function statusMeta(s: string): { label: string; cls: string } {
  return (
    STATUS_META[s] ?? {
      label: s,
      cls: "border-amber-300/20 bg-amber-300/5 text-amber-200/80",
    }
  );
}

// "3s" / "2m 5s" — compact relative age for freshness labels.
// Compact, low-jitter duration. Seconds only under a minute (live feedback on
// fresh work); minutes-only up to an hour (no twitchy trailing seconds); then
// "Hh Mm". Easy to read at a glance — "32m", "2h 5m" — not "32m 14s" ticking.
export function formatAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// Whether a status gets a live "time in this state" timer. Rule, not a fixed
// list, so any in-flight status (current or future) is covered: every idea is
// timed EXCEPT needs-taste (Proposed — just waiting to be picked up) and the
// finished statuses (those show final results, not an elapsed clock).
export const isTimedStatus = (status: string) =>
  status !== "needs-taste" && !FINISHED_STATUSES.has(status);

export function sessionTagMeta(session: Session): {
  label: string;
  title: string;
  tone: string;
  kind: SessionTagKind;
} | null {
  const explicit = session.agentLabel?.trim();
  const command = session.agentCommand?.trim() ?? "";
  const probe = `${explicit ?? ""} ${command}`.trim().toLowerCase();
  if (!probe) return null;

  const title = command || explicit || session.name;
  if (probe.includes("codex")) {
    return {
      label: "Codex",
      title,
      tone: "border-cyan-300/20 bg-cyan-300/[0.06] text-cyan-100/80",
      kind: "codex",
    };
  }
  if (probe.includes("minimax") || probe.includes("claude-minimax-free")) {
    return {
      label: "MiniMax (cmf)",
      title,
      tone: "border-amber-300/20 bg-amber-300/[0.06] text-amber-100/80",
      kind: "minimax",
    };
  }
  if (probe.includes("claude")) {
    return {
      label: explicit || "Claude Code",
      title,
      tone: "border-violet-300/20 bg-violet-300/[0.06] text-violet-100/80",
      kind: "claude",
    };
  }
  if (probe.includes("bash") || probe.includes("zsh") || probe.includes("sh")) {
    return {
      label: "Shell",
      title,
      tone: "border-white/10 bg-white/[0.03] text-[#faf9f6]/55",
      kind: "shell",
    };
  }
  return {
    label: explicit || command || session.name,
    title,
    tone: "border-white/10 bg-white/[0.03] text-[#faf9f6]/55",
    kind: "other",
  };
}
