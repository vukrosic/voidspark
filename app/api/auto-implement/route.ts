import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { getActiveRepoDir } from '@/lib/projects';
import {
  getAutoImplementAgent,
  setAutoImplement,
  MAX_PARALLEL_IMPLEMENTS,
} from '@/lib/autoimplement';

const execFileAsync = promisify(execFile);
const IDEAS_DIR = () => join(getActiveRepoDir(), 'autoresearch', 'ideas');
const FLIP_SH = () => join(getActiveRepoDir(), 'autoresearch', 'bin', 'flip.sh');
const IMPLEMENT_PREFIX = 'lab-implement-';

// Give-up thresholds. A failed run gets re-coded automatically, but after this
// many failures we stop burning GPU/agent time and escalate to a human. A
// blocked idea bounces implementing↔needs-review; after this many bounces it's a
// genuine dead-end (e.g. infeasible at this scale) and gets auto-rejected.
const RECODE_GIVEUP = 3;
const REVIEW_GIVEUP = 3;

function field(md: string, key: string): string {
  const m = md.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : '';
}

type Idea = {
  slug: string;
  dir: string;
  status: string;
  updated: string;
  // How many times this idea has entered each fixing/review state — read from
  // its log.jsonl transition history. Drives the give-up logic.
  recodeCount: number;
  reviewCount: number;
};

// Count how many log events flipped TO each given state.
async function transitionCounts(dir: string): Promise<{ recode: number; review: number }> {
  let recode = 0;
  let review = 0;
  try {
    const raw = await readFile(join(IDEAS_DIR(), dir, 'log.jsonl'), 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const to = JSON.parse(t).to;
        if (to === 'needs-recode' || to === 'recoding') recode += 1;
        else if (to === 'needs-review') review += 1;
      } catch {
        /* skip malformed line */
      }
    }
  } catch {
    /* no log yet */
  }
  return { recode, review };
}

async function allIdeas(): Promise<Idea[]> {
  let dirs: string[];
  try {
    dirs = await readdir(IDEAS_DIR());
  } catch {
    return [];
  }
  const ideas: Idea[] = [];
  for (const dir of dirs) {
    try {
      const md = await readFile(join(IDEAS_DIR(), dir, 'idea.md'), 'utf8');
      const counts = await transitionCounts(dir);
      ideas.push({
        slug: field(md, 'id') || dir,
        dir,
        status: field(md, 'status'),
        updated: field(md, 'updated'),
        recodeCount: counts.recode,
        reviewCount: counts.review,
      });
    } catch {
      /* skip non-idea dirs */
    }
  }
  return ideas;
}

// Server-side status flip via flip.sh (the UI /api/flip route is whitelist-only;
// the loop needs to set `rejected` and escalate, so it calls the script direct).
async function flip(slug: string, to: string, note: string): Promise<void> {
  try {
    await execFileAsync(FLIP_SH(), [slug, to, 'auto-implement', note], {
      cwd: getActiveRepoDir(),
      timeout: 15_000,
    });
  } catch {
    /* next tick retries */
  }
}

// Slugs that already have a live implement tmux session — our concurrency unit
// (the launcher creates the session synchronously, so this is reliable between
// ticks and prevents double-launching the same idea).
async function activeImplementSlugs(): Promise<Set<string>> {
  try {
    const { stdout } = await execFileAsync('tmux', ['ls', '-F', '#{session_name}'], {
      timeout: 10_000,
    });
    const slugs = stdout
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.startsWith(IMPLEMENT_PREFIX))
      .map((s) => s.slice(IMPLEMENT_PREFIX.length));
    return new Set(slugs);
  } catch {
    return new Set();
  }
}

type TickResult = { launched: string[]; rejected: string[]; escalated: string[] };

// Drive the implement pipeline one step:
//   1. Auto-reject genuine dead-ends sitting in `needs-review` (bounced too many
//      times — nothing will change on a retry).
//   2. Auto-fix failed runs (`needs-recode`) and brand-new ideas (`needs-taste`)
//      by launching an implement agent, oldest first, up to the parallel cap.
//      Recodes go first — unblocking work that already reached the GPU beats
//      starting something new. A recode that's failed too often is escalated to
//      `needs-review` instead of looping forever.
async function tick(host: string, agent: string): Promise<TickResult> {
  const ideas = await allIdeas();
  const active = await activeImplementSlugs();

  const rejected: string[] = [];
  const escalated: string[] = [];

  // 1. Dead-end reviews → rejected (sequential so the flips don't race).
  for (const idea of ideas) {
    if (idea.status === 'needs-review' && idea.reviewCount >= REVIEW_GIVEUP) {
      await flip(
        idea.slug,
        'rejected',
        `auto-rejected: blocked ${idea.reviewCount}x with no path forward (see log)`
      );
      rejected.push(idea.slug);
    }
  }

  // 2a. Recodes that have failed too many times → hand to a human.
  for (const idea of ideas) {
    if (
      (idea.status === 'needs-recode' || idea.status === 'recoding') &&
      idea.recodeCount >= RECODE_GIVEUP &&
      !active.has(idea.slug)
    ) {
      await flip(
        idea.slug,
        'needs-review',
        `auto-fix gave up after ${idea.recodeCount} failed runs — needs a human`
      );
      escalated.push(idea.slug);
    }
  }

  // 2b. Claimable = failed runs still worth retrying, then fresh proposals.
  const giveUp = new Set([...rejected, ...escalated]);
  const recodes = ideas
    .filter(
      (i) =>
        (i.status === 'needs-recode' || i.status === 'recoding') &&
        i.recodeCount < RECODE_GIVEUP &&
        !active.has(i.slug) &&
        !giveUp.has(i.slug)
    )
    .sort((a, b) => a.updated.localeCompare(b.updated));
  const proposed = ideas
    .filter((i) => i.status === 'needs-taste' && !active.has(i.slug))
    .sort((a, b) => a.updated.localeCompare(b.updated));
  const claimable = [...recodes, ...proposed];

  let budget = MAX_PARALLEL_IMPLEMENTS - active.size;
  const launched: string[] = [];
  for (const idea of claimable) {
    if (budget <= 0) break;
    // Reuse the existing implement-idea endpoint (claims the idea, injects the
    // recode preamble when needed, sets up the done-curl, launches the agent).
    // Fire-and-forget; failures just mean the next tick retries this slug.
    fetch(`http://${host}/api/implement-idea/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: idea.slug, agent, headless: true }),
    }).catch(() => {
      /* retried next tick */
    });
    launched.push(idea.slug);
    budget -= 1;
  }
  return { launched, rejected, escalated };
}

// Read or toggle auto-implement, and (whenever it's on) drive one tick. The UI
// calls this on load, on toggle, and on its poll — each call both reports state
// and keeps the implement pipeline filled up to the cap.
export async function POST(req: Request) {
  let body: { enabled?: unknown; agent?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* state read + tick */
  }

  if (typeof body.enabled === 'boolean') {
    const agent = typeof body.agent === 'string' ? body.agent : 'minimax';
    await setAutoImplement(body.enabled ? agent : null);
  }

  const current = await getAutoImplementAgent();
  let result: TickResult = { launched: [], rejected: [], escalated: [] };
  if (current) {
    const host = req.headers.get('host') ?? 'localhost:3000';
    result = await tick(host, current);
  }

  return Response.json(
    {
      success: true,
      enabled: current !== null,
      agent: current,
      maxParallel: MAX_PARALLEL_IMPLEMENTS,
      launched: result.launched,
      rejected: result.rejected,
      escalated: result.escalated,
    },
    { status: 200 }
  );
}
