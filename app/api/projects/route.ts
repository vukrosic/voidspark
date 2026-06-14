import {
  listProjects,
  getActiveProjectId,
  setActiveProject,
  addProject,
  removeProject,
  scaffoldAutoresearch,
} from '@/lib/projects';

// POST with no body → { projects, activeId }.
// POST { activeId } → switch active project, then return the new state.
// POST { add: { name, repoPath } } → register a new project folder, then
//   return the updated registry (+ a non-blocking `warning` when the repo has
//   no autoresearch/ folder).
// POST { scaffold: { repoPath } } → copy the starter autoresearch/ template
//   into a repo that has none.
// POST { remove: { id } } → unregister a project folder, then return the
//   updated registry + the new activeId. The sidebar uses all of these.
export async function POST(req: Request) {
  let body: {
    activeId?: unknown;
    add?: { name?: unknown; repoPath?: unknown };
    scaffold?: { repoPath?: unknown };
    remove?: { id?: unknown };
  } = {};
  try {
    body = await req.json();
  } catch {
    /* read-only */
  }

  if (body.add && typeof body.add === 'object') {
    const result = await addProject(body.add.name, body.add.repoPath);
    if (!result.ok) {
      return Response.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }
    const activeId = await getActiveProjectId();
    return Response.json(
      {
        success: true,
        projects: result.projects,
        activeId,
        added: result.project,
        warning: result.warning ?? null,
      },
      { status: 200 }
    );
  }

  if (body.scaffold && typeof body.scaffold === 'object') {
    const result = await scaffoldAutoresearch(body.scaffold.repoPath);
    if (!result.ok) {
      return Response.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }
    return Response.json(
      { success: true, created: result.created },
      { status: 200 }
    );
  }

  if (body.remove && typeof body.remove === 'object') {
    const result = await removeProject(body.remove.id);
    if (!result.ok) {
      return Response.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }
    return Response.json(
      {
        success: true,
        projects: result.projects,
        activeId: result.newActiveId,
        removed: result.removed,
      },
      { status: 200 }
    );
  }

  if (typeof body.activeId === 'string') {
    await setActiveProject(body.activeId);
  }

  const [projects, activeId] = await Promise.all([listProjects(), getActiveProjectId()]);
  return Response.json({ success: true, projects, activeId }, { status: 200 });
}
