import { readFile } from 'fs/promises';
import { resolve, sep } from 'path';

// Documentation view serves the hand-written .md files that live INSIDE this
// VoidSpark app folder (README, PLAN, scripts/*). The research repo's own
// docs (PIPELINE, queue, etc.) are surfaced separately by the project view,
// so the safeResolve root here is fixed to the VoidSpark repo itself rather
// than `getActiveRepoDir()`.
const ROOT = resolve(process.cwd());

function safeResolve(relPath: string): string | null {
  if (!relPath || typeof relPath !== 'string') return null;
  const full = resolve(ROOT, relPath);
  // Must stay inside VoidSpark and be a markdown file.
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  if (!full.endsWith('.md')) return null;
  return full;
}

// POST-only (matches /api/file so the editor UI pattern is identical).
// Body: { path: string } — repo-relative .md path. Returns the raw content.
export async function POST(req: Request) {
  let body: { path?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const full = safeResolve(body.path ?? '');
  if (!full) {
    return Response.json(
      { success: false, error: 'Path is not a .md file inside VoidSpark' },
      { status: 400 },
    );
  }

  try {
    const content = await readFile(full, 'utf8');
    return Response.json({ success: true, content, path: body.path }, { status: 200 });
  } catch (error) {
    // Don't leak the absolute on-disk path in the error (public tool). Report
    // missing files as a clean 404 keyed on the repo-relative path the UI asked
    // for; everything else is a generic read failure.
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return Response.json(
        { success: false, error: `Not found: ${body.path}` },
        { status: 404 },
      );
    }
    return Response.json(
      { success: false, error: `Could not read ${body.path}` },
      { status: 500 },
    );
  }
}
