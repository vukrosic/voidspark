# Connecting a GPU box

The A/B runs execute on a remote GPU you rent (e.g. [Vast.ai](https://vast.ai))
or any machine you can reach over SSH. VoidSpark SSHes in, launches the training
in a detached tmux session, and polls it — you never have to attach a terminal.

## Connect it (the easy way)

1. Rent an instance and copy the SSH command your host gives you, e.g.:
   ```
   ssh -p 52674 root@1.2.3.4
   ```
   The Vast.ai form with port-forwards works too —
   `ssh -L 8080:localhost:8080 -p 52674 root@1.2.3.4`.
2. Open **Settings → GPU box (Vast.ai)** and paste it. VoidSpark parses the
   host, port, and user and writes them into your repo's
   `autoresearch/remote-box.json` — no JSON editing.
3. Optionally fill **remote repo** (e.g. `/root/universe-lm`) and **venv**
   (e.g. `/venv/main`) so the runner knows where to run.
4. When you rent a new instance, just paste the new command — the rest is
   preserved.

> The pasted command is an SSH *invocation*, not a saved credential. The field is
> masked with an eye toggle and is deliberately not a browser password field, so
> Chrome/Firefox won't offer to "save password".

## What `remote-box.json` holds

```json
{
  "provider": "vast",
  "host": "1.2.3.4",
  "port": 52674,
  "user": "root",
  "remote_repo": "/root/universe-lm",
  "remote_venv": "/venv/main"
}
```

You can still hand-edit it via **Settings → Edit prompts → GPU box** as an
advanced escape hatch.

## What runs where

When a run starts, VoidSpark SSHes to the box and works inside a tmux session
named `arq`:

- `~/arq/STATUS` — a one-line status the dashboard reads.
- `~/arq/logs/*.log` — the live training log (the newest is tailed into the UI).
- `nvidia-smi` — utilization and memory, shown live.

The **GPU** card on the dashboard reflects all of this; you can attach the real
tmux from the box with `tmux attach -t arq`.

## Troubleshooting reachability

- The **Test** button (and the GPU card) report *unreachable* if the box is down,
  the SSH command is wrong, or your key isn't authorized on the instance.
- A connection check uses `BatchMode` (no password prompts) — make sure your SSH
  key is on the box. Password-only auth won't work for the automated polling.
- If runs sit in **Queued · GPU** but never start, the **GPU drainer** is off —
  turn it on (or enable Autoresearch). See [Configuration](configuration.md).
