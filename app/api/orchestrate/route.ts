import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { launchCodexWithText } from '@/lib/codexLauncher';
import { getActiveRepoDir, hasActiveRepo } from '@/lib/projects';
import { getAutopilotAgent, setAutopilot } from '@/lib/autopilot';

// Autopilot tick. When ON, each call (the UI poll drives it) runs ONE
// orchestrate.sh pass — reclaim stale `-ing` locks + fan out one worker per
// actionable `needs-*` idea (taste/review/revise/recode/plan) — then refills the
// idea pool with the miner when it runs low. Gates only; the GPU queue is
// drained by the companion autorun loop. orchestrate.sh is idempotent, so
// ticking it repeatedly never stacks duplicate workers.
const execFileAsync = promisify(execFile);

const IDEAS_DIR = () => join(getActiveRepoDir(), 'autoresearch', 'ideas');
const ORCH = () => join(getActiveRepoDir(), 'autoresearch', 'bin', 'orchestrate.sh');
const GEN_PROMPT = () => join(getActiveRepoDir(), 'autoresearch', 'prompts', 'generate-ideas.md');
const GEN_SESSION = 'lab-generate-ideas';

// Auto-refill bounds (chosen 2026-06-14): keep at least FLOOR ideas in flight,
// never exceed CEILING. "In flight" = any idea not done/rejected.
const FLOOR = 5;
const CEILING = 20;

function field(md: string, key: string): string {
  const m = md.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : '';
}

async function statusCounts(): Promise<{ inFlight: number; needsRun: number; total: number }> {
  let dirs: string[];
  try {
    dirs = await readdir(IDEAS_DIR());
  } catch {
    return { inFlight: 0, needsRun: 0, total: 0 };
  }
  let inFlight = 0;
  let needsRun = 0;
  let total = 0;
  for (const dir of dirs) {
    let md: string;
    try {
      md = await readFile(join(IDEAS_DIR(), dir, 'idea.md'), 'utf8');
    } catch {
      continue;
    }
    const status = field(md, 'status');
    if (!status) continue;
    total += 1;
    if (status !== 'done' && status !== 'rejected') inFlight += 1;
    if (status === 'needs-run') needsRun += 1;
  }
  return { inFlight, needsRun, total };
}

async function sessionAlive(name: string): Promise<boolean> {
  try {
    await execFileAsync('tmux', ['has-session', '-t', name], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

// Run one orchestrate.sh pass through a login shell so the worker CLI (cmf) is on
// PATH. It launches detached tmux workers and returns fast; capture its summary.
async function runOrchestrator(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('bash', ['-lc', `STALE_MIN=7 ${JSON.stringify(ORCH())}`], {
      timeout: 90_000,
      cwd: getActiveRepoDir(),
    });
    const lines = stdout.trim().split('\n');
    return lines[lines.length - 1] ?? ''; // the "--- summary: … ---" line
  } catch (e) {
    return `orchestrate error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// Inject the batch size into the miner prompt, same contract as /api/generate-ideas.
function injectCount(prompt: string, count: number): string {
  const line = `Generate exactly ${count} new idea${count === 1 ? '' : 's'} this pass.`;
  const re = /Generate exactly \d+ new ideas? this pass\./;
  if (re.test(prompt)) return prompt.replace(re, line);
  return `${prompt.trimEnd()}\n\n**${line}**\n`;
}

export async function POST(req: Request) {
  if (!hasActiveRepo()) {
    return Response.json({ success: false, error: 'No project selected' }, { status: 200 });
  }
  let body: { enabled?: unknown; agent?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* state read + tick */
  }

  if (typeof body.enabled === 'boolean') {
    const agent = typeof body.agent === 'string' ? body.agent : 'minimax';
    await setAutopilot(body.enabled ? agent : null);
  }

  const agent = await getAutopilotAgent();
  const counts = await statusCounts();
  let summary = '';
  let generated = 0;

  if (agent) {
    // 1. Drive the gates (reclaim + fan out workers for needs-* ideas).
    summary = await runOrchestrator();

    // 2. Refill when the pool is low — but never above the ceiling, and never
    //    while a generation pass is already running.
    if (counts.inFlight < FLOOR && counts.inFlight < CEILING) {
      const genBusy = await sessionAlive(GEN_SESSION);
      if (!genBusy) {
        const count = Math.max(1, Math.min(FLOOR, CEILING - counts.inFlight));
        try {
          const prompt = injectCount(await readFile(GEN_PROMPT(), 'utf8'), count);
          const res = await launchCodexWithText(
            prompt,
            'lab-generate-ideas',
            getActiveRepoDir(),
            GEN_SESSION,
            agent,
            { headless: true }
          );
          if (res.success) generated = count;
        } catch {
          /* miner launch failed — next tick retries */
        }
      }
    }
  }

  return Response.json(
    {
      success: true,
      enabled: agent !== null,
      agent,
      inFlight: counts.inFlight,
      needsRun: counts.needsRun,
      floor: FLOOR,
      ceiling: CEILING,
      generated,
      summary,
    },
    { status: 200 }
  );
}
