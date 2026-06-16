import type { ReactNode } from "react";
import { FileText, LoaderCircle, RefreshCw, Terminal, Zap } from "lucide-react";
import type { Idea } from "@/lib/dashboard/types";
import { statusMeta, isTimedStatus, formatAgo } from "@/lib/dashboard/format";
import {
  FINISHED_STATUSES,
  IMPLEMENT_SESSION_PREFIX,
  RUN_SESSION_PREFIX,
} from "@/lib/dashboard/constants";
import { renderResult } from "@/components/result-card";

// One idea row — the title, status badge, action buttons, and (if the A/B has
// finished) the verdict + numbers. Used by every grouped list so the cards stay
// identical wherever they appear. All live state and handlers come in as props
// so this stays a pure presentational component.
type IdeaCardProps = {
  idea: Idea;
  extra?: ReactNode;
  showResult?: boolean;
  // tmux session names that are alive right now (drives the live/attach state)
  liveSessions: Set<string>;
  // the idea id whose implement launch is in flight (disables its buttons)
  implementing: string | null;
  // the session name whose attach is in flight (spinner on its Attach button)
  attaching: string | null;
  autoImplementOn: boolean;
  // ticking clock (ms) — re-renders the "added Xago" / time-in-state labels
  now: number;
  onOpenFile: (file: { path: string; title: string }) => void;
  onReset: (slug: string, status?: string, note?: string) => void;
  onImplement: (slug: string) => void;
  onAttach: (name: string) => void;
};

export function IdeaCard({
  idea,
  extra,
  showResult = true,
  liveSessions,
  implementing,
  attaching,
  autoImplementOn,
  now,
  onOpenFile,
  onReset,
  onImplement,
  onAttach,
}: IdeaCardProps) {
  // "time in this state" relative to the ticking clock; null when no timestamp.
  const timeInState = (iso: string): string | null => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? formatAgo(now - t) : null;
  };
  // The same moment as a wall-clock time in the viewer's local timezone.
  const localTime = (iso: string): string => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? new Date(t).toLocaleTimeString() : "";
  };

  const implementSessionName = IMPLEMENT_SESSION_PREFIX + idea.id;
  const runSessionName = RUN_SESSION_PREFIX + idea.id;
  const liveImplement = liveSessions.has(implementSessionName);
  const liveRun = liveSessions.has(runSessionName);
  const liveSessionName = liveRun ? runSessionName : implementSessionName;
  const isLive = liveImplement || liveRun;
  const isTrackedWip =
    idea.status === "implementing" || idea.status === "running";
  const isStuck = isTrackedWip && !isLive;
  const busy = implementing === idea.id;
  const canImplement = !["needs-run", "running", "done"].includes(idea.status);

  return (
    <li
      className="rounded-md border border-white/10 bg-white/[0.025] px-3 py-2.5"
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onOpenFile({ path: idea.path, title: idea.title })}
          title={`Open ${idea.title}`}
          className="min-w-0 flex-1 text-left transition hover:opacity-80 focus:outline-none"
        >
          <p className="truncate text-sm font-semibold text-[#faf9f6]">
            {idea.title}
          </p>
          {idea.plain && (
            <p className="mt-1 line-clamp-2 text-xs text-[#faf9f6]/55">{idea.plain}</p>
          )}
        </button>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {isLive && (
              <span className="flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-emerald-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                {liveRun ? "gpu" : "working"}
              </span>
            )}
            {isStuck && (
              <span className="text-[10px] uppercase tracking-[0.15em] text-orange-300">
                stuck
              </span>
            )}
            {isTimedStatus(idea.status) && timeInState(idea.updated) && (
              <span
                title={`in this state for ${timeInState(idea.updated)} · since ${localTime(idea.updated)}`}
                className="font-mono text-[10px] tabular-nums text-[#faf9f6]/40"
              >
                {timeInState(idea.updated)}
              </span>
            )}
            <span
              title={idea.status}
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${statusMeta(idea.status).cls}`}
            >
              {statusMeta(idea.status).label}
            </span>
          </div>
          {idea.created != null && (
            <span
              title={`first mined ${localTime(new Date(idea.created).toISOString())}`}
              className="font-mono text-[10px] tabular-nums text-[#faf9f6]/30"
            >
              added {formatAgo(now - idea.created)} ago
            </span>
          )}
          <div className="flex items-center gap-2">
            {idea.evidencePath && (
              <button
                type="button"
                onClick={() =>
                  onOpenFile({
                    path: idea.evidencePath!,
                    title: `${idea.title} — evidence`,
                  })
                }
                title={`Open evidence for ${idea.title}`}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-fuchsia-300/25 bg-fuchsia-300/[0.07] px-2 text-[11px] font-medium text-fuchsia-200 transition hover:border-fuchsia-300/50 hover:bg-fuchsia-300/[0.12] hover:text-white focus:outline-none focus:ring-2 focus:ring-fuchsia-300/35"
              >
                <FileText className="h-3.5 w-3.5" aria-hidden />
                Evidence
              </button>
            )}
            {isStuck && (
              <button
                type="button"
                onClick={() =>
                  onReset(
                    idea.id,
                    idea.status === "running" ? "needs-run" : "needs-taste",
                    idea.status === "running"
                      ? "requeued stuck GPU run from UI"
                      : "reset stuck idea from UI"
                  )
                }
                disabled={busy}
                title={
                  idea.status === "running"
                    ? "Requeue this stuck GPU run"
                    : "Reset this stuck idea back to Proposed"
                }
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-orange-400/25 bg-orange-400/[0.07] px-2 text-[11px] font-medium text-orange-300 transition hover:border-orange-400/50 hover:bg-orange-400/[0.12] hover:text-white focus:outline-none focus:ring-2 focus:ring-orange-400/35 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                {idea.status === "running" ? "Requeue" : "Reset"}
              </button>
            )}
            {isLive ? (
              <button
                type="button"
                onClick={() => onAttach(liveSessionName)}
                disabled={attaching === liveSessionName}
                title={`Attach to ${liveSessionName}`}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-cyan-300/25 bg-cyan-300/[0.07] px-2 text-[11px] font-medium text-cyan-200 transition hover:border-cyan-300/50 hover:bg-cyan-300/[0.12] hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/35 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {attaching === liveSessionName ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Terminal className="h-3.5 w-3.5" aria-hidden />
                )}
                Attach
              </button>
            ) : (canImplement && !autoImplementOn) ||
              (isStuck && idea.status !== "running") ? (
              // When auto-implement is on, the normal "Implement" run-once
              // button is hidden (the tick handles Proposed ideas); the stuck
              // "Retry" recovery button still shows.
              <button
                type="button"
                onClick={() => onImplement(idea.id)}
                disabled={busy}
                title={
                  isStuck
                    ? "Retry this idea with a fresh implementation pass"
                    : "Implement this idea now"
                }
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-emerald-400/25 bg-emerald-400/[0.07] px-2 text-[11px] font-medium text-emerald-300 transition hover:border-emerald-400/50 hover:bg-emerald-400/[0.12] hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400/35 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Zap className="h-3.5 w-3.5" aria-hidden />
                )}
                {busy ? "Launching…" : isStuck ? "Retry" : "Implement"}
              </button>
            ) : idea.status === "needs-run" ? (
              <span className="inline-flex h-7 items-center rounded-md border border-cyan-300/20 bg-cyan-300/5 px-2 text-[11px] font-medium text-cyan-200/70">
                Queued
              </span>
            ) : null}
          </div>
        </div>
      </div>
      {showResult && idea.result && renderResult(idea.result, !FINISHED_STATUSES.has(idea.status))}
      {extra}
    </li>
  );
}
