"use client";

import { useEffect, useState } from "react";
import { MarkdownRenderer } from "./markdown-renderer";

// Documentation view — surfaces the hand-written .md files that live INSIDE
// this VoidSpark app folder (README, PLAN, scripts/*). The research repo's
// own docs (PIPELINE, queue, etc.) are exposed by the project view, not here,
// so the sidebar stays focused on VoidSpark itself. Click a card → slide-in
// preview served by /api/voidspark-doc, which is path-scoped to this folder.
type Doc = { path: string; title: string; hint: string };
type DocGroup = { heading: string; blurb: string; docs: Doc[] };

const DOC_GROUPS: DocGroup[] = [
  {
    heading: "About this app",
    blurb: "Top-level orientation for the VoidSpark dashboard itself.",
    docs: [
      { path: "README.md", title: "README", hint: "What VoidSpark is, how to run it" },
      { path: "PLAN.md", title: "PLAN", hint: "Goals + non-goals for the dashboard" },
    ],
  },
  {
    heading: "Scripts",
    blurb: "The helper shell scripts shipped vendored with this app.",
    docs: [
      { path: "scripts/README.md", title: "Scripts README", hint: "Agent launch + monitor watchdog scripts" },
    ],
  },
];

export default function DocumentationView({ onHome }: { onHome: () => void }) {
  const [open, setOpen] = useState<Doc | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!open) {
      setContent("");
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch("/api/voidspark-doc/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: open.path }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) setContent(d.content ?? "");
        else setError(d.error ?? "unknown error");
      })
      .catch(() => !cancelled && setError("Error loading file"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <div className="min-h-screen flex-1 bg-[#1f1e1d] pt-10 text-[#faf9f6] md:pt-12">
      <div className="container mx-auto px-6 py-10">
        <div className="mb-8 flex items-baseline justify-between gap-4">
          <div>
            <h1 className="font-mono text-2xl tracking-[0.08em] text-[#faf9f6]">
              Documentation
            </h1>
            <p className="mt-1 text-sm text-[#faf9f6]/55">
              Hand-written .md files that ship inside this VoidSpark app folder.
              Click a card to open it in the side panel. Project-side docs
              (PIPELINE, queue, brief) live in the research repo and are not
              listed here.
            </p>
          </div>
          <button
            type="button"
            onClick={onHome}
            className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#faf9f6]/50 transition hover:text-[#faf9f6]"
          >
            ← Home
          </button>
        </div>

        <div className="flex flex-col gap-10">
          {DOC_GROUPS.map((group) => (
            <section key={group.heading}>
              <div className="mb-3 flex items-baseline justify-between gap-4">
                <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-amber-200/80">
                  {group.heading}
                </h2>
                <p className="text-xs text-[#faf9f6]/40">{group.blurb}</p>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.docs.map((doc) => (
                  <button
                    key={doc.path}
                    type="button"
                    onClick={() => setOpen(doc)}
                    className="group flex flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-amber-300/40 hover:bg-amber-300/[0.05]"
                  >
                    <span className="font-mono text-sm text-[#faf9f6] group-hover:text-amber-100">
                      {doc.title}
                    </span>
                    <span className="font-mono text-[10px] text-[#faf9f6]/40">
                      {doc.path}
                    </span>
                    <span className="mt-2 text-xs text-[#faf9f6]/55">{doc.hint}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>

        <p className="mt-12 text-xs text-[#faf9f6]/30">
          Missing a doc? Drop a .md inside the VoidSpark folder and add a row
          to <span className="font-mono">components/documentation-view.tsx</span>.
        </p>
      </div>

      {/* Slide-in preview — only mounted when a card is open. Read-only here
          because these files are part of the app itself, not user-editable. */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(null)} />
          <div className="relative flex h-full w-full max-w-2xl flex-col border-l border-white/10 bg-[#1f1e1d] shadow-2xl">
            <div className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
              <div className="min-w-0">
                <h2 className="truncate font-mono text-sm text-amber-200/80">
                  {open.title}
                </h2>
                <p className="truncate font-mono text-[10px] text-[#faf9f6]/40">
                  {open.path}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(null)}
                className="text-xs uppercase tracking-[0.2em] text-[#faf9f6]/50 transition hover:text-[#faf9f6]"
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              {loading ? (
                <p className="text-sm text-[#faf9f6]/40">Loading…</p>
              ) : error ? (
                <p className="text-sm text-red-300">✗ {error}</p>
              ) : (
                // Strip leading YAML frontmatter so it doesn't bleed into the
                // rendered preview (same convention as the home view's panel).
                <MarkdownRenderer
                  content={content.replace(/^---\n[\s\S]*?\n---\n?/, "")}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
