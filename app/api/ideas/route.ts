import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { getActiveRepoDir, hasActiveRepo } from '@/lib/projects';

const ideasDir = () => join(getActiveRepoDir(), 'autoresearch', 'ideas');

// When the idea first appeared, in epoch ms — the `ts` on the FIRST line of its
// log.jsonl (the mine/seed event), which is the true "added" moment. Falls back
// to the folder's birthtime if the log is missing/unparseable. null if neither
// is readable, in which case the UI just omits the "added Xago" label.
async function minedAt(dir: string): Promise<number | null> {
  try {
    const log = await readFile(join(ideasDir(), dir, 'log.jsonl'), 'utf8');
    const first = log.split('\n').find((l) => l.trim());
    if (first) {
      const ts = (JSON.parse(first) as { ts?: string }).ts;
      const ms = ts ? Date.parse(ts) : NaN;
      if (Number.isFinite(ms)) return ms;
    }
  } catch {
    /* no/!parseable log — fall through to birthtime */
  }
  try {
    const s = await stat(join(ideasDir(), dir));
    const ms = s.birthtimeMs || s.mtimeMs;
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

type Result = {
  verdict: string; // WIN | NULL | DRIFT | FAIL | ...
  controlVal: number | null;
  treatmentVal: number | null;
  ctrl2Val: number | null;
  deltaCtrl: number | null;
  deltaCtrl2: number | null;
};

type Idea = {
  id: string;
  title: string;
  status: string;
  plain: string;
  updated: string;
  created: number | null; // epoch ms the idea was first mined (see minedAt)
  path: string;
  evidencePath: string | null;
  result: Result | null;
};

function num(md: string, label: string): number | null {
  // e.g. "- control val: 6.4037" / "- delta vs ctrl: +0.0054"
  const m = md.match(new RegExp(`${label}\\s*:?\\s*([+-]?\\d+(?:\\.\\d+)?)`, 'i'));
  return m ? Number(m[1]) : null;
}

// Pull the baseline-vs-experiment numbers out of an evidence.md so the UI can
// chart them. Returns null if the file has no recognisable val losses.
function parseEvidence(md: string): Result | null {
  const verdictMatch = md.match(/##\s*Verdict:\s*([A-Za-z]+)/i);
  const controlVal = num(md, 'control val');
  const treatmentVal = num(md, 'treatment val');
  const ctrl2Val = num(md, 'ctrl2 val');
  if (controlVal === null && treatmentVal === null) return null;
  return {
    verdict: verdictMatch ? verdictMatch[1].toUpperCase() : '',
    controlVal,
    treatmentVal,
    ctrl2Val,
    deltaCtrl: num(md, 'delta vs ctrl(?!2)') ?? num(md, 'delta vs ctrl'),
    deltaCtrl2: num(md, 'delta vs ctrl2'),
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

async function listIdeas(): Promise<Idea[]> {
  let entries: string[];
  try {
    entries = await readdir(ideasDir());
  } catch {
    return [];
  }

  const ideas: Idea[] = [];
  for (const dir of entries) {
    try {
      const md = await readFile(join(ideasDir(), dir, 'idea.md'), 'utf8');
      const fm = parseFrontmatter(md);
      // Read evidence.md if present, and parse the loss numbers out of it.
      let evidenceMd: string | null = null;
      try {
        evidenceMd = await readFile(join(ideasDir(), dir, 'evidence.md'), 'utf8');
      } catch {
        evidenceMd = null;
      }
      ideas.push({
        id: fm.id || dir,
        title: parseTitle(md, dir),
        status: fm.status || 'unknown',
        plain: fm.plain || '',
        updated: fm.updated || '',
        created: await minedAt(dir),
        path: `autoresearch/ideas/${dir}/idea.md`,
        evidencePath: evidenceMd !== null ? `autoresearch/ideas/${dir}/evidence.md` : null,
        result: evidenceMd !== null ? parseEvidence(evidenceMd) : null,
      });
    } catch {
      // No idea.md in this folder — skip.
    }
  }

  // Newest first by updated timestamp, falling back to id.
  ideas.sort((a, b) => (b.updated || b.id).localeCompare(a.updated || a.id));
  return ideas;
}

// POST-only: this site builds with `output: 'export'`, which rejects dynamic
// GET route handlers. Returns the list of ideas on disk.
export async function POST() {
  if (!hasActiveRepo()) {
    return Response.json({ success: false, error: 'No project selected' }, { status: 200 });
  }
  return Response.json({ success: true, ideas: await listIdeas() }, { status: 200 });
}
