import { readFile } from 'fs/promises';
import { join } from 'path';
import { hasActiveRepo } from '@/lib/projects';
import { getActiveAutoresearchDir, getActiveTrack } from '@/lib/tracks';

// ---- Track docs (brief / report / …) ----------------------------------------
// Each research track can carry top-level markdown docs at its autoresearch root:
// `brief.md` (the campaign's opening page) and `report.md` (the write-up), etc.
// They live at the track root (`autoresearch/<file>` for main,
// `autoresearch/tracks/<id>/<file>` otherwise), resolved through the same
// `getActiveAutoresearchDir()` seam the records/ideas routes use — so this route
// is automatically scoped to whatever track is active. Read-only here; editing
// goes through the generic /api/file MarkdownPanel.
//
// POST {} or { file?: "brief.md" } — `file` defaults to brief.md for back-compat
// and is hard-restricted to a bare `<name>.md` (no slashes / traversal).

export async function POST(req: Request) {
  if (!hasActiveRepo()) {
    return Response.json({ success: false, error: 'No project selected' }, { status: 200 });
  }

  let body: { file?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* no body → defaults to brief.md */
  }
  const raw = typeof body.file === 'string' ? body.file.trim() : 'brief.md';
  // Only a simple markdown filename — never a path. Blocks ../ traversal.
  const file = /^[a-z0-9._-]+\.md$/i.test(raw) && !raw.includes('..') ? raw : 'brief.md';

  const track = getActiveTrack();
  // The /api/file-relative path so the MarkdownPanel can open it for editing:
  // main → autoresearch/<file> ; others → autoresearch/tracks/<id>/<file>.
  const relPath =
    track.id === 'main'
      ? `autoresearch/${file}`
      : `autoresearch/tracks/${track.id}/${file}`;
  try {
    const content = await readFile(join(getActiveAutoresearchDir(), file), 'utf8');
    return Response.json({
      success: true,
      content,
      path: relPath,
      file,
      track: { id: track.id, name: track.name },
    });
  } catch {
    // No such doc for this track yet — not an error, the UI just hides the panel.
    return Response.json({
      success: true,
      content: null,
      path: relPath,
      file,
      track: { id: track.id, name: track.name },
    });
  }
}
