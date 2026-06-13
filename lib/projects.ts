import { readFile, writeFile } from 'fs/promises';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { RESEARCH_REPO_DIR } from './codexLauncher';

// ---- Multi-project registry -------------------------------------------------
// VoidSpark drives one research repo at a time. The registry lists the repos the
// user has added; the "active" one is what every API route reads/writes. This is
// the data behind the sidebar — pick a project, and the whole loop operates on
// that repo (its own ideas, prompts, queue, autorun state, GPU box).
//
// Two files, both in the VoidSpark repo root (NOT in any target repo, so they
// survive switching):
//   projects.json   — the registry (committed; ships with the default kit)
//   .active-project  — the id of the active project (local state, gitignored)

export type Project = {
  id: string;
  name: string;
  repoPath: string;
};

const REGISTRY_PATH = join(process.cwd(), 'projects.json');
const ACTIVE_PATH = join(process.cwd(), '.active-project');

// Always-present fallback so a fresh checkout works before projects.json exists.
const DEFAULT_PROJECT: Project = {
  id: 'llm-research-kit',
  name: 'LLM Research Kit (universe-lm)',
  repoPath: RESEARCH_REPO_DIR,
};

function readRegistrySync(): Project[] {
  try {
    const raw = readFileSync(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const list: Project[] = Array.isArray(parsed) ? parsed : parsed.projects;
    const clean = (list ?? []).filter(
      (p): p is Project =>
        !!p && typeof p.id === 'string' && typeof p.repoPath === 'string'
    );
    return clean.length > 0 ? clean : [DEFAULT_PROJECT];
  } catch {
    return [DEFAULT_PROJECT];
  }
}

export async function listProjects(): Promise<Project[]> {
  return readRegistrySync();
}

// The active project's repo path — the single seam every route resolves through.
// Sync + cheap so it can be called inline wherever RESEARCH_REPO_DIR used to be.
export function getActiveRepoDir(): string {
  const projects = readRegistrySync();
  let activeId = projects[0]?.id;
  try {
    if (existsSync(ACTIVE_PATH)) {
      const id = readFileSync(ACTIVE_PATH, 'utf8').trim();
      if (id) activeId = id;
    }
  } catch {
    /* fall back to first */
  }
  const match = projects.find((p) => p.id === activeId);
  return (match ?? projects[0] ?? DEFAULT_PROJECT).repoPath;
}

export async function getActiveProjectId(): Promise<string> {
  const projects = readRegistrySync();
  try {
    const id = (await readFile(ACTIVE_PATH, 'utf8')).trim();
    if (id && projects.some((p) => p.id === id)) return id;
  } catch {
    /* fall back */
  }
  return projects[0]?.id ?? DEFAULT_PROJECT.id;
}

export async function setActiveProject(id: string): Promise<boolean> {
  const projects = readRegistrySync();
  if (!projects.some((p) => p.id === id)) return false;
  await writeFile(ACTIVE_PATH, id, 'utf8');
  return true;
}
