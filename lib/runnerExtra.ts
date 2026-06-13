import { readFile, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { getActiveRepoDir } from './projects';

// Free-text instructions the operator wants appended to the GPU runner agent's
// prompt — e.g. a one-off Vast.ai bash command, an env tweak, or a "this run,
// also try X" note. Stored in one small file so it survives server restarts and
// is shared by every launch path (autorun + manual run-next). Empty/absent = no
// extra instructions.
const extraPath = () => join(getActiveRepoDir(), 'autoresearch', 'runner-extra.txt');

// Hard cap so a paste can't bloat the prompt or smuggle in something huge.
const MAX_LEN = 4000;

export async function getRunnerExtra(): Promise<string> {
  try {
    return (await readFile(extraPath(), 'utf8')).trim();
  } catch {
    return '';
  }
}

export async function setRunnerExtra(text: string): Promise<void> {
  const trimmed = (text ?? '').slice(0, MAX_LEN).trim();
  if (!trimmed) {
    await unlink(extraPath()).catch(() => {
      /* already empty */
    });
    return;
  }
  await writeFile(extraPath(), trimmed, 'utf8');
}

// Render the extra as a clearly-fenced block to append to a runner prompt.
// Returns '' when there's nothing to add, so callers can concatenate blindly.
export function renderRunnerExtra(extra: string): string {
  if (!extra) return '';
  return [
    '',
    '## Operator instructions (added from the dashboard — follow these this pass)',
    extra,
  ].join('\n');
}
