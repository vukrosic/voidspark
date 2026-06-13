import { readFile, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { getActiveRepoDir } from './projects';

// Autorun state lives in one small file. Its presence = autorun is ON; its
// contents = which agent to launch the next queued run with (e.g. "minimax").
// Absent file = OFF. Keeping it on disk (not in memory) means the completion
// hook (run-done) and the UI agree across requests and server restarts.
const flagPath = () => join(getActiveRepoDir(), 'autoresearch', 'autorun.flag');

const KNOWN_AGENTS = new Set(['minimax', 'codex']);

// Returns the agent id to use for auto-launched runs, or null when autorun is
// off. Falls back to "minimax" if the file exists but holds an unknown value.
export async function getAutorunAgent(): Promise<string | null> {
  try {
    const raw = (await readFile(flagPath(), 'utf8')).trim();
    if (!raw) return null;
    return KNOWN_AGENTS.has(raw) ? raw : 'minimax';
  } catch {
    return null;
  }
}

// Turn autorun on (storing the agent) or off (removing the flag file).
export async function setAutorun(agent: string | null): Promise<void> {
  if (agent && KNOWN_AGENTS.has(agent)) {
    await writeFile(flagPath(), agent, 'utf8');
    return;
  }
  if (agent) {
    // unknown agent but truthy -> treat as "on" with the default runner.
    await writeFile(flagPath(), 'minimax', 'utf8');
    return;
  }
  await unlink(flagPath()).catch(() => {
    /* already off */
  });
}
