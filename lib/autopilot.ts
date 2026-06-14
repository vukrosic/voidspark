import { readFile, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { getActiveRepoDir } from './projects';

// Autopilot state lives in one small flag file, exactly like autorun. Presence =
// ON; contents = which agent the orchestrator launches gate-workers + the miner
// with (e.g. "minimax"). Absent file = OFF. On disk (not memory) so the UI poll
// and any other request agree across requests and server restarts.
const flagPath = () => join(getActiveRepoDir(), 'autoresearch', 'autopilot.flag');

const KNOWN_AGENTS = new Set(['minimax', 'codex']);

// Agent id to drive the pipeline with, or null when autopilot is off. Falls back
// to "minimax" if the file exists but holds an unknown value.
export async function getAutopilotAgent(): Promise<string | null> {
  try {
    const raw = (await readFile(flagPath(), 'utf8')).trim();
    if (!raw) return null;
    return KNOWN_AGENTS.has(raw) ? raw : 'minimax';
  } catch {
    return null;
  }
}

// Turn autopilot on (storing the agent) or off (removing the flag file).
export async function setAutopilot(agent: string | null): Promise<void> {
  if (agent && KNOWN_AGENTS.has(agent)) {
    await writeFile(flagPath(), agent, 'utf8');
    return;
  }
  if (agent) {
    await writeFile(flagPath(), 'minimax', 'utf8');
    return;
  }
  await unlink(flagPath()).catch(() => {
    /* already off */
  });
}
