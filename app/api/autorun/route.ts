import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { openSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { launchCodexWithText } from '@/lib/codexLauncher';
import { getActiveRepoDir, hasActiveRepo } from '@/lib/projects';
import { getAutorunAgent, setAutorun } from '@/lib/autorun';
import { getRunnerExtra, renderRunnerExtra } from '@/lib/runnerExtra';

const execFileAsync = promisify(execFile);
const IDEAS_DIR = () => join(getActiveRepoDir(), 'autoresearch', 'ideas');
const BOX_JSON = () => join(getActiveRepoDir(), 'autoresearch', 'remote-box.json');

// One persistent runner agent owns the GPU queue while autorun is on. It reads
// runner.md, claims the WHOLE needs-run set, and drains it on the box's detached
// `arq` tmux — exactly the model the existing cron uses. We just re-invoke it
// from the UI poll instead of cron, gated by the autorun flag.
const RUNNER_SESSION = 'lab-autorun';

function field(md: string, key: string): string {
  const m = md.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : '';
}

async function needsRunCount(): Promise<number> {
  let dirs: string[];
  try {
    dirs = await readdir(IDEAS_DIR());
  } catch {
    return 0;
  }
  let n = 0;
  for (const dir of dirs) {
    try {
      const md = await readFile(join(IDEAS_DIR(), dir, 'idea.md'), 'utf8');
      if (field(md, 'status') === 'needs-run') n += 1;
    } catch {
      /* skip */
    }
  }
  return n;
}

async function runnerAlive(): Promise<boolean> {
  try {
    await execFileAsync('tmux', ['has-session', '-t', RUNNER_SESSION], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function killRunner(): Promise<void> {
  try {
    await execFileAsync('tmux', ['kill-session', '-t', RUNNER_SESSION], { timeout: 5_000 });
  } catch {
    /* already gone */
  }
}

// Deterministic-drainer path: fire ONE queue-daemon.sh tick, detached. The
// script is idempotent and self-locking (flock), so spawning it on every poll
// is safe — overlapping ticks exit immediately and a live `arq` queue is never
// relaunched. Output tails to /tmp/queue-daemon.log. No LLM in this path.
function runDaemonTick(): boolean {
  const script = join(getActiveRepoDir(), 'autoresearch', 'bin', 'queue-daemon.sh');
  try {
    const out = openSync('/tmp/queue-daemon.log', 'a');
    const child = spawn('bash', [script, '--once'], {
      cwd: getActiveRepoDir(),
      detached: true,
      stdio: ['ignore', out, out],
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

// Build the runner-pass instruction: tell the agent to read runner.md + PIPELINE
// and run ONE pass, with the LIVE box pulled from remote-box.json (so a new Vast
// instance is picked up just by editing that file). The agent reads the full
// protocol from runner.md itself — we don't inline it.
async function runnerPrompt(): Promise<string> {
  let box: Record<string, string> = {};
  try {
    box = JSON.parse(await readFile(BOX_JSON(), 'utf8'));
  } catch {
    /* runner.md §0 falls back to the latest results.json box */
  }
  const sshLine = box.ssh
    ? `Live box (rented): ${box.ssh} (-o StrictHostKeyChecking=accept-new). Repo on box: ${box.remote_repo ?? '/root/universe-lm'}. Python: ${box.remote_venv ?? '/venv/main'}/bin/python (export PATH=${box.remote_venv ?? '/venv/main'}/bin:$PATH). Hardware: ${box.hardware ?? 'see remote-box.json'}.`
    : 'No box in remote-box.json — follow runner.md §0 to recover the live box, or print NO BOX and stop.';

  return [
    `Read autoresearch/prompts/runner.md and autoresearch/PIPELINE.md and execute ONE full runner pass exactly as specified. You are in ${getActiveRepoDir()}.`,
    '',
    sshLine,
    '',
    "If a queue tmux session named `arq` is already live on the box, do NOT relaunch it — poll STATUS, pull finished logs, finalize evidence.md + status flips, then exit. One pass per invocation; no waiting loops longer than a few minutes. The runs live in the box's detached tmux, so this agent exiting does not stop them.",
    renderRunnerExtra(await getRunnerExtra()),
  ].join('\n');
}

// Read or toggle autorun. POST with no `enabled` = read state + tick. The tick
// (re-)launches the single runner agent only when autorun is on, no runner is
// already alive, and there is actually needs-run work — so the UI poll keeps the
// queue draining without ever stacking two runners.
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
    await setAutorun(body.enabled ? agent : null);
    if (!body.enabled) {
      // Stop the loop: the runner self-exits per pass, but kill the session now
      // so the GPU queue visibly stops re-launching.
      await killRunner();
    }
  }

  const current = await getAutorunAgent();
  let launched = false;
  let alive = await runnerAlive();
  if (current === 'daemon') {
    // Deterministic drainer — no persistent agent. Fire one self-locking tick;
    // it finalizes any finished runs and launches the next queue itself.
    launched = runDaemonTick();
    alive = launched;
  } else if (current && !alive && (await needsRunCount()) > 0) {
    const result = await launchCodexWithText(
      await runnerPrompt(),
      'lab-autorun',
      getActiveRepoDir(),
      RUNNER_SESSION,
      current,
      { headless: true }
    );
    launched = result.success;
    alive = result.success;
  }

  return Response.json(
    { success: true, enabled: current !== null, agent: current, runnerAlive: alive, launched },
    { status: 200 }
  );
}
