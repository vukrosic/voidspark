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

const SESSION = 'lab-monitor'; // the interactive cmf agent you chat with
const BEAT_SESSION = 'lab-monitor-beat'; // tiny loop that nudges it for summaries
const INTERVAL = 180; // seconds between auto-refresh nudges

const promptPath = () =>
  join(getActiveRepoDir(), 'autoresearch', 'monitor-prompt.md');
const issuesPath = () =>
  join(getActiveRepoDir(), 'autoresearch', 'monitor-issues.md');
const summaryPath = () =>
  join(getActiveRepoDir(), 'autoresearch', 'monitor-summary.md');
const primePath = () =>
  join(getActiveRepoDir(), 'autoresearch', 'monitor-prime.txt');
const beatScript = () => join(process.cwd(), 'scripts', 'monitor_beat.sh');

// Default watchdog brief. Written on first start if no prompt exists yet; the
// user can edit it from the panel afterward. Tuned for a terse, scannable report
// the panel renders as markdown — the agent gathers state from the read-only
// /api/health snapshot plus tmux, and never modifies anything.
const DEFAULT_PROMPT = `You are the ResearchLoop MONITOR — a read-only watchdog for an autonomous AI research pipeline. Produce a SHORT, factual status report of the system RIGHT NOW. Never modify anything; only observe.

Gather current state (run these, they are all read-only):
- \`curl -s http://localhost:3000/api/health/\` — JSON: live gate workers, dead tmux panes, idea pool (inFlight vs floor), throughput (flips/hr, last-flip age), GPU drainer alive, MiniMax quota.
- \`curl -s -X POST http://localhost:3000/api/gpu-usage/\` — live GPU utilization % + whether a training run (\`arqAlive\`) is active on the box. This is how you tell "GPU idle" (util < 5) from "GPU training" (util 80-100).
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

// Editable issue checklist. Appended to the prompt each tick (see monitor_loop.sh)
// so the agent evaluates each rule against live state and reports the ones that
// are TRUE. The user maintains this list from the panel; these are the defaults.
const DEFAULT_ISSUES = `- GPU IDLE WITH WORK QUEUED: GPU utilization < 5% (from /api/gpu-usage) for what looks like > 30s while needs-run > 0. The box is paid-for and idle while runs wait — flag loudly with what the drainer is doing instead.
- DRAINER DOWN: needs-run > 0 but the lab-autorun session is missing, or autorun is off.
- STUCK RUNNING: an idea has status \`running\` but no live training on the box (arqAlive false / GPU idle) — likely a lost or SSH-throttled run that never flipped to needs-recode.
- WORKER STUCK: any gate worker (w_<n>) has held its lock > 7 minutes.
- LOOP STALLED: no status flip in > 15 minutes while autopilot/autoresearch is ON.
- DEAD PANES: any w_<n> tmux session exists with no live worker lock (zombie pane).
- MINIMAX EXHAUSTED: MiniMax interval quota at/near 0% — agents are falling back to Codex.
- IDEA POOL LOW: inFlight < floor (5) but the miner (lab-generate-ideas) is not running.
- ERRORS: any error, exception, traceback, or "Connection closed"/SSH-throttle message in a pane tail or recent log — quote it.`;

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

async function readIssues(): Promise<string> {
  try {
    return await readFile(issuesPath(), 'utf8');
  } catch {
    return DEFAULT_ISSUES;
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
    issues: await readIssues(),
    interval: INTERVAL,
  };
}

// Build the priming message the interactive agent opens with: base brief + the
// editable issue checklist + an interactive wrapper telling it to summarize now,
// then stay in its REPL to chat and re-summarize on each auto-refresh nudge.
async function buildPrime(): Promise<string> {
  return `${await readPrompt()}

## ISSUE CHECKLIST — evaluate EACH rule against current state whenever you summarize; report a "## Issues" section listing only the rules TRUE right now (with evidence), or "none":
${await readIssues()}

---
This is a LIVE INTERACTIVE session, not a one-shot. Do this now: run the read-only checks and give me your first status summary. Then STAY in your prompt — I will chat with you and ask follow-up questions, and a periodic "Auto-refresh" message will ask you to regenerate the summary. On every summary, re-run the checks fresh (curl -s http://localhost:3000/api/health/, curl -s -X POST http://localhost:3000/api/gpu-usage/, tmux ls, capture-pane on suspect sessions).

You only OBSERVE the research system — never modify ideas, code, configs, or flags. The ONLY file you may write is the dashboard mirror: each time you produce a status summary, also write that summary verbatim (the markdown only) to autoresearch/monitor-summary.md, overwriting it, so the cockpit's "Last summary" view stays current.`;
}

// Launch the watchdog as an INTERACTIVE cmf agent (its REPL stays open so the
// user can chat with it), plus a heartbeat session that types an auto-refresh
// request to it every INTERVAL. We strip npm_config_prefix (the Next dev server
// sets it, which makes nvm refuse to load in the spawned shell, hiding
// claude-minimax-free from PATH) and run through a login shell so the binary
// resolves — same fix codexLauncher uses. The bash -lc arg is single-quoted so
// the outer zsh doesn't expand the inner "$(cat prime)" — bash does, once.
async function startSession(): Promise<void> {
  const env = { ...process.env };
  delete env.npm_config_prefix;
  delete env.NPM_CONFIG_PREFIX;
  const repo = getActiveRepoDir();

  await writeFile(primePath(), await buildPrime(), 'utf8').catch(() => {});

  // 1) The interactive agent. `claude-minimax-free "<prime>"` with NO -p starts
  //    cmf, sends the prime as the first message, and stays in the REPL.
  await execFileAsync(TMUX_BIN, ['new-session', '-d', '-s', SESSION, '-x', '220', '-y', '50'], { env, timeout: 10_000 });
  const launch = `bash -lc 'unset npm_config_prefix NPM_CONFIG_PREFIX; cd ${repo}; claude-minimax-free "$(cat ${primePath()})"'`;
  await execFileAsync(TMUX_BIN, ['send-keys', '-t', SESSION, '-l', launch], { env, timeout: 10_000 });
  await execFileAsync(TMUX_BIN, ['send-keys', '-t', SESSION, 'Enter'], { env, timeout: 10_000 });

  // 2) The heartbeat. Types an auto-refresh request to the agent every INTERVAL.
  await execFileAsync(TMUX_BIN, ['new-session', '-d', '-s', BEAT_SESSION, '-x', '80', '-y', '10'], { env, timeout: 10_000 }).catch(() => {});
  const beat = `bash -lc 'unset npm_config_prefix NPM_CONFIG_PREFIX; exec ${beatScript()} ${SESSION} ${INTERVAL}'`;
  await execFileAsync(TMUX_BIN, ['send-keys', '-t', BEAT_SESSION, '-l', beat], { env, timeout: 10_000 }).catch(() => {});
  await execFileAsync(TMUX_BIN, ['send-keys', '-t', BEAT_SESSION, 'Enter'], { env, timeout: 10_000 }).catch(() => {});
}

export async function POST(req: Request) {
  let body: { action?: string; prompt?: string; issues?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* default: status */
  }
  const action = body.action ?? 'status';

  if (action === 'start') {
    if (!(await sessionAlive())) {
      // Seed the prompt + issue checklist with defaults on first run so the
      // agent has both a brief and the rules to check.
      if (!existsSync(promptPath())) {
        await writeFile(promptPath(), DEFAULT_PROMPT, 'utf8').catch(() => {});
      }
      if (!existsSync(issuesPath())) {
        await writeFile(issuesPath(), DEFAULT_ISSUES, 'utf8').catch(() => {});
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
    await execFileAsync(TMUX_BIN, ['kill-session', '-t', SESSION], { timeout: 10_000 }).catch(() => {});
    await execFileAsync(TMUX_BIN, ['kill-session', '-t', BEAT_SESSION], { timeout: 10_000 }).catch(() => {});
    return Response.json(await buildStatus(), { status: 200 });
  }

  if (action === 'save-prompt') {
    if (typeof body.prompt === 'string' && body.prompt.trim()) {
      await writeFile(promptPath(), body.prompt, 'utf8');
    }
    return Response.json(await buildStatus(), { status: 200 });
  }

  if (action === 'save-issues') {
    if (typeof body.issues === 'string' && body.issues.trim()) {
      await writeFile(issuesPath(), body.issues, 'utf8');
    }
    return Response.json(await buildStatus(), { status: 200 });
  }

  // Default: status snapshot for the panel poll.
  return Response.json(await buildStatus(), { status: 200 });
}
