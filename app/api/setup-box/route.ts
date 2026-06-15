import { readFile } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { launchCodexWithText } from '@/lib/codexLauncher';
import { getActiveRepoDir, hasActiveRepo } from '@/lib/projects';

// ---- One-click GPU box setup -------------------------------------------------
// After you paste a fresh Vast.ai SSH command (Settings → GPU box → Save box),
// the new instance is bare metal — no repo, no venv, no deps. This route spins
// up a local coding agent (codex/minimax in tmux) whose whole job is to SSH into
// that box and set it up: clone the SAME GitHub repo this project drives, read
// the repo's own setup instructions (README/CONTRIBUTING/autoresearch docs),
// build the venv, install deps, and smoke-test that a run can actually start.
//
//   POST { agent?, headless? } -> launches `lab-setup-box` tmux session
//
// The agent runs locally and reaches the box over SSH using the host/port/user
// already parsed into autoresearch/remote-box.json. It never sees a credential
// — it relies on the same key-based SSH the rest of the GPU routes use.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

const boxPath = () => join(getActiveRepoDir(), 'autoresearch', 'remote-box.json');
// Optional, user-editable override. Falls back to the inline default below so
// existing repos work without scaffolding a new prompt file.
const promptOverridePath = () =>
  join(getActiveRepoDir(), 'autoresearch', 'prompts', 'setup-box.md');

type RemoteBox = {
  ssh?: string;
  host?: string;
  port?: number;
  user?: string;
  remote_repo?: string;
  remote_venv?: string;
};

async function readBox(): Promise<RemoteBox> {
  try {
    return JSON.parse(await readFile(boxPath(), 'utf8')) as RemoteBox;
  } catch {
    return {};
  }
}

// The GitHub repo this project drives — read from the local clone's git remote
// so the box clones the exact same codebase. Normalised to an https URL so the
// box can clone it without the author's SSH key.
async function repoCloneUrl(repoDir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoDir, 'config', '--get', 'remote.origin.url'], {
      timeout: 10_000,
    });
    let url = stdout.trim();
    if (!url) return '';
    // git@github.com:owner/repo.git -> https://github.com/owner/repo.git
    const scp = url.match(/^git@([^:]+):(.+)$/);
    if (scp) url = `https://${scp[1]}/${scp[2]}`;
    return url;
  } catch {
    return '';
  }
}

function defaultPrompt(): string {
  return [
    'You are setting up a freshly rented Vast.ai GPU box so this project can run',
    'experiments on it. The box is bare — no repo, no venv, no dependencies yet.',
    '',
    '## Box connection',
    '- SSH (non-interactive, use THIS form for commands): `{{SSH_PREFIX}} "<remote command>"`',
    '- Raw SSH command the user pasted (for reference): `{{SSH_RAW}}`',
    '- host: `{{HOST}}`  port: `{{PORT}}`  user: `{{USER}}`',
    '- target repo dir on the box: `{{REMOTE_REPO}}`',
    '- target venv on the box: `{{REMOTE_VENV}}`',
    '- repo to clone: `{{REPO_URL}}`',
    '',
    'Your local working directory is this project\'s repo, so you can read its',
    'instruction files locally for reference (README.md, CONTRIBUTING.md,',
    'AGENT.md, and anything under autoresearch/ such as RUN-CONTRACT.md /',
    'PIPELINE.md). The box should end up running the SAME code.',
    '',
    '## Do this, step by step',
    '1. Confirm you can reach the box: `{{SSH_PREFIX}} "nvidia-smi && python3 --version"`.',
    '   If SSH fails, STOP and report the exact error (wrong host/port, key not',
    '   accepted, box still booting). Do not guess past a connection failure.',
    '2. Clone the repo onto the box at `{{REMOTE_REPO}}` if it is not already',
    '   there (`git clone {{REPO_URL}} {{REMOTE_REPO}}`); otherwise `git pull` it.',
    '3. READ the repo\'s own setup instructions (README / CONTRIBUTING and the',
    '   autoresearch docs) and FOLLOW them. Create/activate the venv at',
    '   `{{REMOTE_VENV}}` and install the project\'s dependencies (requirements.txt',
    '   / pip / whatever the repo specifies).',
    '4. Smoke-test that a run can actually start: verify torch sees CUDA',
    '   (`python -c "import torch; print(torch.cuda.is_available())"`) and that the',
    '   project\'s entrypoint imports without error. Do NOT launch a full training',
    '   run — just prove the environment is ready.',
    '5. If you discover the real hardware/CUDA/torch versions, UPDATE the local',
    '   `autoresearch/remote-box.json` `hardware` and `notes` fields to match what',
    '   you actually saw on the box (keep host/port/user/ssh as they are).',
    '',
    '## Report',
    'End with a short summary: did SSH work, was the repo cloned/updated, did the',
    'venv + deps install cleanly, did the CUDA + import smoke check pass, and',
    'anything still broken that needs the user. Be specific about any failure.',
  ].join('\n');
}

export async function POST(req: Request) {
  if (!hasActiveRepo()) {
    return Response.json({ success: false, error: 'No project selected' }, { status: 200 });
  }

  let agent: string | undefined;
  let headless = false; // default: keep the pane open so the user can watch the setup
  try {
    const body = await req.json();
    if (typeof body.agent === 'string') agent = body.agent;
    if (typeof body.headless === 'boolean') headless = body.headless;
  } catch {
    /* defaults */
  }

  const box = await readBox();
  if (!box.host || !box.port || !box.user) {
    return Response.json(
      { success: false, error: 'No GPU box saved yet — paste and Save box first.' },
      { status: 200 }
    );
  }

  const repoDir = getActiveRepoDir();
  const repoUrl = await repoCloneUrl(repoDir);
  if (!repoUrl) {
    return Response.json(
      { success: false, error: "Couldn't read this repo's GitHub URL (git remote origin). Add a remote or set it in the repo." },
      { status: 200 }
    );
  }

  const remoteRepo = box.remote_repo?.trim() || `/root/${repoUrl.replace(/\.git$/, '').split('/').pop()}`;
  const remoteVenv = box.remote_venv?.trim() || '/venv/main';
  // Non-interactive SSH prefix: build a clean one from host/port/user (the saved
  // raw command often carries a -L port-forward that would hang a one-shot cmd).
  // accept-new avoids the host-key prompt that would stall a headless agent.
  const sshPrefix = `ssh -p ${box.port} -o StrictHostKeyChecking=accept-new ${box.user}@${box.host}`;

  let template: string;
  try {
    template = await readFile(promptOverridePath(), 'utf8');
  } catch {
    template = defaultPrompt();
  }

  const prompt = template
    .replaceAll('{{SSH_PREFIX}}', sshPrefix)
    .replaceAll('{{SSH_RAW}}', box.ssh ?? sshPrefix)
    .replaceAll('{{HOST}}', box.host)
    .replaceAll('{{PORT}}', String(box.port))
    .replaceAll('{{USER}}', box.user)
    .replaceAll('{{REMOTE_REPO}}', remoteRepo)
    .replaceAll('{{REMOTE_VENV}}', remoteVenv)
    .replaceAll('{{REPO_URL}}', repoUrl);

  const session = 'lab-setup-box';
  const result = await launchCodexWithText(prompt, 'lab-setup-box', repoDir, session, agent, {
    headless,
  });

  if (result.success) {
    return Response.json(
      {
        success: true,
        session: result.session,
        message: `Setting up ${box.user}@${box.host}:${box.port} in tmux session ${result.session}`,
        stdout: result.stdout,
      },
      { status: 200 }
    );
  }

  console.error('Failed to launch setup-box:', result.error);
  return Response.json(
    { success: false, session: result.session, error: result.error },
    { status: 500 }
  );
}
