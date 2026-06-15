import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { getActiveRepoDir } from '@/lib/projects';
import { getAutopilotAgent } from '@/lib/autopilot';
import { getAutorunAgent } from '@/lib/autorun';
import { getAutoImplementAgent } from '@/lib/autoimplement';
import { FLOOR, CEILING } from '@/lib/orchestratorConfig';

// ---- System health snapshot -------------------------------------------------
// One read-only GET that gathers every "is the loop alive?" signal the dashboard
// health bar shows, in a single cheap local pass. It MUST NOT mutate anything:
// polling it every few seconds must never tick the pipeline (only /api/orchestrate
// fans out workers). Sources, all on disk / from tmux:
//   - flags        autopilot / autorun / autoimplement (which agent, or off)
//   - workers      /tmp/orch-locks/*.lock with a live PID  -> a gate worker is alive
//   - dead panes   w_<n> tmux sessions with NO live lock   -> reapable zombies
//   - gpu          lab-autorun session present             -> the GPU drainer is up
//   - ideas        status counts across ideas/*/idea.md    -> in-flight vs floor
//   - throughput   ts of every flip in ideas/*/log.jsonl   -> flips/hr + staleness
//   - best         min val in records.jsonl                -> is research winning

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

const TMUX_BIN =
  ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find((p) =>
    existsSync(p)
  ) ?? 'tmux';

const LOCK_DIR = process.env.ORCH_LOCKDIR || '/tmp/orch-locks';

// FLOOR/CEILING come from lib/orchestratorConfig so the bar and the loop agree.
const STALE_MIN = 7; // an -ing lock older than this is "possibly stuck"

const ideasDir = () => join(getActiveRepoDir(), 'autoresearch', 'ideas');
const recordsPath = () =>
  join(getActiveRepoDir(), 'autoresearch', 'records.jsonl');

function field(md: string, key: string): string {
  const m = md.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : '';
}

// tmux session name -> creation epoch (ms). Empty map if no server is running.
async function tmuxSessions(): Promise<Map<string, number>> {
  try {
    const { stdout } = await execFileAsync(
      TMUX_BIN,
      ['list-sessions', '-F', '#{session_name}|#{session_created}'],
      { timeout: 8_000 }
    );
    const map = new Map<string, number>();
    for (const line of stdout.split('\n')) {
      const [name, created] = line.trim().split('|');
      if (name) map.set(name, Number(created) * 1000);
    }
    return map;
  } catch {
    return new Map();
  }
}

// Live gate workers, by their liveness lockfile (same contract worker_run.sh and
// orchestrate.sh use): a lock whose PID is still running = a live worker. Stale
// locks (PID gone) are ignored here, not deleted — that's the orchestrator's job.
async function liveLocks(): Promise<Map<string, number>> {
  const live = new Map<string, number>(); // session -> lock epoch (ms)
  let files: string[];
  try {
    files = await readdir(LOCK_DIR);
  } catch {
    return live;
  }
  for (const f of files) {
    if (!f.endsWith('.lock')) continue;
    const session = f.slice(0, -'.lock'.length);
    try {
      const raw = (await readFile(join(LOCK_DIR, f), 'utf8')).trim();
      const [pidStr, epochStr] = raw.split(/\s+/);
      const pid = Number(pidStr);
      if (!Number.isFinite(pid)) continue;
      try {
        process.kill(pid, 0); // throws if the PID is gone
      } catch {
        continue; // stale lock — worker is dead
      }
      const epochMs = Number(epochStr) * 1000;
      live.set(session, Number.isFinite(epochMs) ? epochMs : Date.now());
    } catch {
      /* unreadable lock — skip */
    }
  }
  return live;
}

export async function GET() {
  const now = Date.now();

  const [autopilot, autorun, autoimplement, sessions, locks, dirs] =
    await Promise.all([
      getAutopilotAgent(),
      getAutorunAgent(),
      getAutoImplementAgent(),
      tmuxSessions(),
      liveLocks(),
      readdir(ideasDir()).catch(() => [] as string[]),
    ]);

  // num -> idea dir, e.g. "161" -> "161-dyt-temp", for mapping w_<n> sessions.
  const ideaByNum = new Map<string, string>();
  for (const d of dirs) {
    const m = d.match(/^(\d+)-/);
    if (m) ideaByNum.set(m[1], d);
  }

  // --- workers (live) + dead panes -----------------------------------------
  const live: {
    session: string;
    ageMs: number;
    idea: string | null;
    status: string;
    stale: boolean;
  }[] = [];
  for (const [session, epochMs] of locks) {
    const num = session.startsWith('w_') ? session.slice(2) : '';
    const dir = ideaByNum.get(num) ?? null;
    let status = '';
    if (dir) {
      try {
        status = field(
          await readFile(join(ideasDir(), dir, 'idea.md'), 'utf8'),
          'status'
        );
      } catch {
        /* idea gone */
      }
    }
    const ageMs = now - epochMs;
    live.push({
      session,
      ageMs,
      idea: dir,
      status,
      stale: ageMs > STALE_MIN * 60_000,
    });
  }
  live.sort((a, b) => b.ageMs - a.ageMs);

  // Dead panes: w_<n> tmux sessions with no live lock — reapable zombies.
  const dead: string[] = [];
  for (const name of sessions.keys()) {
    if (/^w_\d+$/.test(name) && !locks.has(name)) dead.push(name);
  }
  dead.sort();

  // --- gpu drainer ----------------------------------------------------------
  const gpuCreated = sessions.get('lab-autorun');
  const gpu = {
    alive: gpuCreated !== undefined,
    upMs: gpuCreated !== undefined ? now - gpuCreated : null,
    autorun, // which agent the drainer launches runs with (or null = off)
  };

  // --- idea pool + what's running -------------------------------------------
  let inFlight = 0;
  let needsRun = 0;
  let total = 0;
  let done = 0;
  let rejected = 0;
  const running: string[] = []; // ideas the GPU box is (or should be) training now
  const ideaStatus = await Promise.all(
    dirs.map((d) =>
      readFile(join(ideasDir(), d, 'idea.md'), 'utf8')
        .then((md) => field(md, 'status'))
        .catch(() => '')
    )
  );
  for (let i = 0; i < dirs.length; i++) {
    const status = ideaStatus[i];
    if (!status) continue;
    total += 1;
    if (status === 'done') done += 1;
    else if (status === 'rejected') rejected += 1;
    else inFlight += 1;
    if (status === 'needs-run') needsRun += 1;
    if (status === 'running') running.push(dirs[i]);
  }

  // --- throughput (flips/hr + staleness) from log.jsonl ts ------------------
  const HOUR = 3_600_000;
  let flipsLastHour = 0;
  let lastFlipTs = 0;
  // Two queue timers the dashboard shows: when something last entered the queue,
  // and when the daemon last drained a run onto the GPU. Both come straight from
  // the flip events here (no extra disk pass):
  //   - added   = newest flip TO `needs-run` by an implement agent ("code ready").
  //               Excludes daemon/reset-button requeues, which are bookkeeping,
  //               not a genuinely new queue item.
  //   - drained = newest flip TO `running` by the `daemon` (it claimed a run and
  //               launched it on the box).
  let lastAddedTs = 0;
  let lastDrainTs = 0;
  await Promise.all(
    dirs.map(async (d) => {
      let raw: string;
      try {
        raw = await readFile(join(ideasDir(), d, 'log.jsonl'), 'utf8');
      } catch {
        return;
      }
      for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          const j = JSON.parse(t);
          const ts = Date.parse(j.ts);
          if (!Number.isFinite(ts)) continue;
          if (now - ts <= HOUR) flipsLastHour += 1;
          if (ts > lastFlipTs) lastFlipTs = ts;
          if (
            j.to === 'needs-run' &&
            j.agent !== 'daemon' &&
            j.agent !== 'reset-button' &&
            ts > lastAddedTs
          )
            lastAddedTs = ts;
          if (j.to === 'running' && j.agent === 'daemon' && ts > lastDrainTs)
            lastDrainTs = ts;
        } catch {
          /* skip malformed line */
        }
      }
    })
  );

  // --- records: best so far, how many, and how long since the last one ------
  let best: { val: number; idea: string } | null = null;
  let recordCount = 0;
  let lastRecordAgeMs: number | null = null;
  try {
    const raw = await readFile(recordsPath(), 'utf8');
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    recordCount = lines.length;
    let newestTs: number | null = null;
    for (const t of lines) {
      try {
        const j = JSON.parse(t);
        if (typeof j.val === 'number' && (best === null || j.val < best.val)) {
          best = { val: j.val, idea: String(j.idea ?? '') };
        }
        // Age comes from the record's OWN timestamp, not the file mtime: the
        // research-records route rewrites records.jsonl (idempotent mirror) on
        // every fetch, so its mtime is always ~now — that's why the timer was
        // stuck at "0s". The newest record's `ts` is the real "last record" time.
        const ms = j.ts ? Date.parse(j.ts) : NaN;
        if (Number.isFinite(ms) && (newestTs === null || ms > newestTs)) newestTs = ms;
      } catch {
        /* skip */
      }
    }
    if (recordCount > 0 && newestTs !== null) lastRecordAgeMs = Math.max(0, now - newestTs);
  } catch {
    /* no records yet */
  }

  return Response.json({
    ok: true,
    ts: now,
    flags: { autopilot, autorun, autoimplement },
    workers: { live, dead },
    gpu,
    ideas: { inFlight, needsRun, total, done, rejected, running, floor: FLOOR, ceiling: CEILING },
    throughput: {
      flipsLastHour,
      lastFlipMs: lastFlipTs ? Math.max(0, now - lastFlipTs) : null,
    },
    queue: {
      lastAddedMs: lastAddedTs ? Math.max(0, now - lastAddedTs) : null,
      lastDrainMs: lastDrainTs ? Math.max(0, now - lastDrainTs) : null,
    },
    best,
    records: { count: recordCount, lastRecordAgeMs },
  });
}
