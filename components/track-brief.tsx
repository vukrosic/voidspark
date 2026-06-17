"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpen, FileText, PanelRightOpen } from "lucide-react";

// The active track's top-level docs — its research brief.md and, once written,
// its report.md — surfaced as COMPACT single-line bars so they never crowd the
// records board. Clicking one opens that file in the shared side MarkdownPanel
// (preview/edit) rather than rendering inline. Read live from `/api/track-brief`
// (which now serves any track doc via `{ file }`), resolved through the
// active-track seam, so switching tracks swaps both docs automatically.
//
// `reloadSignal` bumps on every track switch/create so we re-fetch; `onOpen`
// hands the doc's repo-relative path to the parent's MarkdownPanel.
type Doc = { title: string; path: string };

export default function TrackBrief({
  reloadSignal,
  onOpen,
}: {
  reloadSignal: number;
  onOpen: (path: string, title: string) => void;
}) {
  const [brief, setBrief] = useState<Doc | null>(null);
  const [report, setReport] = useState<Doc | null>(null);
  const [trackName, setTrackName] = useState<string>("");

  // Fetch one track doc; returns null when the file doesn't exist for this track.
  const fetchDoc = useCallback(
    async (file: string): Promise<(Doc & { track: string }) | null> => {
      try {
        const res = await fetch("/api/track-brief/", {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ file }),
        });
        const d = await res.json().catch(() => ({}));
        if (d?.success && typeof d.content === "string") {
          const noFm = d.content.replace(/^---\n[\s\S]*?\n---\n?/, "");
          const h1 = noFm.match(/^#\s+(.+)$/m)?.[1]?.trim();
          return {
            title: h1 || "",
            path: typeof d.path === "string" ? d.path : "",
            track: d?.track?.name ?? "",
          };
        }
      } catch {
        /* leave caller to keep last-known state */
      }
      return null;
    },
    []
  );

  const load = useCallback(async () => {
    const [b, r] = await Promise.all([fetchDoc("brief.md"), fetchDoc("report.md")]);
    setBrief(b ? { title: b.title || `${b.track} brief`, path: b.path } : null);
    setReport(r ? { title: r.title || `${r.track} report`, path: r.path } : null);
    setTrackName(b?.track || r?.track || "");
  }, [fetchDoc]);

  useEffect(() => {
    load();
  }, [load, reloadSignal]);

  // Neither doc for this track → render nothing (the board leads instead).
  if (!brief && !report) return null;

  return (
    <div className="flex w-full flex-wrap items-stretch gap-2">
      {brief && (
        <button
          type="button"
          onClick={() => brief.path && onOpen(brief.path, `${trackName} · brief.md`)}
          title="Open the research brief in the side panel"
          className="group flex min-w-[220px] flex-1 items-center gap-2.5 rounded-xl border border-sky-400/15 bg-sky-400/[0.03] px-4 py-2.5 text-left transition hover:border-sky-400/35 hover:bg-sky-400/[0.06]"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-sky-400/25 bg-sky-400/[0.07] text-sky-200">
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-sky-200/50">
            Brief
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-sky-50/85">
            {brief.title}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-sky-200/45 transition group-hover:text-sky-200/80">
            <PanelRightOpen className="h-3.5 w-3.5" aria-hidden />
            Open
          </span>
        </button>
      )}

      {report && (
        <button
          type="button"
          onClick={() => report.path && onOpen(report.path, `${trackName} · report.md`)}
          title="Open the research report in the side panel"
          className="group flex min-w-[220px] flex-1 items-center gap-2.5 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.03] px-4 py-2.5 text-left transition hover:border-emerald-400/35 hover:bg-emerald-400/[0.06]"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-200">
            <FileText className="h-3.5 w-3.5" aria-hidden />
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-emerald-200/50">
            Report
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-emerald-50/85">
            {report.title}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-200/45 transition group-hover:text-emerald-200/80">
            <PanelRightOpen className="h-3.5 w-3.5" aria-hidden />
            Open
          </span>
        </button>
      )}
    </div>
  );
}
