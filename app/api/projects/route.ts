import { listProjects, getActiveProjectId, setActiveProject } from '@/lib/projects';

// POST with no body → { projects, activeId }. POST { activeId } → switch active
// project, then return the new state. The sidebar uses both.
export async function POST(req: Request) {
  let body: { activeId?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* read-only */
  }

  if (typeof body.activeId === 'string') {
    await setActiveProject(body.activeId);
  }

  const [projects, activeId] = await Promise.all([listProjects(), getActiveProjectId()]);
  return Response.json({ success: true, projects, activeId }, { status: 200 });
}
