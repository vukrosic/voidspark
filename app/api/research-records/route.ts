import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { hasActiveRepo } from '@/lib/projects';
import { getActiveAutoresearchDir } from '@/lib/tracks';

// ---- Research records & closed experiments ----------------------------------
// `autoresearch/closed.md` is the loop's live ledger: the reviewer/run step
// appends ONE terse line per closed idea, e.g.
//   - 015-moonlight-muon-rms — WIN: trt=6.3906 vs ctrls 6.4044/6.4091 (Δ -0.0138/…) — 2026-06-09
//   - 114-mars — null: trt=6.4297 vs ctrl 6.4272 (Δ +0.0025, inside null band) — 2026-06-13
//   - 068-unlikelihood — taste-reject: <paper reasoning> — 2026-06-11
// We parse those lines into structured events so the UI can show (a) the
// val-loss RECORD TIMELINE — every WIN, oldest→newest, with the running best —
// and (b) the CLOSED / FAILED list (nulls, drifts, rejects) the loop already
// dedups against. Deriving straight from closed.md means it's always current and
// needs zero changes to the GPU run path.
//
// As a durable side-artifact (the "ledger file" requested) we also mirror the
// parsed WINs to `autoresearch/records.jsonl` on each call — idempotent, so the
// machine-readable record history stays in sync with closed.md automatically.

const arDir = () => getActiveAutoresearchDir();
const closedPath = () => join(arDir(), 'closed.md');
const ledgerPath = () => join(arDir(), 'records.jsonl');
const baselineCachePath = () => join(arDir(), 'baseline-cache.json');

// The current-box baseline (from the Phase-2 baseline cache). The record board
// is reset to THIS box's era: the "record to beat" is the clean baseline mean,
// and only wins measured on/after this box's era count — older wins were run on
// different GPUs against buggy controls (vals 6.25–6.39) and aren't comparable
// to the current baseline (~6.43), so they're archived, not shown as records.
type Baseline = {
  val: number; // standing record to beat = val_mean of the active box
  band: number;
  gpu: string;
  boxKey: string;
  eraStart: string; // YYYY-MM-DD — wins before this date are cross-box, archived
} | null;

async function readBaseline(): Promise<Baseline> {
  try {
    const raw = await readFile(baselineCachePath(), 'utf8');
    const cache = JSON.parse(raw) as {
      boxes?: Record<
        string,
        { val_mean?: number; noise_band?: number; gpu?: string; box_key?: string; measured_at?: string }
      >;
    };
    const boxes = Object.values(cache.boxes ?? {});
    if (!boxes.length) return null;
    // Active box = most recently measured.
    const active = boxes.sort((a, b) =>
      String(b.measured_at ?? '').localeCompare(String(a.measured_at ?? ''))
    )[0];
    if (active.val_mean == null) return null;
    return {
      val: active.val_mean,
      band: active.noise_band ?? 0.04,
      gpu: active.gpu ?? '',
      boxKey: active.box_key ?? '',
      eraStart: String(active.measured_at ?? '').slice(0, 10) || '0000-00-00',
    };
  } catch {
    return null;
  }
}

// Verdicts we recognise. WIN = a val-loss record/improvement; the rest are the
// ways an idea dies (measured null / diverged / killed on paper).
type Verdict = 'WIN' | 'null' | 'drift' | 'reject' | 'taste-reject';

type ClosedEvent = {
  slug: string;
  verdict: Verdict;
  val: number | null; // treatment val loss, when the line carries one
  delta: number | null; // Δ vs control (first one, when present)
  date: string; // YYYY-MM-DD
  note: string; // the full human reason, trimmed
};

type RecordEvent = ClosedEvent & {
  runningBest: number | null;
  improved: boolean;
  summary: string; // one plain-English sentence: what this record actually changed
};

// Curated one-sentence, jargon-light explanations of each record — what the lever
// actually *does*, for readers who don't know the codebase. Keyed by slug. New
// records fall back to `deriveSummary` (extracts the mechanism clause from the
// closed.md note) until a curated line is added here.
const RECORD_SUMMARIES: Record<string, string> = {
  '253-deepnet-alpha-alibi':
    'Scaled down each layer’s contribution to the residual stream (DeepNet-style) so the deep stack trains stably — with zero new parameters.',
  '267-deepnet-poly-alibi':
    'Gave every attention head its own linear-plus-quadratic decay with distance on top of ALiBi, so each head can tune how sharply it focuses on nearby tokens.',
  '296-champion-slope-curvature-combo':
    'Pre-set both the ALiBi slope and its curvature at the start of training, so the “pay attention to nearby words” prior is already correct from the first step.',
  '323-mom0p90-lr2x':
    'Doubled the peak learning rate and eased Muon’s momentum to 0.90 — the tiny model was under-trained in its short run, so bolder updates helped.',
};

// Fallback: pull the mechanism description out of the dense closed.md note (drop
// the leading “trt=… vs ctrl… (Δ…)” stats and keep the first real clause).
function deriveSummary(note: string): string {
  let s = note
    .replace(/trt\s*[=\s]\s*[0-9.]+/i, '')
    .replace(/\bvs\b[^;.]*?\([^)]*\)/gi, '')
    .replace(/\bat tiny1m3m\b/gi, '')
    .replace(/^[\s—–\-:,;]+/, '')
    .trim();
  s = s.split(/[;.](?:\s|$)/)[0].trim();
  if (s.length > 170) s = s.slice(0, 167).trimEnd() + '…';
  return s;
}

const summarize = (slug: string, note: string): string =>
  RECORD_SUMMARIES[slug] ?? deriveSummary(note);

// Split on the line's separator — closed.md mixes em-dash " — " and " -- ".
const SEP = /\s+(?:—|--)\s+/;

function parseLine(raw: string): ClosedEvent | null {
  const line = raw.replace(/^[-*]\s+/, '').trim();
  if (!line) return null;

  // Trailing date.
  const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})\s*$/);
  const date = dateMatch ? dateMatch[1] : '';

  // slug is the first token; verdict is the first segment after the separator.
  const parts = line.split(SEP);
  if (parts.length < 2) return null;
  const slug = parts[0].trim();
  if (!/^\d{2,}-[a-z0-9-]+$/i.test(slug)) return null;

  const verdictMatch = parts[1].match(/^(WIN|null|drift|reject|taste-reject)\b/i);
  if (!verdictMatch) return null;
  const vRaw = verdictMatch[1].toLowerCase();
  const verdict: Verdict =
    vRaw === 'win'
      ? 'WIN'
      : (vRaw as Verdict);

  // Numbers, when the line carries them (paper-rejects usually don't).
  const valMatch = line.match(/trt[=\s]+([0-9]+\.[0-9]+)/i);
  const val = valMatch ? Number(valMatch[1]) : null;
  const deltaMatch = line.match(/(?:Δ|delta)\s*([+-][0-9]+\.[0-9]+)/i);
  const delta = deltaMatch ? Number(deltaMatch[1]) : null;

  // note: everything between verdict and the trailing date, cleaned up.
  let note = parts.slice(1).join(' — ').replace(/^(WIN|null|drift|reject|taste-reject):\s*/i, '');
  if (date) note = note.replace(new RegExp(`\\s*${date}\\s*$`), '');
  note = note.replace(/\s*(?:—|--)\s*$/, '').trim(); // drop the dangling separator

  return { slug, verdict, val, delta, date, note };
}

// ---- Neon-backed source (the shared DB) -------------------------------------
// The record timeline now lives in Neon's `champions` table (synced from the
// maintainer's champion.json by voidbase/scripts/sync_champions.py). Reading it
// here makes the localhost dashboard pull the SAME records every distributed
// contributor sees — not a local file. Same response shape as the closed.md path,
// so the UI is unchanged; closed.md remains the fallback when Neon is unreachable.
const VOIDBASE_API = process.env.VOIDBASE_API_URL || 'http://127.0.0.1:8787';

async function fromNeon(): Promise<Record<string, unknown> | null> {
  const [champRes, runsRes] = await Promise.all([
    fetch(`${VOIDBASE_API}/champions`, { cache: 'no-store' }),
    fetch(`${VOIDBASE_API}/runs`, { cache: 'no-store' }),
  ]);
  const champions = await champRes.json();
  const runs = await runsRes.json();
  if (!Array.isArray(champions) || champions.length === 0) return null;

  // run_id -> human name (the champion run's `name` is the idea slug, e.g.
  // "323-mom0p90-lr2x"), so RECORD_SUMMARIES keys line up.
  const nameById = new Map<string, string>(
    (Array.isArray(runs) ? runs : []).map((r: { id: string; name?: string }) => [r.id, r.name ?? r.id])
  );

  // Champion timeline, oldest -> newest. Each promotion is a record; running best
  // strictly decreases (each champion supersedes the prior).
  const sorted = [...champions].sort((a, b) =>
    String(a.promoted_at).localeCompare(String(b.promoted_at))
  );
  let best: number | null = null;
  const records: RecordEvent[] = sorted.map((c) => {
    const slug = nameById.get(c.run_id) ?? String(c.run_id);
    const val: number | null = c.val_loss ?? null;
    const improved = val != null && (best == null || val < best);
    if (val != null && (best == null || val < best)) best = val;
    const note: string = c.reason ?? '';
    return {
      slug,
      verdict: 'WIN' as Verdict,
      val,
      delta: null,
      date: String(c.promoted_at).slice(0, 10),
      note,
      runningBest: best,
      improved,
      summary: summarize(slug, note),
    };
  });

  // Closed/failed attempts: runs that never became champions and didn't pass
  // (crashes or rejected confirms), newest first. The champ-* synthetic rows and
  // the champion runs themselves are excluded.
  const champRunIds = new Set(champions.map((c) => c.run_id));
  const closed: ClosedEvent[] = (Array.isArray(runs) ? runs : [])
    .filter(
      (r: { id: string; status?: string; verification?: string }) =>
        !champRunIds.has(r.id) &&
        !String(r.id).startsWith('champ-') &&
        (r.status === 'failed' || r.verification === 'rejected')
    )
    .map((r: { name?: string; id: string; status?: string; final_val_loss?: number; created_at?: string }) => ({
      slug: r.name ?? r.id,
      verdict: (r.status === 'failed' ? 'drift' : 'null') as Verdict,
      val: r.final_val_loss ?? null,
      delta: null,
      date: String(r.created_at ?? '').slice(0, 10),
      note: r.status === 'failed' ? 'run failed on the box' : 'rejected at confirm',
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const counts: Record<string, number> = { WIN: records.length };
  for (const e of closed) counts[e.verdict] = (counts[e.verdict] ?? 0) + 1;

  return {
    success: true,
    source: 'neon',
    records,
    archivedRecords: [],
    closed,
    counts,
    bestVal: best,
    baseline: null,
  };
}

export async function POST() {
  // Neon first — the shared record timeline. Any failure (API down, transient
  // Neon drop) falls through to the local closed.md ledger below, so the UI never
  // breaks during a cutover.
  try {
    const neon = await fromNeon();
    if (neon) return Response.json(neon, { status: 200 });
  } catch {
    /* fall back to closed.md */
  }

  if (!hasActiveRepo()) {
    return Response.json({ success: false, error: 'No project selected' }, { status: 200 });
  }
  let md: string;
  try {
    md = await readFile(closedPath(), 'utf8');
  } catch {
    return Response.json({ success: true, records: [], closed: [], counts: {} });
  }

  // Only the appended "Closed by the loop" section holds machine-written lines;
  // everything above is hand-written prose + the seed axis list.
  const marker = md.indexOf('Closed by the loop');
  const body = marker >= 0 ? md.slice(marker) : md;

  const events: ClosedEvent[] = [];
  for (const line of body.split('\n')) {
    if (!/^\s*[-*]\s+\d/.test(line)) continue; // only "- NNN-…" bullets
    const ev = parseLine(line);
    if (ev) events.push(ev);
  }

  // Sort oldest→newest for the timeline (date asc; stable for same-day).
  const byDate = [...events].sort((a, b) => a.date.localeCompare(b.date));

  // Reset the record board to the current box's era (see Baseline above). The
  // standing record starts at the clean baseline mean; only wins on/after the
  // era start count. Wins before it ran on other GPUs and are archived.
  const baseline = await readBaseline();
  const eraStart = baseline?.eraStart ?? null;
  const inEra = (d: string) => eraStart == null || d >= eraStart;

  const allWins = byDate.filter((e) => e.verdict === 'WIN');

  // Current-era record timeline: best seeded at the baseline, so the first
  // record must actually beat the baseline mean to count as an improvement.
  let best: number | null = baseline?.val ?? null;
  const records: RecordEvent[] = [];
  for (const ev of allWins) {
    if (!inEra(ev.date)) continue;
    const improved = ev.val != null && (best == null || ev.val < best);
    if (ev.val != null && (best == null || ev.val < best)) best = ev.val;
    records.push({ ...ev, runningBest: best, improved, summary: summarize(ev.slug, ev.note) });
  }

  // Cross-box wins from before this baseline era — kept for context, shown
  // collapsed under an "archived" disclosure, never as standing records.
  const archivedRecords: ClosedEvent[] = allWins
    .filter((e) => !inEra(e.date))
    .sort((a, b) => b.date.localeCompare(a.date));

  // Closed / failed: everything that didn't win, newest first (most relevant).
  const closed = byDate
    .filter((e) => e.verdict !== 'WIN')
    .sort((a, b) => b.date.localeCompare(a.date));

  const counts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.verdict] = (acc[e.verdict] ?? 0) + 1;
    return acc;
  }, {});

  // Mirror the record history to records.jsonl (durable, machine-readable
  // ledger). Best-effort: a failed write never breaks the UI response.
  try {
    const jsonl =
      records
        .map((r) =>
          JSON.stringify({
            ts: r.date,
            idea: r.slug,
            val: r.val,
            delta: r.delta,
            runningBest: r.runningBest,
            improved: r.improved,
            note: r.note,
          })
        )
        .join('\n') + (records.length ? '\n' : '');
    await writeFile(ledgerPath(), jsonl, 'utf8');
  } catch {
    /* non-fatal */
  }

  return Response.json(
    {
      success: true,
      records, // current-era val-loss record timeline (oldest→newest)
      archivedRecords, // cross-box wins from before this baseline era
      closed, // newest-first failed/closed experiments
      counts,
      bestVal: best, // standing record to beat (baseline, or the era's best)
      baseline, // the current-box baseline this board is reset to
    },
    { status: 200 }
  );
}
