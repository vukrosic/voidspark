import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { getActiveRepoDir, hasActiveRepo } from '@/lib/projects';

// ---- GPU box (Vast.ai) connection -------------------------------------------
// Friendly read/write of the active repo's autoresearch/remote-box.json — the
// per-project file every GPU route resolves through (gpu, gpu-usage, attach,
// autorun). Instead of hand-editing JSON, the Settings panel posts the raw SSH
// command Vast.ai hands you and this route parses host/port/user out of it.
//
//   GET  -> { ok, configured, ssh, host, port, user, remote_repo, remote_venv }
//   POST { ssh, remote_repo?, remote_venv? }
//        -> parse + MERGE into the existing file (preserving provider/hardware/
//           notes), stamp `updated`, write. Returns the parsed identity.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const boxPath = () => join(getActiveRepoDir(), 'autoresearch', 'remote-box.json');

type RemoteBox = {
  provider?: string;
  ssh?: string;
  host?: string;
  port?: number;
  user?: string;
  remote_repo?: string;
  remote_venv?: string;
  hardware?: string;
  notes?: string;
  updated?: string;
};

// Pull user/host/port out of a pasted SSH command. Handles the Vast.ai shape
// with port forwards and extra flags, e.g.
//   ssh -L 8080:localhost:8080 -p 52674 root@1.208.108.242
//   ssh -p 52674 root@1.2.3.4
//   ssh root@host -p 22
function parseSsh(ssh: string): { host: string; port: number; user: string } | null {
  if (!ssh || typeof ssh !== 'string') return null;
  const portMatch = ssh.match(/(?:^|\s)-p\s+(\d+)/);
  const port = portMatch ? Number(portMatch[1]) : 22;
  // First user@host token (skip -L localhost:port forwards, which have no @).
  const userHost = ssh.match(/(?:^|\s)([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+)/);
  if (!userHost) return null;
  const user = userHost[1];
  const host = userHost[2];
  if (!host || !user || !Number.isFinite(port)) return null;
  return { host, port, user };
}

async function readBox(): Promise<RemoteBox> {
  try {
    return JSON.parse(await readFile(boxPath(), 'utf8')) as RemoteBox;
  } catch {
    return {};
  }
}

export async function GET() {
  if (!hasActiveRepo()) {
    return Response.json({ ok: false, error: 'No project selected' }, { status: 200 });
  }
  const box = await readBox();
  return Response.json({
    ok: true,
    configured: Boolean(box.host && box.port && box.user),
    ssh: box.ssh ?? '',
    host: box.host ?? '',
    port: box.port ?? null,
    user: box.user ?? '',
    remote_repo: box.remote_repo ?? '',
    remote_venv: box.remote_venv ?? '',
  });
}

export async function POST(req: Request) {
  if (!hasActiveRepo()) {
    return Response.json({ ok: false, error: 'No project selected' }, { status: 200 });
  }

  let body: { ssh?: unknown; remote_repo?: unknown; remote_venv?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const ssh = typeof body.ssh === 'string' ? body.ssh.trim() : '';
  const parsed = parseSsh(ssh);
  if (!parsed) {
    return Response.json(
      { ok: false, error: 'Could not parse host/port/user from that SSH command. Expected e.g. "ssh -p 52674 root@1.2.3.4".' },
      { status: 400 }
    );
  }

  // Merge into whatever's already there so provider/hardware/notes survive.
  const existing = await readBox();
  const next: RemoteBox = {
    ...existing,
    provider: existing.provider ?? 'vast',
    ssh,
    host: parsed.host,
    port: parsed.port,
    user: parsed.user,
    updated: new Date().toISOString().slice(0, 10),
  };
  if (typeof body.remote_repo === 'string' && body.remote_repo.trim()) {
    next.remote_repo = body.remote_repo.trim();
  }
  if (typeof body.remote_venv === 'string' && body.remote_venv.trim()) {
    next.remote_venv = body.remote_venv.trim();
  }

  try {
    await mkdir(dirname(boxPath()), { recursive: true });
    await writeFile(boxPath(), JSON.stringify(next, null, 2) + '\n', 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, error: `Couldn't write remote-box.json: ${message}` }, { status: 200 });
  }

  return Response.json({ ok: true, host: parsed.host, port: parsed.port, user: parsed.user });
}
