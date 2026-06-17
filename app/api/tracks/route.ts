import { NextResponse } from 'next/server';
import { hasActiveRepo } from '@/lib/projects';
import {
  listTracks,
  getActiveTrackId,
  addTrack,
  setActiveTrack,
  deleteTrack,
} from '@/lib/tracks';

// GET  -> { active, tracks }                  list this project's record tracks
// POST { action: 'create', name }             add a track (becomes active)
// POST { action: 'select', id }               switch the active track
// POST { action: 'delete', id }               de-register a track (keeps its data on disk)
export async function GET() {
  if (!hasActiveRepo()) return NextResponse.json({ active: 'main', tracks: [] });
  return NextResponse.json({ active: getActiveTrackId(), tracks: listTracks() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === 'create') {
    const res = await addTrack(body?.name);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
    return NextResponse.json({ ok: true, active: res.state.active, tracks: res.state.tracks });
  }

  if (action === 'select') {
    const ok = await setActiveTrack(body?.id);
    if (!ok) return NextResponse.json({ ok: false, error: 'unknown-id' }, { status: 400 });
    return NextResponse.json({ ok: true, active: getActiveTrackId(), tracks: listTracks() });
  }

  if (action === 'delete') {
    const res = await deleteTrack(body?.id);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
    return NextResponse.json({ ok: true, active: res.state.active, tracks: res.state.tracks });
  }

  return NextResponse.json({ ok: false, error: 'unknown-action' }, { status: 400 });
}
