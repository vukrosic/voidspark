import { hasActiveRepo } from '@/lib/projects';

// ---- voidbase proxy ---------------------------------------------------------
// voidspark is the FRONT-END; voidbase is the central registry DB + API. This
// route is the server-side bridge: it forwards to the voidbase API (the stdlib
// server in voidbase/api/server.py, reading the live SQLite today; the same
// endpoints will read Postgres/Supabase after cutover — this route does NOT
// change when that happens). Server-side fetch keeps the upstream URL
// configurable and avoids CORS. POST-only to match the app's other routes.
//
// Start the upstream:  cd voidbase && python3 api/server.py   (port 8787)
// Override the URL:    VOIDBASE_API_URL=http://host:port

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VOIDBASE_API = process.env.VOIDBASE_API_URL || 'http://127.0.0.1:8787';
const ALLOWED = new Set([
  'health', 'activity', 'runs', 'threads', 'comparisons', 'champions', 'ideas',
  'queue', 'eval',
]);

export async function POST(req: Request) {
  // Note: voidbase is global (not per-project), so unlike the autoresearch
  // routes it does NOT gate on hasActiveRepo — but we touch the import so the
  // lint/convention stays uniform if this grows project-scoped later.
  void hasActiveRepo;

  let resource = 'health';
  let id = '';
  let write: Record<string, unknown> | null = null;
  try {
    const body = await req.json();
    if (body && typeof body.resource === 'string') resource = body.resource;
    if (body && typeof body.id === 'string') id = body.id;
    // write:{...} forwards a POST to the upstream collection (thread authoring).
    if (body && body.write && typeof body.write === 'object') write = body.write;
  } catch {
    // empty/invalid body -> default to /health
  }

  if (!ALLOWED.has(resource)) {
    return Response.json(
      { success: false, error: `unknown resource '${resource}'`, allowed: [...ALLOWED] },
      { status: 200 },
    );
  }

  // Write path: only threads are writable; forward as an upstream POST.
  if (write) {
    if (resource !== 'threads') {
      return Response.json(
        { success: false, resource, error: `resource '${resource}' is read-only` },
        { status: 200 },
      );
    }
    try {
      const r = await fetch(`${VOIDBASE_API}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(write),
        cache: 'no-store',
      });
      const data = await r.json();
      return Response.json({ success: r.ok, resource, upstream: VOIDBASE_API, data }, { status: 200 });
    } catch (e) {
      return Response.json(
        { success: false, resource, upstream: VOIDBASE_API, error: `voidbase API unreachable`, detail: String(e) },
        { status: 200 },
      );
    }
  }

  // /eval is keyed by run id; everything else is a plain collection.
  const path =
    resource === 'eval' ? `eval?run_id=${encodeURIComponent(id)}` : resource;

  try {
    const r = await fetch(`${VOIDBASE_API}/${path}`, { cache: 'no-store' });
    const data = await r.json();
    return Response.json({ success: true, resource, upstream: VOIDBASE_API, data }, { status: 200 });
  } catch (e) {
    return Response.json(
      {
        success: false,
        resource,
        upstream: VOIDBASE_API,
        error: `voidbase API unreachable at ${VOIDBASE_API} — start it with: cd voidbase && python3 api/server.py`,
        detail: String(e),
      },
      { status: 200 },
    );
  }
}
