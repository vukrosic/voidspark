"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Layers, Plus, X } from "lucide-react";

type Track = { id: string; name: string };

// Compact record-track switcher. A "track" is an independent research workspace
// in the active project (its own ideas / records / leaderboard) — switching
// re-points the records board, leaderboard, and idea lists. GPU/orchestration
// are deliberately NOT scoped here; you point a GPU at a track yourself.
//
// onChange fires after a switch or a create so the parent can re-fetch the
// track-scoped data (ideas + records).
export default function TrackSwitcher({ onChange }: { onChange?: () => void }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [active, setActive] = useState("main");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tracks/", { cache: "no-store" });
      const d = await res.json();
      setTracks(Array.isArray(d.tracks) ? d.tracks : []);
      setActive(typeof d.active === "string" ? d.active : "main");
    } catch {
      /* leave last-known state */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const select = useCallback(
    async (id: string) => {
      if (id === active || busy) return;
      setBusy(true);
      setActive(id); // optimistic — the data refresh follows
      try {
        await fetch("/api/tracks/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "select", id }),
        });
        onChange?.();
      } finally {
        setBusy(false);
      }
    },
    [active, busy, onChange]
  );

  // De-register a track. The server keeps the track's folder (ideas, records,
  // brief) on disk — only the registry entry goes — so this never destroys
  // experiments. Confirm spells that out so a delete isn't mistaken for a wipe.
  const remove = useCallback(
    async (t: Track) => {
      if (busy || t.id === "main") return;
      const ok = window.confirm(
        `Delete the "${t.name}" thread?\n\n` +
          `It's removed from the switcher, but its experiments and records stay ` +
          `on disk (autoresearch/tracks/${t.id}/). Nothing is wiped — re-add the ` +
          `track later to bring them back.`
      );
      if (!ok) return;
      setBusy(true);
      try {
        const res = await fetch("/api/tracks/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "delete", id: t.id }),
        });
        const d = await res.json();
        if (d.ok) {
          setTracks(Array.isArray(d.tracks) ? d.tracks : []);
          setActive(typeof d.active === "string" ? d.active : "main");
          onChange?.();
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, onChange]
  );

  const create = useCallback(async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/tracks/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", name: n }),
      });
      const d = await res.json();
      if (d.ok) {
        setTracks(Array.isArray(d.tracks) ? d.tracks : []);
        setActive(typeof d.active === "string" ? d.active : "main");
        setName("");
        setAdding(false);
        onChange?.();
      }
    } finally {
      setBusy(false);
    }
  }, [name, busy, onChange]);

  // No project → nothing to scope. (The route returns an empty list.)
  if (tracks.length === 0) return null;

  return (
    <div className="flex w-full max-w-4xl flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-[#faf9f6]/35">
        <Layers className="h-3.5 w-3.5" aria-hidden />
        Tracks
      </span>
      {tracks.map((t) => {
        const on = t.id === active;
        const deletable = t.id !== "main";
        return (
          <span
            key={t.id}
            className={`group inline-flex h-7 items-center rounded-full border text-[11px] font-medium transition ${
              on
                ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-100"
                : "border-white/10 bg-white/[0.03] text-[#faf9f6]/60 hover:border-white/20"
            }`}
          >
            <button
              type="button"
              onClick={() => select(t.id)}
              disabled={busy}
              title={on ? `Active track: ${t.name}` : `Switch to ${t.name}`}
              className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 transition focus:outline-none disabled:opacity-60 ${
                on ? "" : "hover:text-[#faf9f6]/90"
              } ${deletable ? "pr-1.5" : ""}`}
            >
              {on && <Check className="h-3 w-3" aria-hidden />}
              {t.name}
            </button>
            {deletable && (
              <button
                type="button"
                onClick={() => remove(t)}
                disabled={busy}
                aria-label={`Delete ${t.name} thread`}
                title={`Delete the ${t.name} thread (keeps its experiments on disk)`}
                className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full opacity-50 transition hover:bg-red-400/20 hover:text-red-200 hover:opacity-100 focus:outline-none disabled:opacity-30"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
          </span>
        );
      })}

      {adding ? (
        <span className="inline-flex h-7 items-center gap-1 rounded-full border border-white/15 bg-black/30 pl-3 pr-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") {
                setAdding(false);
                setName("");
              }
            }}
            placeholder="track name"
            className="w-28 bg-transparent text-[11px] text-[#faf9f6] placeholder:text-[#faf9f6]/30 focus:outline-none"
          />
          <button
            type="button"
            onClick={create}
            disabled={busy || !name.trim()}
            title="Create track"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-emerald-300 transition hover:bg-emerald-300/15 disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setName("");
            }}
            title="Cancel"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#faf9f6]/40 transition hover:bg-white/10"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          title="Add a new record track"
          className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-white/15 px-3 text-[11px] font-medium text-[#faf9f6]/50 transition hover:border-white/30 hover:text-[#faf9f6]/80"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add track
        </button>
      )}
    </div>
  );
}
