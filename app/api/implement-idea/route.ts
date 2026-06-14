import { readFile } from 'fs/promises';
import { join } from 'path';
import { launchCodexWithText } from '@/lib/codexLauncher';
import { getActiveRepoDir, hasActiveRepo } from '@/lib/projects';

const TEMPLATE_PATH = () => `${getActiveRepoDir()}/autoresearch/prompts/implement-idea.md`;

// When an idea is in `needs-recode` (a GPU run failed), re-running the plain
// implement prompt would just rebuild the same broken code. Pull the latest
// failure note out of the idea's log.jsonl and prepend a fix-focused preamble so
// the agent debugs the actual error instead of re-implementing from scratch.
async function recodePreamble(slug: string): Promise<string> {
  const dir = join(getActiveRepoDir(), 'autoresearch', 'ideas', slug);
  let status = '';
  try {
    const md = await readFile(join(dir, 'idea.md'), 'utf8');
    status = md.match(/^status:\s*(.+)$/m)?.[1].trim() ?? '';
  } catch {
    return '';
  }
  if (status !== 'needs-recode' && status !== 'recoding') return '';

  // Last log line whose `to` is a fixing state carries the failure reason.
  let note = '';
  try {
    const lines = (await readFile(join(dir, 'log.jsonl'), 'utf8'))
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const j = JSON.parse(lines[i]);
        if (j.to === 'needs-recode' || j.to === 'recoding') {
          note = String(j.note ?? '');
          break;
        }
      } catch {
        /* skip malformed line */
      }
    }
  } catch {
    /* no log — fall through with empty note */
  }

  return [
    '> ## 🔧 THIS IS A RE-CODE — A PREVIOUS GPU RUN FAILED',
    '> The code for this idea already exists in the repo; do NOT re-implement it',
    '> from scratch. A run failed and it was sent back to be fixed. The reported',
    '> failure was:',
    '>',
    `> **${note || '(no failure note recorded — inspect the run log / latest diff)'}**`,
    '>',
    '> Reproduce the import/run locally if you can, fix the specific cause above',
    '> (keep the change minimal and still byte-identical at step 0 with the flag',
    '> off), then mark the idea `needs-run` again so it re-queues for the GPU.',
    '',
    '---',
    '',
  ].join('\n');
}

export async function POST(req: Request) {
  if (!hasActiveRepo()) {
    return Response.json({ success: false, error: 'No project selected' }, { status: 200 });
  }
  let slug = '';
  let agent: string | undefined;
  let headless = true;
  try {
    const body = await req.json();
    slug = body.slug;
    agent = body.agent;
    if (typeof body.headless === 'boolean') headless = body.headless;
  } catch {
    slug = '';
  }

  // Idea slugs are folder names like "107-exclusive-self-attn".
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
    return Response.json({ success: false, error: 'invalid idea slug' }, { status: 400 });
  }

  let template: string;
  try {
    template = await readFile(TEMPLATE_PATH(), 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ success: false, error: message }, { status: 500 });
  }

  // The finalize endpoint the implement session curls when it's done. Built
  // from the request host so the port is always right (dev server picks it).
  const host = req.headers.get('host') ?? 'localhost:3000';
  const doneUrl = `http://${host}/api/implement-done/`;

  const prompt =
    (await recodePreamble(slug)) +
    template.replaceAll('{{IDEA_SLUG}}', slug).replaceAll('{{DONE_URL}}', doneUrl);
  // Deterministic, identifiable session name per idea.
  const session = `lab-implement-${slug}`;

  // Headless safety net: run the finalize curl after the agent exits, so the
  // idea lands at needs-run even if the agent forgot to ping. Single-quoted to
  // survive the launcher's double-quoted send-keys line; slug is validated.
  const onExit = `curl -s -X POST '${doneUrl}' -H 'Content-Type: application/json' -d '{"slug":"${slug}"}' >/dev/null 2>&1`;

  const result = await launchCodexWithText(prompt, 'lab-implement', getActiveRepoDir(), session, agent, {
    headless,
    onExit,
  });

  if (result.success) {
    return Response.json(
      {
        success: true,
        session: result.session,
        message: `Implementing ${slug} in tmux session ${result.session}`,
        stdout: result.stdout,
      },
      { status: 200 }
    );
  }

  console.error('Failed to launch implement-idea:', result.error);
  return Response.json(
    { success: false, session: result.session, error: result.error },
    { status: 500 }
  );
}
