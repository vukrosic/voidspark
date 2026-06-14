# AGENT.md — set up VoidSpark for me

You are an AI coding agent setting up **VoidSpark** on the user's machine. Follow
these steps in order. Run the checks, fix what's missing, ask the user only for
the few things you can't determine yourself (API keys, which research repo to
drive). Be concise; report what you did and the final URL to open.

VoidSpark is a localhost autonomous-research loop: it mines research ideas,
implements each behind a flag, runs the A/B on a GPU, judges the result, and
queues the next — unattended. It runs entirely on the user's machine. Nothing
leaves their box.

---

## 0. Where you are

You should be inside the cloned `voidspark` repo. Confirm with `ls package.json`
(it should exist and the `name` field should be `voidspark`). If not, ask the
user for the repo path or clone it:
`git clone https://github.com/vukrosic/voidspark`.

## 1. Check prerequisites

Verify each; install or tell the user how if missing:

- **Node 20+** — `node --version`. Install via the user's package manager or nvm.
- **tmux** — `tmux -V`. Agents run in detached tmux sessions; it is required.
  (`brew install tmux` on macOS, `apt install tmux` on Linux.)
- **git** — `git --version`.
- **A coding-agent CLI on PATH** — at least one of `claude`, `codex`, or
  `claude-minimax-free` (`which claude codex claude-minimax-free`). This is the
  runner that does the actual implementing. If none exist, tell the user they
  need to install one (e.g. Claude Code) before the loop can run.

## 2. Install dependencies

```bash
npm install
```

## 3. Configure environment

Create `.env.local` from the example if it doesn't exist:

```bash
cp -n .env.local.example .env.local
```

Everything in it is optional, but the agent CLI needs a key. **Ask the user** for:

- `ANTHROPIC_API_KEY` — required by the Claude agent CLI. Write it into
  `.env.local`.
- `MINIMAX_API_KEY` *(optional)* — enables MiniMax as a cheaper runner. If the
  user doesn't have one, skip it; the MiniMax UI stays hidden and Codex is used.

Do not invent keys. If the user can't provide one now, continue — they can add it
later and restart.

## 4. Get a target research repo

VoidSpark drives a **separate** research repo (not this one). The repo must have
an `autoresearch/` folder — see `docs/research-repo.md` in this repo for the
layout. Ask the user which path to use:

- **They have one** — get the absolute path. Verify it exists and contains
  `autoresearch/` (`ls <path>/autoresearch`). If it has no `autoresearch/`, warn
  them — VoidSpark will show an empty dashboard.
- **They don't** — clone the reference example and use it:
  ```bash
  git clone https://github.com/vukrosic/universe-lm
  ```
  Its absolute path is the target.

You may seed it up front by setting `VOIDSPARK_TARGET_REPO=<abs path>` in
`.env.local`, or leave it and add the path in the onboarding card in step 6.

## 5. Start the dev server

```bash
npm run dev
```

It serves on **http://localhost:3000**. Keep it running (start it in the
background or a separate pane). Confirm it's up:
`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` → expect `200`.

## 6. Point VoidSpark at the repo

Tell the user to open **http://localhost:3000**. On a fresh setup it shows an
**onboarding card** — they paste the absolute path of the target research repo
from step 4. (If you set `VOIDSPARK_TARGET_REPO`, it's already seeded.)

## 7. (Optional) Connect a GPU box

The A/B runs execute on a remote GPU over SSH (e.g. Vast.ai). If the user has
one, tell them: open **Settings (gear, top-right) → GPU box (Vast.ai)** and paste
the SSH command their host gives them, e.g. `ssh -p 52674 root@1.2.3.4`. VoidSpark
parses host/port/user into the repo's `autoresearch/remote-box.json`. See
`docs/gpu-box.md`. Without a GPU box, the pipeline still mines and implements;
only the run stage needs it.

## 8. Verify and report

- `curl -s http://localhost:3000/api/health/` returns JSON (loop health).
- The dashboard at `http://localhost:3000` shows the ideas/queue, not the
  onboarding card.

Report to the user: what you installed, whether a key/GPU box is still needed,
and the URL to open. For how it all works next, point them at `README.md` and the
**Documentation** tab in the app (`docs/architecture.md`,
`docs/configuration.md`, `docs/troubleshooting.md`).
