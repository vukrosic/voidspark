import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const TMUX_BIN = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find(
  (p) => existsSync(p)
) ?? 'tmux';

type Session = {
  name: string;
  created: number;
  windows: number;
  agentLabel: string | null;
  agentCommand: string | null;
};

function inferSessionLabel(
  agentLabel: string | null,
  agentCommand: string | null,
  paneTitle: string | null
): string | null {
  const explicit = agentLabel?.trim();
  if (explicit) return explicit;

  const command = agentCommand?.trim().toLowerCase() ?? "";
  const title = paneTitle?.trim().toLowerCase() ?? "";
  if (!command && !title) return null;
  if (command.includes('codex')) return 'Codex';
  if (command.includes('claude-minimax-free') || command.includes('minimax')) return 'MiniMax (cmf)';
  if (
    command.includes('claude.exe') ||
    command.includes('claude code') ||
    command.includes('claude') ||
    title.includes('claude code') ||
    title.includes('claude')
  ) {
    return 'Claude Code';
  }
  if (command.includes('bash') || command.includes('zsh') || command.includes('sh')) return 'Shell';
  return agentCommand;
}

async function listSessions(): Promise<Session[]> {
  try {
    const [sessionResult, paneResult] = await Promise.all([
      execFileAsync(
        TMUX_BIN,
        ['list-sessions', '-F', '#{session_name}|#{session_created}|#{session_windows}|#{@agent_label}'],
        { timeout: 10_000 }
      ),
      execFileAsync(
        TMUX_BIN,
        ['list-panes', '-a', '-F', '#{session_name}|#{pane_current_command}|#{pane_title}'],
        { timeout: 10_000 }
      ).catch(() => ({ stdout: '' })),
    ]);
    const paneBySession = new Map<string, { command: string | null; title: string | null }>();
    paneResult.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const [name, command = '', title = ''] = line.split('|');
        if (!name || paneBySession.has(name)) return;
        paneBySession.set(name, {
          command: command || null,
          title: title || null,
        });
      });
    return sessionResult.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, created, windows, agentLabel = ''] = line.split('|');
        const pane = paneBySession.get(name);
        const agentCommand = pane?.command ?? null;
        const label = inferSessionLabel(agentLabel || null, agentCommand, pane?.title ?? null);
        return {
          name,
          created: Number(created) * 1000,
          windows: Number(windows),
          agentLabel: label,
          agentCommand,
        };
      });
  } catch {
    // No tmux server running -> no sessions.
    return [];
  }
}

// POST-only: this site is built with `output: 'export'`, which rejects
// dynamic GET route handlers. action: "list" (default) returns the sessions;
// action: "kill" + name kills a session and returns the updated list.
export async function POST(req: Request) {
  let body: { action?: string; name?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  if (body.action === 'kill') {
    if (!body.name) {
      return Response.json({ success: false, error: 'missing session name' }, { status: 400 });
    }
    try {
      await execFileAsync(TMUX_BIN, ['kill-session', '-t', body.name], { timeout: 10_000 });
      return Response.json(
        { success: true, name: body.name, sessions: await listSessions() },
        { status: 200 }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ success: false, name: body.name, error: message }, { status: 500 });
    }
  }

  return Response.json({ success: true, sessions: await listSessions() }, { status: 200 });
}
