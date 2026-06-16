import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { getActiveAutoresearchDir } from '@/lib/tracks';

// ---- Pipeline analytics -----------------------------------------------------
// Every status flip is appended to `autoresearch/ideas/<id>/log.jsonl` by
// flip.sh — one JSON line per transition: {ts, agent, idea, from, to, round,
// note}. That log IS the timing record. This route replays each idea's events
// in order and measures how long it sat in every state (implementing, queued,
// running, fixing, review…), then aggregates mean / median / deviation across
// all ideas so the Analytics view can answer "how long does each stage take,
// and how much does it vary?".
//
// A "segment" = one stretch in a single state, from the event that entered it
// to the next event (or now, if it's still there). Re-entering a state (e.g. a
// failed run bouncing implementing → needs-run → running → needs-recode →
// implementing) yields multiple segments — each is its own sample, so the
// deviation reflects real variance, not an average of averages.

const ideasDir = () => join(getActiveAutoresearchDir(), 'ideas');
// Finished ideas are moved here to declutter the live queue. Analytics still
// reads them so stage-timing history covers the whole pipeline, not just active work.
const archiveDir = () => join(getActiveAutoresearchDir(), 'ideas-archive');

// Terminal states: reaching one ends an idea's pipeline. End-to-end time is
// measured from the first event to the first terminal event.
const FINISHED = new Set([
  'done',
  'win',
  'null',
  'drift',
  'fail',
  'rejected',
]);

// How a raw on-disk status reads in the UI. Mirrors STATUS_META in page.tsx so
// the two views agree on names.
const STAGE_LABEL: Record<string, string> = {
  'needs-taste': 'Proposed',
  implementing: 'Implementing',
  'needs-run': 'Queued · GPU',
  running: 'Running · GPU',
  'needs-recode': 'Fixing · failed run',
  'needs-review': 'In review',
  'needs-codereview': 'Code review',
  recoding: 'Fixing',
  done: 'Done',
};

// A state is "in-flight" (gets a live elapsed clock + stuck check) when it is
// neither the initial proposed-wait nor a terminal state.
const isInFlight = (s: string) => s !== 'needs-taste' && !FINISHED.has(s);

// Stage timing only measures the *productive* pipeline — how long the healthy
// work takes. Recovery/blocked states (fixing a failed run, sitting in review)
// are bug time, not working time, so they're left out of the averages; they
// surface separately as failure counts + the live "in progress" list instead.
const WORKING_STATES = new Set([
  'needs-taste', // waiting to be picked up
  'implementing',
  'needs-run', // queued for the GPU
  'running',
]);

// Past this long in an in-flight state with no live worker, a segment is stuck.
const STUCK_MS = 60 * 60 * 1000; // 1h

type LogEvent = {
  ts: number;
  agent: string;
  from: string;
  to: string;
  note: string;
};

type StageStat = {
  state: string;
  label: string;
  count: number; // completed segments measured
  meanMs: number;
  medianMs: number;
  stdevMs: number; // the "deviation"
  minMs: number;
  maxMs: number;
};

type InFlight = {
  id: string;
  title: string;
  state: string;
  label: string;
  agent: string;
  note: string;
  elapsedMs: number;
  stuck: boolean;
};

function parseTitle(md: string, fallback: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Sample standard deviation (n-1). Zero for a single sample (no spread yet).
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance =
    xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

export async function POST() {
  const now = Date.now();
  // Live ideas + archived ones, each tagged with its base dir so the per-idea
  // file reads below resolve correctly regardless of which folder it lives in.
  const entries: { dir: string; base: string }[] = [];
  for (const base of [ideasDir(), archiveDir()]) {
    try {
      for (const dir of await readdir(base)) entries.push({ dir, base });
    } catch {
      /* folder absent (e.g. no archive yet) — skip */
    }
  }
  if (entries.length === 0) {
    return Response.json({ success: true, stages: [], endToEnd: null, inFlight: [], totals: {} });
  }

  // state -> list of completed segment durations (ms)
  const byState = new Map<string, number[]>();
  const endToEndMs: number[] = [];
  const inFlight: InFlight[] = [];
  // Reviewer outcomes — the A/B verdict from each idea's evidence.md.
  const reviewerOutcomes = new Map<string, number>();
  // How many ideas ended in failure/recovery (rejected, or hit a fixing state).
  let failures = 0;
  let ideasWithLogs = 0;

  for (const { dir, base } of entries) {
    let logRaw: string;
    try {
      logRaw = await readFile(join(base, dir, 'log.jsonl'), 'utf8');
    } catch {
      continue; // no transition log — nothing to measure
    }

    const events: LogEvent[] = [];
    for (const line of logRaw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const j = JSON.parse(t);
        const ts = Date.parse(j.ts);
        if (!Number.isFinite(ts)) continue;
        events.push({
          ts,
          agent: String(j.agent ?? ''),
          from: String(j.from ?? ''),
          to: String(j.to ?? ''),
          note: String(j.note ?? ''),
        });
      } catch {
        /* skip malformed line */
      }
    }
    if (events.length === 0) continue;
    events.sort((a, b) => a.ts - b.ts);
    ideasWithLogs += 1;

    // Title for the in-flight list.
    let title = dir;
    try {
      const md = await readFile(join(base, dir, 'idea.md'), 'utf8');
      title = parseTitle(md, dir);
    } catch {
      /* fall back to dir name */
    }

    // Reviewer outcome: the verdict the reviewer wrote into evidence.md. This is
    // the "did it work?" answer (Improved / No change / Worse / Invalid run).
    try {
      const ev = await readFile(join(base, dir, 'evidence.md'), 'utf8');
      const m = ev.match(/##\s*Verdict:\s*([A-Za-z]+)/i);
      if (m) {
        const v = m[1].toUpperCase();
        reviewerOutcomes.set(v, (reviewerOutcomes.get(v) ?? 0) + 1);
      }
    } catch {
      /* no evidence yet — not reviewed */
    }
    // Count failures: any idea that ever needed a re-code, or was rejected.
    if (events.some((e) => e.to === 'needs-recode' || e.to === 'recoding' || e.to === 'rejected')) {
      failures += 1;
    }

    // Proposed wait: the segment-pairing below can't time `needs-taste` because
    // the first log event is the EXIT from it. Approximate "how long the idea
    // sat as Proposed before anyone started" as idea.md creation → first event.
    if (events[0].from === 'needs-taste') {
      try {
        const birth = (await stat(join(base, dir, 'idea.md'))).birthtimeMs;
        const wait = events[0].ts - birth;
        if (birth > 0 && wait >= 0 && wait <= STUCK_MS) {
          const list = byState.get('needs-taste') ?? [];
          list.push(wait);
          byState.set('needs-taste', list);
        }
      } catch {
        /* birthtime unavailable on this fs — skip */
      }
    }

    // Walk segments: each event enters state `to`; it ends at the next event's
    // ts, or now if it's the last (still-open) segment.
    for (let i = 0; i < events.length; i++) {
      const state = events[i].to;
      const start = events[i].ts;
      const isLast = i === events.length - 1;
      const end = isLast ? now : events[i + 1].ts;
      const durationMs = Math.max(0, end - start);
      const open = isLast && isInFlight(state);

      if (open) {
        inFlight.push({
          id: dir,
          title,
          state,
          label: STAGE_LABEL[state] ?? state,
          agent: events[i].agent,
          note: events[i].note,
          elapsedMs: durationMs,
          stuck: durationMs > STUCK_MS,
        });
      } else if (!isLast && WORKING_STATES.has(state) && durationMs <= STUCK_MS) {
        // Completed segment in a productive stage, and not a stuck outlier — a
        // real measure of how long that healthy step took. Recovery states
        // (fixing/review) and stuck-long segments are deliberately left out so
        // the averages reflect working time, not bug time.
        const list = byState.get(state) ?? [];
        list.push(durationMs);
        byState.set(state, list);
      }
      // Anything else (terminal resting state, bug state, or a stuck outlier) is
      // not counted toward stage timing.
    }

    // End-to-end: first event to the first terminal arrival.
    const firstTerminal = events.find((e) => FINISHED.has(e.to));
    if (firstTerminal) {
      endToEndMs.push(Math.max(0, firstTerminal.ts - events[0].ts));
    }
  }

  // Aggregate per-state stats, ordered by the natural pipeline flow.
  const ORDER = [
    'needs-taste',
    'implementing',
    'needs-review',
    'needs-recode',
    'recoding',
    'needs-codereview',
    'needs-run',
    'running',
  ];
  const seen = new Set<string>();
  const orderedStates = [
    ...ORDER.filter((s) => byState.has(s)),
    ...[...byState.keys()].filter((s) => !ORDER.includes(s)),
  ].filter((s) => (seen.has(s) ? false : (seen.add(s), true)));

  const stages: StageStat[] = orderedStates.map((state) => {
    const xs = byState.get(state) ?? [];
    return {
      state,
      label: STAGE_LABEL[state] ?? state,
      count: xs.length,
      meanMs: mean(xs),
      medianMs: median(xs),
      stdevMs: stdev(xs),
      minMs: xs.length ? Math.min(...xs) : 0,
      maxMs: xs.length ? Math.max(...xs) : 0,
    };
  });

  const endToEnd =
    endToEndMs.length > 0
      ? {
          count: endToEndMs.length,
          meanMs: mean(endToEndMs),
          medianMs: median(endToEndMs),
          stdevMs: stdev(endToEndMs),
          minMs: Math.min(...endToEndMs),
          maxMs: Math.max(...endToEndMs),
        }
      : null;

  // Sort in-flight: stuck first, then longest-waiting.
  inFlight.sort((a, b) =>
    a.stuck === b.stuck ? b.elapsedMs - a.elapsedMs : a.stuck ? -1 : 1
  );

  return Response.json(
    {
      success: true,
      stages,
      endToEnd,
      inFlight,
      reviewerOutcomes: Object.fromEntries(reviewerOutcomes),
      totals: {
        ideasWithLogs,
        finished: endToEndMs.length,
        inFlight: inFlight.length,
        stuck: inFlight.filter((x) => x.stuck).length,
        failures,
      },
    },
    { status: 200 }
  );
}
