import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const TMUX_BIN = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find(
  (p) => existsSync(p)
) ?? 'tmux';

// Where saved tmux logs live. tmux only keeps scrollback in memory and loses it
// when a session is killed, so we mirror the captured pane to disk — that way
// the UI can still show the last-known output of a finished session.
//
// NOTE: these are meant to be short-lived. We currently sweep anything older
// than LOG_TTL_MS (1 hour) on each request; revisit if we ever want longer
// retention or a dedicated cron instead of this opportunistic cleanup.
const LOG_DIR = join(tmpdir(), 'lab-tmux-logs');
const LOG_TTL_MS = 60 * 60 * 1000; // 1 hour
const SCROLLBACK_LINES = 2000;

// tmux session names: letters, digits, dash, underscore, dot.
const NAME_RE = /^[A-Za-z0-9._-]+$/;

// ---- Agent activity feed ----------------------------------------------------
// Headless agents stream `--output-format stream-json` — one JSON event per
// step. Raw, that's an unreadable wall of JSON. This turns the event stream into
// a tidy, human-readable activity feed (what the agent said, which tools it ran,
// when it finished). Lines that aren't agent events (shell prompt, plain output,
// interactive codex sessions) pass through untouched, so this is safe for every
// session type.

function shorten(v: unknown, max = 200): string {
  let s = typeof v === 'string' ? v : JSON.stringify(v ?? '');
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// One-line description of a tool call, surfacing the useful argument per tool.
function describeTool(name: string, input: Record<string, unknown> | undefined): string {
  if (!input || typeof input !== 'object') return name;
  const i = input as Record<string, unknown>;
  switch (name) {
    case 'Bash':
      return `Bash › ${shorten(i.command, 160)}`;
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return `${name} › ${shorten(i.file_path ?? i.notebook_path ?? '', 120)}`;
    case 'Grep':
      return `Grep › ${shorten(i.pattern ?? '', 80)}`;
    case 'Glob':
      return `Glob › ${shorten(i.pattern ?? '', 80)}`;
    case 'Task':
      return `Task › ${shorten(i.description ?? i.subagent_type ?? '', 80)}`;
    default:
      return `${name} › ${shorten(i, 100)}`;
  }
}

type ContentBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: unknown;
};

function textOfResult(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text?: string }).text ?? '') : ''))
      .join(' ');
  }
  return '';
}

function formatAgentLog(raw: string): string {
  const out: string[] = [];
  let sawEvent = false;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(t);
    } catch {
      out.push(line); // not an event — keep as-is (shell line, plain output)
      continue;
    }
    if (!ev || typeof ev.type !== 'string') {
      out.push(line);
      continue;
    }
    sawEvent = true;
    switch (ev.type) {
      case 'system': {
        if (ev.subtype === 'init') {
          const model = typeof ev.model === 'string' ? ` · ${ev.model}` : '';
          out.push(`● agent started${model}`);
        }
        break; // ignore thinking_tokens etc.
      }
      case 'assistant': {
        const blocks =
          ((ev.message as { content?: ContentBlock[] } | undefined)?.content) ?? [];
        for (const b of blocks) {
          if (b.type === 'thinking' && b.thinking?.trim()) {
            out.push(`  💭 ${shorten(b.thinking, 180)}`);
          } else if (b.type === 'text' && b.text?.trim()) {
            out.push(b.text.trim());
          } else if (b.type === 'tool_use' && b.name) {
            out.push(`  🔧 ${describeTool(b.name, b.input)}`);
          }
        }
        break;
      }
      case 'user': {
        const blocks =
          ((ev.message as { content?: ContentBlock[] } | undefined)?.content) ?? [];
        for (const b of blocks) {
          if (b.type === 'tool_result') {
            const txt = shorten(textOfResult(b.content), 200);
            if (txt) out.push(`     ↳ ${txt}`);
          }
        }
        break;
      }
      case 'result': {
        const dur =
          typeof ev.duration_ms === 'number' ? ` · ${Math.round(ev.duration_ms / 1000)}s` : '';
        const turns = typeof ev.num_turns === 'number' ? ` · ${ev.num_turns} turns` : '';
        out.push(`✓ finished${dur}${turns}`);
        if (typeof ev.result === 'string' && ev.result.trim()) out.push(ev.result.trim());
        break;
      }
      default:
        break; // unknown event — skip
    }
  }
  // No structured events at all → return the raw capture unchanged (interactive
  // sessions, codex exec, or anything that prints plain text).
  return sawEvent ? out.join('\n') : raw;
}

async function sweepOldLogs() {
  try {
    const entries = await readdir(LOG_DIR);
    const now = Date.now();
    await Promise.all(
      entries.map(async (f) => {
        const p = join(LOG_DIR, f);
        try {
          const s = await stat(p);
          if (now - s.mtimeMs > LOG_TTL_MS) await unlink(p);
        } catch {
          /* ignore */
        }
      })
    );
  } catch {
    /* dir may not exist yet — nothing to sweep */
  }
}

export async function POST(req: Request) {
  let name = '';
  try {
    ({ name } = await req.json());
  } catch {
    name = '';
  }
  if (!name || !NAME_RE.test(name)) {
    return Response.json({ success: false, error: 'invalid session name' }, { status: 400 });
  }

  await sweepOldLogs();
  await mkdir(LOG_DIR, { recursive: true }).catch(() => {});
  const savedPath = join(LOG_DIR, `${name}.log`);

  // Is the session still alive? If so, capture its current scrollback and
  // persist it. If not, fall back to whatever we last saved.
  let alive = false;
  try {
    await execFileAsync(TMUX_BIN, ['has-session', '-t', name], { timeout: 8_000 });
    alive = true;
  } catch {
    alive = false;
  }

  if (alive) {
    try {
      const { stdout } = await execFileAsync(
        TMUX_BIN,
        // -J joins wrapped lines so each streamed JSON event stays on one line
        // (the pane is only 200 cols wide; without -J long events get chopped
        // mid-string and won't parse).
        ['capture-pane', '-t', name, '-p', '-J', '-S', `-${SCROLLBACK_LINES}`],
        { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }
      );
      // Turn the raw stream-json (if any) into a readable activity feed, then
      // trim the trailing blank lines tmux pads the pane with.
      const text = formatAgentLog(stdout).replace(/\s+$/, '');
      await writeFile(savedPath, text, 'utf8').catch(() => {});
      return Response.json(
        { success: true, name, alive: true, location: 'local', text, capturedAt: Date.now() },
        { status: 200 }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ success: false, name, alive: true, error: message }, { status: 200 });
    }
  }

  // Dead session: serve the saved copy if we have one.
  try {
    const text = await readFile(savedPath, 'utf8');
    const s = await stat(savedPath);
    return Response.json(
      { success: true, name, alive: false, location: 'local', text, savedAt: s.mtimeMs },
      { status: 200 }
    );
  } catch {
    return Response.json(
      { success: true, name, alive: false, location: 'local', text: '', note: 'no saved log' },
      { status: 200 }
    );
  }
}
