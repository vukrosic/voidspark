import { readFileSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { getActiveRepoDir } from './projects';

// ---- Record tracks ----------------------------------------------------------
// A "track" is an independent research workspace inside one project: its own
// ideas/, closed.md, baseline-cache.json, leaderboard. One project can hold any
// number of tracks so you can run separate research directions side by side
// (e.g. "attention axis" vs "optimizer axis") without their idea queues or
// record boards mixing. Tracks are NOT bound to GPUs — you point whatever GPU
// you like at a track's folder yourself.
//
// Layout (backward compatible):
//   <repo>/autoresearch/            <- the "main" track (the original, unchanged)
//   <repo>/autoresearch/tracks/<id>/  <- every additional track, same shape
//
// State lives in <repo>/autoresearch/tracks.json (per project, so switching
// projects automatically loads that project's tracks). When the file is absent
// the project simply has the single implicit "main" track and every path
// resolves exactly as it did before tracks existed.

export type Track = { id: string; name: string };

export const MAIN_TRACK: Track = { id: 'main', name: 'Main' };

type TracksState = { active: string; tracks: Track[] };

const tracksJsonPath = () => join(getActiveRepoDir(), 'autoresearch', 'tracks.json');

// Always returns a valid state with "main" present at the front. Never throws —
// a missing/corrupt file degrades to the single implicit main track.
function readState(): TracksState {
  let parsed: Partial<TracksState> = {};
  try {
    parsed = JSON.parse(readFileSync(tracksJsonPath(), 'utf8'));
  } catch {
    /* no tracks.json yet — single implicit main track */
  }
  const extras = (Array.isArray(parsed.tracks) ? parsed.tracks : []).filter(
    (t): t is Track =>
      !!t && typeof t.id === 'string' && typeof t.name === 'string' && t.id !== 'main'
  );
  const tracks = [MAIN_TRACK, ...extras];
  const active =
    typeof parsed.active === 'string' && tracks.some((t) => t.id === parsed.active)
      ? parsed.active
      : 'main';
  return { active, tracks };
}

export function listTracks(): Track[] {
  return readState().tracks;
}

export function getActiveTrackId(): string {
  return readState().active;
}

export function getActiveTrack(): Track {
  const { active, tracks } = readState();
  return tracks.find((t) => t.id === active) ?? MAIN_TRACK;
}

// The single seam every record/idea/leaderboard route resolves through — the
// active track's autoresearch base dir. "main" is the repo's autoresearch/ root
// (identical to the old behavior); any other track is a tracks/<id>/ subdir.
export function getActiveAutoresearchDir(): string {
  const base = join(getActiveRepoDir(), 'autoresearch');
  const active = getActiveTrackId();
  return active === 'main' ? base : join(base, 'tracks', active);
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'track'
  );
}

async function writeState(state: TracksState): Promise<void> {
  // Persist only the non-main extras + active; main is always implicit.
  const extras = state.tracks.filter((t) => t.id !== 'main');
  await writeFile(
    tracksJsonPath(),
    JSON.stringify({ active: state.active, tracks: extras }, null, 2) + '\n',
    'utf8'
  );
}

export type AddTrackResult =
  | { ok: true; track: Track; state: TracksState }
  | { ok: false; error: 'invalid-name' | 'no-project' };

// Create a new track: register it and scaffold an empty ideas/ folder so the
// record/leaderboard routes read a real (empty) dir instead of erroring. Makes
// the new track active so the UI switches to it immediately.
export async function addTrack(rawName: unknown): Promise<AddTrackResult> {
  if (!getActiveRepoDir()) return { ok: false, error: 'no-project' };
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!name) return { ok: false, error: 'invalid-name' };

  const state = readState();
  const base = slugify(name);
  let id = base;
  let n = 2;
  while (state.tracks.some((t) => t.id === id) || id === 'main') {
    id = `${base}-${n++}`;
  }

  const track: Track = { id, name };
  const next: TracksState = { active: id, tracks: [...state.tracks, track] };

  // Scaffold the track's folder so reads don't 404 before the first idea lands.
  try {
    mkdirSync(join(getActiveRepoDir(), 'autoresearch', 'tracks', id, 'ideas'), {
      recursive: true,
    });
  } catch {
    /* non-fatal — the route still records the track; dir is created on use */
  }
  await writeState(next);
  return { ok: true, track, state: next };
}

export async function setActiveTrack(rawId: unknown): Promise<boolean> {
  const id = typeof rawId === 'string' ? rawId.trim() : '';
  if (!id) return false;
  const state = readState();
  if (!state.tracks.some((t) => t.id === id)) return false;
  await writeState({ ...state, active: id });
  return true;
}
