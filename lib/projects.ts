import { readFile, writeFile, unlink, cp, chmod } from 'fs/promises';
import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { RESEARCH_REPO_DIR } from './codexLauncher';

// ---- Multi-project registry -------------------------------------------------
// VoidSpark drives one research repo at a time. The registry lists the repos the
// user has added; the "active" one is what every API route reads/writes. This is
// the data behind the sidebar — pick a project, and the whole loop operates on
// that repo (its own ideas, prompts, queue, autorun state, GPU box).
//
// Two files, both in the VoidSpark repo root (NOT in any target repo, so they
// survive switching). Both are per-machine state (they hold absolute paths) and
// are gitignored — a fresh clone has neither and shows the onboarding card:
//   projects.json   — the registry (gitignored; see projects.example.json)
//   .active-project  — the id of the active project (gitignored)

export type Project = {
  id: string;
  name: string;
  repoPath: string;
};

const REGISTRY_PATH = join(process.cwd(), 'projects.json');
const ACTIVE_PATH = join(process.cwd(), '.active-project');

// Optional env seed so `VOIDSPARK_TARGET_REPO=/path npm run dev` works without
// touching the registry. When unset (RESEARCH_REPO_DIR === ''), a fresh clone
// has NO projects — the dashboard shows the onboarding card until the user adds
// one, so no machine-specific path ships in the repo.
const ENV_PROJECT: Project | null = RESEARCH_REPO_DIR
  ? { id: 'env', name: 'Target repo (VOIDSPARK_TARGET_REPO)', repoPath: RESEARCH_REPO_DIR }
  : null;

function readRegistrySync(): Project[] {
  let registry: Project[] = [];
  try {
    const raw = readFileSync(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const list: Project[] = Array.isArray(parsed) ? parsed : parsed.projects;
    registry = (list ?? []).filter(
      (p): p is Project =>
        !!p && typeof p.id === 'string' && typeof p.repoPath === 'string'
    );
  } catch {
    registry = [];
  }
  // Seed the env project first (if set and not already registered) so it's the
  // default active one on a fresh checkout that exported VOIDSPARK_TARGET_REPO.
  if (ENV_PROJECT && !registry.some((p) => p.repoPath === ENV_PROJECT.repoPath)) {
    return [ENV_PROJECT, ...registry];
  }
  return registry;
}

// Whether any project is configured. Routes that auto-poll on page load use
// this to short-circuit cleanly during the empty-registry onboarding state
// instead of reading from a relative/empty path.
export function hasActiveRepo(): boolean {
  return getActiveRepoDir() !== '';
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
  // Empty string when no project is configured (fresh clone) — callers/routes
  // treat this as the onboarding state.
  return (match ?? projects[0])?.repoPath ?? '';
}

export async function getActiveProjectId(): Promise<string> {
  const projects = readRegistrySync();
  try {
    const id = (await readFile(ACTIVE_PATH, 'utf8')).trim();
    if (id && projects.some((p) => p.id === id)) return id;
  } catch {
    /* fall back */
  }
  return projects[0]?.id ?? '';
}

export async function setActiveProject(id: string): Promise<boolean> {
  const projects = readRegistrySync();
  if (!projects.some((p) => p.id === id)) return false;
  await writeFile(ACTIVE_PATH, id, 'utf8');
  return true;
}

// ---- Add a project ---------------------------------------------------------
// User-facing: from the sidebar, paste a path to a local repo folder and it
// joins the registry. Validates the directory exists before persisting, so the
// dashboard never points the loop at a non-existent repo.

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  );
}

export type AddProjectError =
  | 'invalid-name'
  | 'invalid-path'
  | 'path-not-found'
  | 'path-not-directory';

// Non-blocking signal handed back to the UI when an added repo looks like it
// won't show anything. VoidSpark drives ONLY the `autoresearch/` folder; a repo
// without one renders an empty dashboard (the "my data vanished" footgun — the
// user usually pointed at the wrong folder). We warn instead of rejecting,
// because some users legitimately add a repo before scaffolding it — and the UI
// offers to scaffold it (see scaffoldAutoresearch).
export type AddProjectWarning = 'no-autoresearch';

// True when <repoPath>/autoresearch exists and is a directory.
function hasAutoresearchDir(repoPath: string): boolean {
  try {
    return statSync(join(repoPath, 'autoresearch')).isDirectory();
  } catch {
    return false;
  }
}

export async function addProject(
  rawName: unknown,
  rawPath: unknown
): Promise<
  | { ok: true; project: Project; projects: Project[]; warning?: AddProjectWarning }
  | { ok: false; error: AddProjectError }
> {
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  const repoPath = typeof rawPath === 'string' ? rawPath.trim() : '';
  if (!name) return { ok: false, error: 'invalid-name' };
  if (!repoPath) return { ok: false, error: 'invalid-path' };

  let stat;
  try {
    stat = statSync(repoPath);
  } catch {
    return { ok: false, error: 'path-not-found' };
  }
  if (!stat.isDirectory()) return { ok: false, error: 'path-not-directory' };

  // Soft check (after the hard directory validation, before persisting): the
  // repo is valid but has no autoresearch/, so flag it for the UI.
  const warning: AddProjectWarning | undefined = hasAutoresearchDir(repoPath)
    ? undefined
    : 'no-autoresearch';

  const projects = readRegistrySync();

  // If this exact path is already registered, treat it as a no-op success so
  // the UI just re-selects the existing entry instead of erroring.
  const dup = projects.find((p) => p.repoPath === repoPath);
  if (dup) {
    return { ok: true, project: dup, projects, warning };
  }

  // Build a unique id from the name. Suffix `-2`, `-3`, ... on collision.
  const base = slugify(name);
  let id = base;
  let n = 2;
  while (projects.some((p) => p.id === id)) {
    id = `${base}-${n++}`;
  }

  const project: Project = { id, name, repoPath };
  const next = [...projects, project];
  await writeFile(REGISTRY_PATH, JSON.stringify({ projects: next }, null, 2) + '\n', 'utf8');
  return { ok: true, project, projects: next, warning };
}

// ---- Scaffold autoresearch/ ------------------------------------------------
// Copies VoidSpark's starter template (templates/autoresearch/) into a repo that
// has none, so the dashboard has something to drive. The template is a STARTER:
// flip.sh + the directory contract work as-is, but the prompts carry TODO
// placeholders the user adapts to their codebase (see the template README).
//
// Deliberately refuses to overwrite an existing autoresearch/ — we never clobber
// a user's pipeline. Automation flags are NOT in the template (their presence
// means ON), so a freshly scaffolded repo never auto-starts anything.

export type ScaffoldError =
  | 'invalid-path'
  | 'path-not-found'
  | 'path-not-directory'
  | 'autoresearch-exists'
  | 'template-missing'
  | 'copy-failed';

export async function scaffoldAutoresearch(
  rawPath: unknown
): Promise<{ ok: true; created: string } | { ok: false; error: ScaffoldError }> {
  const repoPath = typeof rawPath === 'string' ? rawPath.trim() : '';
  if (!repoPath) return { ok: false, error: 'invalid-path' };

  let stat;
  try {
    stat = statSync(repoPath);
  } catch {
    return { ok: false, error: 'path-not-found' };
  }
  if (!stat.isDirectory()) return { ok: false, error: 'path-not-directory' };

  const dest = join(repoPath, 'autoresearch');
  if (existsSync(dest)) return { ok: false, error: 'autoresearch-exists' };

  const template = join(process.cwd(), 'templates', 'autoresearch');
  if (!existsSync(template)) return { ok: false, error: 'template-missing' };

  try {
    await cp(template, dest, { recursive: true });
    // cp preserves mode, but be explicit so flip.sh is runnable regardless of
    // how the template shipped (e.g. checked out without the exec bit).
    await chmod(join(dest, 'bin', 'flip.sh'), 0o755).catch(() => {
      /* non-fatal — the user can chmod it themselves */
    });
  } catch {
    return { ok: false, error: 'copy-failed' };
  }
  return { ok: true, created: dest };
}

// ---- Remove a project ------------------------------------------------------
// Inverse of addProject. Edits ONLY the VoidSpark registry — the target repo's
// experiments, ideas, flags, and code are untouched, so re-adding the same
// path later picks up exactly where the loop left off.
//
// If the removed project is the active one, .active-project is cleared so
// getActiveRepoDir() falls back to the first remaining entry (or
// DEFAULT_PROJECT when the registry is empty).

export type RemoveProjectError = 'unknown-id';

export async function removeProject(
  rawId: unknown
): Promise<
  | { ok: true; removed: Project; projects: Project[]; newActiveId: string }
  | { ok: false; error: RemoveProjectError }
> {
  const id = typeof rawId === 'string' ? rawId.trim() : '';
  if (!id) return { ok: false, error: 'unknown-id' };

  const projects = readRegistrySync();
  const target = projects.find((p) => p.id === id);
  if (!target) return { ok: false, error: 'unknown-id' };

  const next = projects.filter((p) => p.id !== id);
  await writeFile(REGISTRY_PATH, JSON.stringify({ projects: next }, null, 2) + '\n', 'utf8');

  // If we just removed the active project, drop the .active-project pointer
  // so getActiveProjectId() falls back to first remaining (or DEFAULT).
  if (id === (await getActiveProjectIdRaw())) {
    await unlink(ACTIVE_PATH).catch(() => {
      /* missing file is fine — that's the goal */
    });
  }

  const newActiveId = await getActiveProjectId();
  return { ok: true, removed: target, projects: next, newActiveId };
}

// Read the active project id without throwing, for internal use in the
// remove flow above. Duplicates the body of getActiveProjectId() minus the
// async write — kept private so the public API stays simple.
async function getActiveProjectIdRaw(): Promise<string> {
  const projects = readRegistrySync();
  try {
    const id = (await readFile(ACTIVE_PATH, 'utf8')).trim();
    if (id && projects.some((p) => p.id === id)) return id;
  } catch {
    /* fall back */
  }
  return projects[0]?.id ?? '';
}
