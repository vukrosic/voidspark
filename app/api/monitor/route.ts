import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { readFile, writeFile, stat } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { getActiveRepoDir } from '@/lib/projects';

// ---- Monitor watchdog agent -------------------------------------------------
// A persistent MiniMax agent (tmux session `lab-monitor`, driven by
// scripts/monitor_loop.sh) that every ~minute observes the whole research loop
// and writes a fresh status summary to autoresearch/monitor-summary.md. This
// route is the cockpit Monitor panel's control surface:
//   action: "status" (default)  -> { alive, summary, summaryAgeMs, prompt, interval }
//   action: "start"             -> ensure the prompt file exists, launch the loop
//   action: "stop"              -> kill the tmux session
//   action: "save-prompt"       -> overwrite the editable monitor prompt
// Read-only by design except start/stop and the prompt write.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

const TMUX_BIN =
  ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find((p) =>
    existsSync(p)
  ) ?? 'tmux';

const SESSION = 'lab-monitor';
const INTERVAL = 60; // seconds between refreshes

const promptPath = () =>
  join(getActiveRepoDir(), 'autoresearch', 'monitor-prompt.md');
const summaryPath = () =>
  join(getActiveRepoDir(), 'autoresearch', 'monitor-summary.md');
const loopScript = () => join(process.cwd(), 'scripts', 'monitor_loop.sh');

// Default watchdog brief. Written on first start if no prompt exists yet; the
// user can edit it from the panel afterward. Tuned for a terse, scannable report
// the panel renders as markdown — the agent gathers state from the read-only
// /api/health snapshot plus tmux, and never modifies anything.
const DEFAULT_PROMPT = `You are the ResearchLoop MONITOR — a read-only watchdog for an autonomous AI research pipeline. Produce a SHORT, factual status report of the system RIGHT NOW. Never modify anything; only observe.

Gather current state (run these, they are all read-only):
- \`curl -s http://localhost:3000/api/health/\` — JSON: live gate workers, dead tmux panes, idea pool (inFlight vs floor), throughput (flips/hr, last-flip age), GPU drainer alive, MiniMax quota.
- \`tmux ls\` — every live session (w_<n> = gate workers, lab-autorun = GPU drainer, lab-implement-* = implementers).
- If the health JSON shows needs-run > 0 but the GPU drainer looks idle, peek at the drainer: \`tmux capture-pane -t lab-autorun -p | tail -15\` to see what it is doing (e.g. stuck syncing files vs actually training).

Output ONLY markdown with these sections, terse (one line each where possible), under ~25 lines total, no preamble:

## Verdict
WORKING / DEGRADED / STALLED — plus the single most important reason.

## Active now
Which agents are running and what each is doing (worker id + idea + age).

## Idle / missing
Anything that should be running but isn't — queue has ideas but GPU idle, drainer dead, autopilot off, miner not refilling below floor.

## Stale / stuck
Any worker holding a lock > ~7m, or no status flip in > 15m.

## Errors
Any error visible in pane tails or logs (quote it briefly). "none seen" if clean.

## Numbers
inFlight / needs-run · flips last hr · last flip Xago · MiniMax % left.`;

async function sessionAlive(): Promise<boolean> {
  try {
    await execFileAsync(TMUX_BIN, ['has-session', '-t', SESSION], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function readPrompt(): Promise<string> {
  try {
    return await readFile(promptPath(), 'utf8');
  } catch {
    return DEFAULT_PROMPT;
  }
}

async function buildStatus() {
  const alive = await sessionAlive();
  let summary = '';
  let summaryAgeMs: number | null = null;
  try {
    summary = await readFile(summaryPath(), 'utf8');
    const m = await stat(summaryPath());
    summaryAgeMs = Date.now() - m.mtimeMs;
  } catch {
    /* no summary yet */
  }
  return {
    success: true as const,
    alive,
    summary,
    summaryAgeMs,
    prompt: await readPrompt(),
    interval: INTERVAL,
  };
}

// Launch the loop in a detached, attachable tmux session. We strip
// npm_config_prefix (the Next dev server sets it, which makes nvm refuse to load
// in the spawned shell, hiding claude-minimax-free from PATH) and run through a
// login shell so the agent binary resolves — same fix codexLauncher uses.
async function startSession(): Promise<void> {
  const env = { ...process.env };
  delete env.npm_config_prefix;
  delete env.NPM_CONFIG_PREFIX;

  await execFileAsync(TMUX_BIN, ['new-session', '-d', '-s', SESSION, '-x', '220', '-y', '50'], {
    env,
    timeout: 10_000,
  });
  const cmd = `unset npm_config_prefix NPM_CONFIG_PREFIX; exec ${loopScript()} ${getActiveRepoDir()} ${INTERVAL}`;
  await execFileAsync(TMUX_BIN, ['send-keys', '-t', SESSION, '-l', `bash -lc ${JSON.stringify(cmd)}`], {
    env,
    timeout: 10_000,
  });
  await execFileAsync(TMUX_BIN, ['send-keys', '-t', SESSION, 'Enter'], { env, timeout: 10_000 });
}

export async function POST(req: Request) {
  let body: { action?: string; prompt?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* default: status */
  }
  const action = body.action ?? 'status';

  if (action === 'start') {
    if (!(await sessionAlive())) {
      // Seed the prompt file with the default on first run so the agent has a brief.
      if (!existsSync(promptPath())) {
        await writeFile(promptPath(), DEFAULT_PROMPT, 'utf8').catch(() => {});
      }
      try {
        await startSession();
      } catch (e) {
        return Response.json(
          { success: false, error: e instanceof Error ? e.message : String(e) },
          { status: 200 }
        );
      }
    }
    return Response.json(await buildStatus(), { status: 200 });
  }

  if (action === 'stop') {
    await execFileAsync(TMUX_BIN, ['kill-session', '-t', SESSION], { timeout: 10_000 }).catch(
      () => {}
    );
    return Response.json(await buildStatus(), { status: 200 });
  }

  if (action === 'save-prompt') {
    if (typeof body.prompt === 'string' && body.prompt.trim()) {
      await writeFile(promptPath(), body.prompt, 'utf8');
    }
    return Response.json(await buildStatus(), { status: 200 });
  }

  // Default: status snapshot for the panel poll.
  return Response.json(await buildStatus(), { status: 200 });
}
