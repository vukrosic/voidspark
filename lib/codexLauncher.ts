import { execFile } from 'child_process';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const TMUX_BIN = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find(
  (p) => existsSync(p)
) ?? 'tmux';

// The target research repo VoidSpark drives, when no project is configured in
// the registry yet. Set VOIDSPARK_TARGET_REPO in .env.local, or add a repo from
// the dashboard onboarding card. Empty by default so a fresh clone carries no
// machine-specific path — see lib/projects.ts for the active-repo resolution.
export const RESEARCH_REPO_DIR = process.env.VOIDSPARK_TARGET_REPO ?? '';

// Generic agent launcher: takes <session> <agent-cmd> <prompt> and types
// `<agent-cmd> "$(cat prompt)"` into a detached tmux session. The runner is no
// longer hardcoded — pick an agent via AGENTS below. Ships vendored in scripts/
// so a fresh clone works without the author's ~/.agents skills; override with
// AGENT_LAUNCHER.
const LAUNCHER =
  process.env.AGENT_LAUNCHER ?? `${process.cwd()}/scripts/launch_agent.sh`;

// ---- Agents -----------------------------------------------------------------
// Each agent is just a command prefix; the prompt is appended as a final quoted
// positional arg (both codex and claude take the prompt that way). To add an
// agent, drop another entry here — nothing else in the launch path is agent
// specific.
export type AgentId = 'minimax' | 'codex';

// `cmd` is the interactive invocation (agent stays in its REPL after the task —
// the user can attach and watch). `headlessCmd` runs the task to completion and
// then *exits the process* (claude `-p` print mode / `codex exec`), so the tmux
// pane closes by itself. Headless is the default; see launchCodexWithText opts.
//
// `fallback` (headless only): if this agent's process exits non-zero OR prints a
// token-exhaustion marker, the SAME prompt is automatically re-run with the
// fallback agent in the same tmux pane. See buildFallbackCommand below.
export type AgentDef = {
  id: AgentId;
  label: string;
  cmd: string;
  headlessCmd: string;
  fallback?: AgentId;
};

const CODEX_MODEL = process.env.CODEX_MODEL ?? 'gpt-5.4-mini';

// Shell script that runs the primary agent and live-kills it on a rate-limit /
// out-of-tokens marker, then re-runs the prompt with the fallback. See
// scripts/agent_with_fallback.sh for the detection details.
const FALLBACK_SCRIPT =
  process.env.AGENT_FALLBACK_SCRIPT ??
  `${process.cwd()}/scripts/agent_with_fallback.sh`;

export const AGENTS: Record<AgentId, AgentDef> = {
  // Default. `cmf` in the user's shell — Claude Code routed to MiniMax-M3.
  // `claude-minimax-free` execs `claude --dangerously-skip-permissions "$@"`,
  // so appending `-p` gives non-interactive print mode that exits when done.
  //
  // `--output-format stream-json --verbose` makes print mode emit one JSON event
  // per step (tool call, message, result) in REAL TIME instead of staying silent
  // until the very end. That's what makes the tmux pane (and the UI log viewer,
  // which pretty-prints these events) actually show what the agent is doing.
  // The process still exits on completion, so the onExit curl + self-kill run.
  minimax: {
    id: 'minimax',
    label: 'MiniMax (cmf)',
    cmd: 'claude-minimax-free',
    // `< /dev/null` gives the agent an immediate stdin EOF — without it print
    // mode waits 3s for piped input and logs a "no stdin data" warning on every
    // launch. The prompt still arrives as the trailing positional arg.
    headlessCmd:
      'claude-minimax-free -p --output-format stream-json --verbose < /dev/null',
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    cmd: `codex -m ${CODEX_MODEL} --dangerously-bypass-approvals-and-sandbox`,
    headlessCmd: `codex exec -m ${CODEX_MODEL} --dangerously-bypass-approvals-and-sandbox`,
  },
};

// MiniMax is the cheap default but runs out of tokens; auto-fall back to Codex.
AGENTS.minimax.fallback = 'codex';

/**
 * Build the AGENT_CMD that runs `primaryCmd` with `fallbackCmd` as a live
 * rate-limit fallback, via scripts/agent_with_fallback.sh.
 *
 * launch_agent.sh appends the prompt as a single trailing positional arg
 * (`<AGENT_CMD> "$(cat promptfile)"`), so the script receives:
 *   agent_with_fallback.sh '<primary>' '<fallback>' '<prompt>'
 * Each command is single-quoted here so the tmux pane shell keeps it as ONE
 * arg (neither contains a single quote). The script itself handles tree-killing
 * MiniMax the instant it rate-limits, instead of waiting out its 10 retries.
 */
function buildFallbackCommand(primaryCmd: string, fallbackCmd: string): string {
  return `${FALLBACK_SCRIPT} '${primaryCmd}' '${fallbackCmd}'`;
}

async function tagSession(session: string, label: string, agentId: AgentId) {
  try {
    await execFileAsync(TMUX_BIN, ['set-option', '-t', session, '@agent_label', label], {
      timeout: 10_000,
    });
    await execFileAsync(TMUX_BIN, ['set-option', '-t', session, '@agent_id', agentId], {
      timeout: 10_000,
    });
  } catch {
    /* best effort — the UI also falls back to tmux command/title inference */
  }
}

export const DEFAULT_AGENT: AgentId = 'minimax';

export function resolveAgent(agent?: string): AgentDef {
  if (agent && agent in AGENTS) return AGENTS[agent as AgentId];
  return AGENTS[DEFAULT_AGENT];
}

export function makeSessionName(prefix: string) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${stamp}-${suffix}`;
}

type LaunchResult =
  | { success: true; session: string; agent: AgentId; stdout: string }
  | { success: false; session: string; agent: AgentId; error: string };

export type LaunchOpts = {
  // Default true. Run the agent non-interactively so the process exits on
  // completion (deterministic auto-close) instead of lingering at its REPL.
  headless?: boolean;
  // Optional shell command run *after* the agent process exits (headless only),
  // e.g. a curl to the done/finalize endpoint. Runs before the self-kill.
  onExit?: string;
};

/**
 * Fire-and-forget: launch the chosen agent in a detached tmux session via
 * launch_agent.sh with the given prompt text. Returns once the session is
 * started — it does NOT wait for the agent to finish. Pass an explicit
 * `session` name to make the tmux session identifiable (e.g. per-idea);
 * otherwise one is generated. `agent` selects the runner (defaults to MiniMax).
 *
 * In headless mode (default) we append a post-command to the typed line:
 * `<agent> "<prompt>" ; <onExit?> ; tmux kill-session`. Because the headless
 * agent exits when the task finishes, that curl + self-kill actually run — so
 * finalize no longer depends on the agent voluntarily curling as its last step.
 */
export async function launchCodexWithText(
  promptText: string,
  sessionPrefix: string,
  cwd: string = RESEARCH_REPO_DIR,
  session: string = makeSessionName(sessionPrefix),
  agent?: string,
  opts: LaunchOpts = {}
): Promise<LaunchResult> {
  const def = resolveAgent(agent);
  const headless = opts.headless ?? true;
  let cmd = headless ? def.headlessCmd : def.cmd;

  // Headless agents with a configured fallback get wrapped so a token-exhausted
  // / failed run silently retries the same prompt with the fallback agent. The
  // wrapper consumes the prompt as `$1`, so launch_agent.sh's trailing
  // `"$(cat promptfile)"` is forwarded to whichever agent ends up running.
  if (headless && def.fallback && def.fallback in AGENTS) {
    cmd = buildFallbackCommand(cmd, AGENTS[def.fallback].headlessCmd);
  }

  // Post-command: only meaningful headless (interactive agents hold the shell,
  // so anything appended here would never run). Run onExit, then self-kill.
  let postCmd = '';
  if (headless) {
    const parts: string[] = [];
    if (opts.onExit) parts.push(opts.onExit);
    parts.push(`tmux kill-session -t ${session} 2>/dev/null`);
    postCmd = parts.join(' ; ');
  }

  try {
    // The Next dev server sets npm_config_prefix, which makes nvm refuse to
    // load in the spawned tmux shell — and codex/claude live under nvm/local
    // bin. Strip it so the tmux shell sources nvm normally and finds the
    // runner on PATH.
    const env = { ...process.env };
    delete env.npm_config_prefix;
    delete env.NPM_CONFIG_PREFIX;

    const { stdout } = await execFileAsync(LAUNCHER, [session, cmd, promptText, postCmd], {
      cwd,
      env,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
    });

    await tagSession(session, def.label, def.id);

    return { success: true, session, agent: def.id, stdout: stdout.trim() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, session, agent: def.id, error: message };
  }
}

/** Read a prompt file, then launch it via {@link launchCodexWithText}. */
export async function launchCodexWithPrompt(
  promptPath: string,
  sessionPrefix: string,
  cwd: string = RESEARCH_REPO_DIR,
  agent?: string,
  opts: LaunchOpts = {}
): Promise<LaunchResult> {
  try {
    const prompt = await readFile(promptPath, 'utf8');
    return launchCodexWithText(prompt, sessionPrefix, cwd, makeSessionName(sessionPrefix), agent, opts);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      session: makeSessionName(sessionPrefix),
      agent: resolveAgent(agent).id,
      error: message,
    };
  }
}
