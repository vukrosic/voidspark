import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { hasActiveRepo } from '@/lib/projects';
import { getActiveAutoresearchDir } from '@/lib/tracks';

// ---- Finished Experiments Leaderboard --------------------------------------
// The leaderboard only shows ideas that have a verdict — i.e. the human
// reviewer has actually looked at the run and called it WIN / NULL / FAIL /
// DRIFT. Anything still in the queue is the live dashboard's job, not this.
//
// One row per finished idea, sourced from `autoresearch/ideas/<id>/evidence.md`.
// The page does its own sort + verdict filter on the client; this route just
// gives it a stable, flat shape so the UI doesn't have to re-parse markdown.

const ideasDir = () => join(getActiveAutoresearchDir(), 'ideas');

type LeaderboardRow = {
  id: string;
  title: string;
  tier: string;
  verdict: string;     // WIN | NULL | FAIL | DRIFT (uppercase, from evidence.md)
  delta: number | null; // delta vs ctrl — most negative = best
  controlVal: number | null;
  treatmentVal: number | null;
  ctrl2Val: number | null;
  date: string;          // YYYY-MM-DD
  updated: string;
  evidencePath: string;
  ideaPath: string;
  plain: string;        // one-line plain-language description from frontmatter
};

function num(md: string, label: string): number | null {
  // "- control val: 6.4037" / "- delta vs ctrl: +0.0054" / "- treatment val: 6.39"
  const m = md.match(new RegExp(`${label}\\s*:?\\s*([+-]?\\d+(?:\\.\\d+)?)`, 'i'));
  return m ? Number(m[1]) : null;
}

// Tier/date come out of the structured first block of evidence.md. The format
// is loose (single line, free key ordering) so we just match each field.
function parseEvidence(md: string): {
  verdict: string;
  tier: string;
  date: string;
  controlVal: number | null;
  treatmentVal: number | null;
  ctrl2Val: number | null;
  delta: number | null;
} | null {
  const verdictMatch = md.match(/##\s*Verdict:\s*([A-Za-z]+)/i);
  if (!verdictMatch) return null;
  const verdict = verdictMatch[1].toUpperCase();

  const tierMatch = md.match(/^\s*-\s*tier:\s*([^\n,]+)/im);
  const dateMatch = md.match(/^\s*-\s*date:\s*(\d{4}-\d{2}-\d{2})/im);
  return {
    verdict,
    tier: tierMatch ? tierMatch[1].trim() : 'unknown',
    date: dateMatch ? dateMatch[1] : '',
    controlVal: num(md, 'control val'),
    treatmentVal: num(md, 'treatment val'),
    ctrl2Val: num(md, 'ctrl2 val'),
    delta: num(md, 'delta vs ctrl(?!2)') ?? num(md, 'delta vs ctrl'),
  };
}

function parseFrontmatter(md: string): Record<string, string> {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) fields[key] = value;
  }
  return fields;
}

function parseTitle(md: string, fallback: string): string {
  const match = md.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

async function listFinishedIdeas(): Promise<LeaderboardRow[]> {
  let entries: string[];
  try {
    entries = await readdir(ideasDir());
  } catch {
    return [];
  }

  const rows: LeaderboardRow[] = [];
  for (const dir of entries) {
    try {
      const [ideaMd, evidenceMd] = await Promise.all([
        readFile(join(ideasDir(), dir, 'idea.md'), 'utf8'),
        readFile(join(ideasDir(), dir, 'evidence.md'), 'utf8'),
      ]);
      const ev = parseEvidence(evidenceMd);
      if (!ev) continue; // no verdict yet — not "finished"
      const fm = parseFrontmatter(ideaMd);
      rows.push({
        id: fm.id || dir,
        title: parseTitle(ideaMd, dir),
        tier: ev.tier,
        verdict: ev.verdict,
        delta: ev.delta,
        controlVal: ev.controlVal,
        treatmentVal: ev.treatmentVal,
        ctrl2Val: ev.ctrl2Val,
        date: ev.date,
        updated: fm.updated || '',
        evidencePath: `autoresearch/ideas/${dir}/evidence.md`,
        ideaPath: `autoresearch/ideas/${dir}/idea.md`,
        plain: fm.plain || '',
      });
    } catch {
      // No idea.md / evidence.md pair — skip.
    }
  }

  // Default sort: best delta first (most negative at top). The page can resort
  // client-side; this is just the load order.
  rows.sort((a, b) => {
    if (a.delta === null && b.delta === null) return 0;
    if (a.delta === null) return 1;
    if (b.delta === null) return -1;
    return a.delta - b.delta;
  });
  return rows;
}

// POST-only: same reason as the other API routes — the app builds with
// `output: 'export'`-style dynamic handlers (training-curve, ideas, etc.).
export async function POST() {
  if (!hasActiveRepo()) {
    return Response.json({ success: false, error: 'No project selected' }, { status: 200 });
  }
  return Response.json({ success: true, rows: await listFinishedIdeas() }, { status: 200 });
}