import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { getActiveRepoDir } from '@/lib/projects';

const execFileAsync = promisify(execFile);
const FLIP_SH = () => join(getActiveRepoDir(), 'autoresearch', 'bin', 'flip.sh');

// Statuses the UI is allowed to set directly (the Reset action sends
// "needs-taste"). Keep this whitelist tight so the button can't drive the
// pipeline into arbitrary states.
const ALLOWED_STATUSES = new Set(['needs-taste', 'needs-run', 'needs-review']);

export async function POST(req: Request) {
  let slug = '';
  let status = '';
  let note = '';
  try {
    ({ slug, status, note = '' } = await req.json());
  } catch {
    /* fall through to validation */
  }

  if (!slug || !/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
    return Response.json({ success: false, error: 'invalid idea slug' }, { status: 400 });
  }
  if (!ALLOWED_STATUSES.has(status)) {
    return Response.json({ success: false, error: 'status not allowed' }, { status: 400 });
  }

  try {
    const { stdout } = await execFileAsync(
      FLIP_SH(),
      [slug, status, 'reset-button', note || 'reset from UI'],
      { cwd: getActiveRepoDir(), timeout: 15_000 }
    );
    return Response.json({ success: true, slug, status, stdout: stdout.trim() }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('flip.sh failed:', message);
    return Response.json({ success: false, slug, error: message }, { status: 500 });
  }
}
