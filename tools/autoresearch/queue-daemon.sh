#!/usr/bin/env bash
# queue-daemon.sh — drain the GPU queue with NO LLM in the hot loop.
#
# Replaces the AI "runner" pass (prompts/runner.md) with a deterministic,
# idempotent, cron-safe script. It does only the mechanical last mile — claim,
# run, poll, pull, judge, flip — because the verdict is pure arithmetic
# (bin/baseline.sh verdict) and every needs-run idea arrives in the fixed shape
# defined in ../RUN-CONTRACT.md (run.json + an _arq_<idea>.py that defines `C`).
#
# AI still owns everything upstream: mining, taste, review, and writing code.
#
# One tick does:
#   0. resolve the live box (remote-box.json)
#   1. finalize: pull + judge any OK / bounce any FAIL still left in ~/arq/STATUS
#   2. if the `arq` tmux queue is live -> report and stop (runs in flight)
#   3. else: reclaim dead `running` ideas, claim the needs-run set, sync+smoke
#      on the box, ask baseline.sh whether to MEASURE, build one guarded queue,
#      launch it in detached `arq` tmux. Next tick finalizes it.
#
# Idempotent: never relaunches a live queue, never re-finalizes a done idea.
# No auto-push — local working tree + remote run only.
#
# Usage:
#   queue-daemon.sh [--repo PATH] [--once] [--loop SECONDS] [--dry-run]
#   --repo PATH : the repo to drain (its autoresearch/ data). Defaults to the repo
#                 this script lives in. Also settable via $REPO_ROOT.
set -uo pipefail

# TWO independent locations, deliberately split so this drainer can be ONE shared
# copy that drains ANY repo (no more per-repo script copies that drift):
#   TOOL_DIR  — where this script + its siblings (baseline.sh, _box_smoke.py) live.
#   ROOT      — the repo being drained: its autoresearch/ data (ideas, config,
#               champion, closed, results). Set via `--repo PATH` or $REPO_ROOT;
#               defaults to the repo this script lives in (back-compat for an
#               in-repo copy). flip.sh stays REPO-relative — it's the repo's own
#               status-change contract, called directly by agents/prompts/orchestrate.
TOOL_DIR="$(cd "$(dirname "$0")" && pwd)"
# Pre-scan argv for --repo so ROOT-derived paths below are correct before the main
# arg loop runs (load_config/load_champion read them at parse time). bash 3.2-safe.
for ((_i=1; _i<=$#; _i++)); do
  if [ "${!_i}" = "--repo" ]; then _j=$((_i+1)); REPO_ROOT="${!_j:-}"; fi
done
ROOT="${REPO_ROOT:-$(cd "$TOOL_DIR/../.." && pwd)}"
# baseline.sh lives here in voidspark now, so it can't infer the research repo
# from its own path — hand it the resolved ROOT so its cache writes land in the
# research repo (not voidspark/autoresearch/, which doesn't exist -> crash).
export AUTORESEARCH_REPO="$ROOT"
IDEAS="$ROOT/autoresearch/ideas"
FLIP="$ROOT/autoresearch/bin/flip.sh"          # per-repo contract (agents call it directly)
BASELINE="$TOOL_DIR/baseline.sh"               # central, ships with the drainer
BOX_JSON="$ROOT/autoresearch/remote-box.json"
CONFIG_JSON="$ROOT/autoresearch/config.json"   # repo-specifics (the general tool's only coupling)
STATE="$ROOT/autoresearch/daemon-state.json"
CLOSED="$ROOT/autoresearch/closed.md"
CHAMPION_JSON="$ROOT/autoresearch/champion.json"  # the live baseline experiments stack on

# ── voidbase Neon mirror ─────────────────────────────────────────────────────
# Neon is the AUTHORITATIVE shared coordination view; the flat-file ideas/ dir is
# this daemon's local cache + source of truth for the GPU drain. Each tick we:
#   pull  — materialize any Neon queue_item a maintainer/UI set to needs-run that
#           is missing locally AND whose _arq_*.py is already in the repo (the
#           GitHub code gate). This is how a UI click or a remote contributor
#           feeds the queue. Guarded: never overrides a live local status.
#   push  — mirror every local idea + runnable queue_item up to Neon so the UI
#           and remote boxes read one address.
# BEST-EFFORT + FAILURE-ISOLATED: a Neon outage logs and is a no-op — the GPU
# drain never blocks on the cloud DB (PGCONNECT_TIMEOUT bounds the connect).
# Override the voidbase checkout with $VOIDBASE_REPO; default is the sibling of
# the tool's repo (…/my-life/voidbase next to …/my-life/voidspark).
VOIDBASE_REPO="${VOIDBASE_REPO:-$(cd "$TOOL_DIR/../../../voidbase" 2>/dev/null && pwd)}"
VOIDBASE_SYNC="$VOIDBASE_REPO/scripts/sync_loop.py"
mirror_neon() {  # mirror_neon push | pull
  [ -f "$VOIDBASE_SYNC" ] || return 0
  case "$1" in
    pull) ( PGCONNECT_TIMEOUT=10 python3 "$VOIDBASE_SYNC" pull --feed --repo "$ROOT" 2>&1 | tail -3 >&2 ) || true ;;
    push) ( PGCONNECT_TIMEOUT=10 python3 "$VOIDBASE_SYNC" push       --repo "$ROOT" 2>&1 | tail -2 >&2 ) || true ;;
  esac
}

# Repo-specific knobs. Defaults below are overridden by the `drain` block of
# autoresearch/config.json (see load_config) so this daemon is repo-agnostic —
# the SAME tool drains any repo's experiments; only config.json changes.
REMOTE_TMUX="arq"
CTRL_CONFIG="configs.llm_config.Tiny1M3MConfig"
DATASET="processed_data/pretrain_1B"
# {config}/{seed}/{dataset} are substituted per run; this is the baseline control.
CTRL_CMD='python train_llm.py --config_class {config} --seed {seed} --dataset_path {dataset} --warmup false'
STALE_MIN="${STALE_MIN:-20}"     # a `running` idea older than this with no live arq = dead
DEFAULT_TIMEOUT="${JOB_TIMEOUT:-12m}"

# Pull repo-specifics out of config.json's `drain` block (all optional; the
# defaults above are the fallback). Keeps the daemon free of any one repo's
# model/dataset/config names.
# Build-smoke knobs passed through to _box_smoke.py on the box (defaults match
# the standalone script's own defaults).
SMOKE_TRAINER="train_llm"
SMOKE_MODEL_IMPORT="from models.llm import MinimalLLM"
SMOKE_MODEL_CTOR="MinimalLLM"
# Model/config code the box must `git pull` before it can build a stub. Implementer
# agents edit these in the working tree but are forbidden to push (human-review gate),
# so without this the box pulls stale code -> ImportError -> smoke FAIL -> GPU starves.
# autosync_code() commits+pushes exactly these paths before every remote pull.
SYNC_PATHS="configs models train_llm.py"
load_config() {
  [ -f "$CONFIG_JSON" ] || return 0
  local vals rt bc dp cc st si sc sp
  vals="$(python3 - "$CONFIG_JSON" <<'PY' 2>/dev/null || true
import json, sys
try: d = (json.load(open(sys.argv[1])).get("drain") or {})
except Exception: d = {}
s = (d.get("smoke") or {})
print(d.get("remote_tmux",""));   print(d.get("baseline_config",""))
print(d.get("dataset_path",""));  print(d.get("ctrl_command",""))
print(s.get("trainer",""));       print(s.get("model_import",""))
print(s.get("model_ctor",""))
print(" ".join(d.get("sync_paths") or []))
PY
)"
  { read -r rt; read -r bc; read -r dp; read -r cc; read -r st; read -r si; read -r sc; read -r sp; } <<<"$vals"
  [ -n "$rt" ] && REMOTE_TMUX="$rt"
  [ -n "$bc" ] && CTRL_CONFIG="$bc"
  [ -n "$dp" ] && DATASET="$dp"
  [ -n "$cc" ] && CTRL_CMD="$cc"
  [ -n "$st" ] && SMOKE_TRAINER="$st"
  [ -n "$si" ] && SMOKE_MODEL_IMPORT="$si"
  [ -n "$sc" ] && SMOKE_MODEL_CTOR="$sc"
  [ -n "$sp" ] && SYNC_PATHS="$sp"
}
load_config

# ── champion (the live, stacked baseline) ────────────────────────────────────
# champion.json names the current best architecture. Every new experiment is
# judged against (and built on top of) it, and a new record promotes itself —
# all without re-measuring a control every queue. Empty stub => bare base config.
CHAMPION_STUB=""; CHAMPION_CLASS=""; CHAMPION_VAL=""
load_champion() {
  [ -f "$CHAMPION_JSON" ] || return 0
  local vals
  vals="$(python3 - "$CHAMPION_JSON" <<'PY' 2>/dev/null || true
import json, sys
try: d = json.load(open(sys.argv[1]))
except Exception: d = {}
print(d.get("stub", "")); print(d.get("config_class", "")); print(d.get("val", ""))
PY
)"
  { read -r CHAMPION_STUB; read -r CHAMPION_CLASS; read -r CHAMPION_VAL; } <<<"$vals"
}
load_champion
# Lock keyed by the drained repo, not the script path — one shared daemon binary
# can drain several repos concurrently without their ticks colliding on one lock.
LOCK="/tmp/queue-daemon-$(echo "$ROOT" | shasum 2>/dev/null | cut -c1-12 || echo default).lock"

DRY=0; MODE="once"; LOOP_SECS=600
while [ $# -gt 0 ]; do case "$1" in
  --dry-run) DRY=1;;
  --once) MODE="once";;
  --loop) MODE="loop"; [ -n "${2:-}" ] && { LOOP_SECS="$2"; shift; };;
  --repo) [ -n "${2:-}" ] && shift;;   # pre-scanned above into ROOT; just consume the value
  *) echo "unknown arg: $1" >&2; exit 2;;
esac; shift; done

# Diagnostics go to stderr — claimable()/sync_and_smoke() return their batch on
# stdout via command substitution, so any log/flip line on stdout would be
# swallowed into the batch and emitted as a garbage `run …` job. Keep stdout
# clean for data only.
log() { echo "[daemon $(date -u +%H:%M:%S)] $*" >&2; }

# ── box (parsed once per tick from remote-box.json) ──────────────────────────
HOST=""; PORT=""; SSHUSER=""; REMOTE_REPO=""; REMOTE_VENV=""
load_box() {
  [ -f "$BOX_JSON" ] || { log "NO BOX: $BOX_JSON missing"; return 1; }
  local vals
  vals="$(python3 - "$BOX_JSON" <<'PY'
import json, sys
b = json.load(open(sys.argv[1]))
print(b.get("host", ""))
print(b.get("port", ""))
print(b.get("user", "root"))
print(b.get("remote_repo", "/root/universe-lm"))
print(b.get("remote_venv", "/venv/main"))
PY
)" || return 1
  { read -r HOST; read -r PORT; read -r SSHUSER; read -r REMOTE_REPO; read -r REMOTE_VENV; } <<<"$vals"
  [ -n "$HOST" ] && [ -n "$PORT" ] || { log "NO BOX: host/port empty in remote-box.json"; return 1; }
  CTL_PATH="/tmp/lab-arq-ctl-${SSHUSER}-${HOST}-${PORT}"   # shared multiplex socket
  # Build the multiplex opts now that CTL_PATH is known (at script-parse time it
  # was empty -> `-o ControlPath=` with no argument). Every SSH/SCP/master call
  # below shares this one socket.
  MUX_OPTS=(-o ControlMaster=auto -o "ControlPath=$CTL_PATH" -o "ControlPersist=$MASTER_PERSIST"
            -o ServerAliveInterval=20 -o ServerAliveCountMax=5
            -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=15)
  return 0
}

# SSH connection multiplexing — one warm TCP connection shared by every ssh/scp
# this tick makes (and across ticks, within ControlPersist). A daemon tick fires
# a burst: box_reachable, finalize pulls, git pull, scp+smoke per idea, launch.
# Without multiplexing each of those is a fresh handshake and Vast.ai throttles
# auth ("too many ssh connections in quick succession" -> "Connection closed by
# remote host"), which wedges the tick and leaves ideas stuck `running`. Same
# pattern as voidspark app/api/gpu-usage/route.ts. Keyed by user-host-port so a
# new box gets a fresh socket; ControlPersist outlives one tick so back-to-back
# ssh calls reuse the master. Shared with orchestrate.sh's arq probe.
CTL_PATH=""   # set by load_box (needs host/port)

# Shared multiplex opts. The single biggest throttle fix is ControlPersist >
# the loop interval: with the old 120s persist but a 300s loop, the master died
# between ticks, so EVERY tick re-handshaked — and any stray bare `ssh` landing
# in the same window made it a burst that Vast.ai auth-throttles ("too many ssh
# connections" -> "Connection closed by remote host"). MASTER_PERSIST keeps one
# warm master for the whole daemon run; ServerAlive keeps it from going half-dead.
MASTER_PERSIST="${MASTER_PERSIST:-3600}"
THROTTLE_RE='Connection closed|Connection reset|too many|kex_exchange_identification'
MUX_OPTS=()   # built by load_box once CTL_PATH (host/port) is known

# Proactively bring up ONE persistent background master (idempotent: -O check is
# a no-op if it's already alive). All SSH/SCP below then ride this single TCP
# session — zero new handshakes per tick once it's up. Retries on the throttle
# message itself with backoff, since the handshake is the only call that can hit
# it. Returns 0 once a master is confirmed live, non-zero if the box is truly down.
master_alive() { ssh -O check "${MUX_OPTS[@]}" -p "$PORT" "$SSHUSER@$HOST" 2>/dev/null; }
ensure_master() {
  master_alive && return 0
  local t=0 out
  while [ "$t" -le 4 ]; do
    out="$(ssh -fNM "${MUX_OPTS[@]}" -p "$PORT" "$SSHUSER@$HOST" 2>&1)"
    master_alive && return 0
    echo "$out" | grep -qE "$THROTTLE_RE" || { [ -n "$out" ] && log "master: $out"; }
    t=$((t+1)); log "master handshake throttled/failed, backoff ${t}x"; sleep $((t*6))
  done
  return 1
}

# -n (stdin from /dev/null) is REQUIRED: SSH() is called inside `while read`
# loops fed by `<<<"$batch"`. Without -n, ssh inherits and drains the loop's
# stdin, so only the FIRST idea is processed. No SSH() caller pipes data in.
SSH() { ssh -n "${MUX_OPTS[@]}" -p "$PORT" "$SSHUSER@$HOST" "$@"; }
SCP_TO() { scp "${MUX_OPTS[@]}" -P "$PORT" "$1" "$SSHUSER@$HOST:$2"; }
SCP_FROM() { scp "${MUX_OPTS[@]}" -P "$PORT" "$SSHUSER@$HOST:$1" "$2"; }
# Batch-copy many local files into one remote dir in a SINGLE scp (one channel,
# reuses the master) instead of one scp per file.
SCP_MANY_TO() { local dst="${!#}"; scp "${MUX_OPTS[@]}" -P "$PORT" "${@:1:$#-1}" "$SSHUSER@$HOST:$dst"; }

arq_live() { SSH "tmux has-session -t $REMOTE_TMUX 2>/dev/null"; }
box_reachable() { ensure_master; }

iso_to_epoch() { date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$1" +%s 2>/dev/null || echo 0; }
# field <file> <key> — read a YAML-frontmatter scalar. Split on the FIRST colon
# only: values legitimately contain colons (e.g. `updated: 2026-06-15T11:19:58Z`),
# and the old `-F': *'` split every colon, truncating timestamps to `...T11` →
# iso_to_epoch parse-fail → 0 → bogus ~29e6-minute ages → every running idea looked
# stale → reclaimed every tick → relaunch races on a live GPU (the OOM collisions).
field() { awk -v k="$2" '{p=index($0,":"); if(p>0 && substr($0,1,p-1)==k){v=substr($0,p+1); sub(/^ +/,"",v); print v; exit}}' "$1"; }
idea_status() { field "$IDEAS/$1/idea.md" status; }

# ── needs-run claim eligibility: must ship a valid run.json + existing arq_file ─
# Prints "<idea> <arq_file> <timeout>" per claimable idea; logs and skips the
# malformed ones (they never reach the box — an implementer bug, not a result).
claimable() {
  local d idea rj arq to
  for d in "$IDEAS"/*/; do
    [ -f "$d/idea.md" ] || continue          # skip non-idea dirs (_closed/ etc.)
    idea="$(basename "$d")"
    [ "$(idea_status "$idea")" = "needs-run" ] || continue
    rj="$d/run.json"
    if [ ! -f "$rj" ]; then log "SKIP $idea: no run.json (implementer must emit it)"; continue; fi
    read -r arq to < <(python3 - "$rj" <<'PY'
import json, sys
try:
    j = json.load(open(sys.argv[1]))
except Exception as e:
    print("ERR ERR"); sys.exit()
print(j.get("arq_file", "ERR"), j.get("job_timeout", ""))
PY
)
    if [ "$arq" = "ERR" ] || [ -z "$arq" ]; then log "SKIP $idea: bad run.json"; continue; fi
    if [ ! -f "$ROOT/$arq" ]; then log "SKIP $idea: arq_file $arq missing in repo"; continue; fi
    [ -z "$to" ] && to="$DEFAULT_TIMEOUT"
    echo "$idea $arq $to"
  done
}

# ── results.json helpers (the durable raw record baseline.sh reads) ──────────
# probe the box and (re)write instance{} into results.json
results_init() {
  local rdir="$1" probe gpu drv vram cc
  probe="$(SSH "nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader,nounits 2>/dev/null | head -1; echo '<<>>'; export PATH=$REMOTE_VENV/bin:\$PATH; python -c 'import torch;print(\".\".join(map(str,torch.cuda.get_device_capability())))' 2>/dev/null")" || return 1
  gpu="$(echo "$probe"  | sed -n '1p' | awk -F', *' '{print $1}')"
  drv="$(echo "$probe"  | sed -n '1p' | awk -F', *' '{print $2}')"
  vram="$(echo "$probe" | sed -n '1p' | awk -F', *' '{print $3}')"
  cc="$(echo "$probe"   | awk '/<<>>/{getline; print}')"
  mkdir -p "$rdir"
  python3 - "$rdir/results.json" "$gpu" "$drv" "$vram" "$cc" "$HOST:$PORT" <<'PY'
import json, os, sys, datetime
path, gpu, drv, vram, cc, host = sys.argv[1:7]
r = json.load(open(path)) if os.path.exists(path) else {}
r.setdefault("date", datetime.date.today().isoformat())
r["tier"] = "tiny1m3m"; r["seed"] = 42
r["instance"] = {"id": host, "gpu": gpu, "vram_mib": vram, "driver": drv,
                 "compute_cap": cc, "host": host}
r.setdefault("dynamo", "TORCHDYNAMO_DISABLE=1 (sm_86 polar_express OOM work-around)")
r.setdefault("data", "processed_data/pretrain_1B")
r.setdefault("runs", [])
json.dump(r, open(path, "w"), indent=2); open(path, "a").write("\n")
PY
}

# upsert one finished run into results.json (skips if already recorded)
results_upsert() {
  python3 - "$1" "$2" "$3" "$4" "$5" "$6" <<'PY'
import json, sys
path, name, val, trn, acc, logname = sys.argv[1:7]
r = json.load(open(path))
runs = r.setdefault("runs", [])
e = next((x for x in runs if x.get("name") == name), None)
if e is None:
    e = {"name": name}; runs.append(e)
e["val_loss"]   = float(val) if val else None
e["train_loss"] = float(trn) if trn else None
e["val_accuracy"] = float(acc) if acc else None
e["log"] = logname
json.dump(r, open(path, "w"), indent=2); open(path, "a").write("\n")
PY
}

# ── local tick state (so finalize on a later tick finds the right dir/baseline) ─
state_write() {  # state_write <results_dir> <mode> <mean> <band> <box_key>
  python3 - "$STATE" "$1" "$2" "$3" "$4" "$5" "$HOST:$PORT" <<'PY'
import json, sys
path, rdir, mode, mean, band, key, host = sys.argv[1:8]
json.dump({"results_dir": rdir, "mode": mode, "mean": mean, "band": band,
           "box_key": key, "host": host}, open(path, "w"), indent=2)
PY
}
state_get() { [ -f "$STATE" ] && field_json "$STATE" "$1"; }
field_json() { python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get(sys.argv[2],""))' "$1" "$2" 2>/dev/null; }

# ── evidence.md (deterministic; the transfer-note prose is left to an analyzer) ─
write_evidence() {  # write_evidence <idea> <verdict> <val> <delta> <mean> <band> <rdir>
  local idea="$1" verdict="$2" val="$3" delta="$4" mean="$5" band="$6" rdir="$7"
  cat > "$IDEAS/$idea/evidence.md" <<EOF
# Evidence — $idea

## Verdict: $verdict
- tier: tiny1m3m, seed 42, box: $HOST:$PORT
- baseline: mean=$mean ±$band (box-keyed cache)
- treatment val: $val   Δ vs baseline: $delta
- bpb: n/a (pending harness)
- pass/fail bar: noise-band rule — WIN iff val < mean − band (see plan.md for the paper-level claim)
- raw: ${rdir#$ROOT/}/results.json (logs alongside)
- date: $(date -u +%F)
- judged-by: queue-daemon.sh (deterministic)

## Transfer note
(auto) deferred — see idea.md \`## Scale evidence\`. Written by the analyzer pass, not the daemon.
EOF
}

append_closed_null() {  # append_closed_null <idea> <delta>
  local idea="$1" delta="$2" line marker
  marker='<!-- reviewer/evidence step appends one line per close here -->'
  line="- $idea — null: Δ=$delta at tiny1m3m (inside variance) — $(date -u +%F)"
  [ -f "$CLOSED" ] || return 0
  grep -qF -- "$idea — null:" "$CLOSED" && return 0
  awk -v m="$marker" -v l="$line" '{print} index($0,m)&&!d{print l; d=1}' "$CLOSED" > "$CLOSED.tmp" \
    && mv "$CLOSED.tmp" "$CLOSED"
}

# A suspected leak (val collapsed far below the baseline — see the leak guard in
# finalize_one) is logged distinctly so it never reads as a record or a clean null.
append_closed_leak() {  # append_closed_leak <idea> <val> <mean>
  local idea="$1" val="$2" mean="$3" line marker
  marker='<!-- reviewer/evidence step appends one line per close here -->'
  line="- $idea — LEAK (rejected): val=$val implausibly below baseline $mean at tiny1m3m — likely broken causal mask / label leak, NOT a win — $(date -u +%F)"
  [ -f "$CLOSED" ] || return 0
  grep -qF -- "$idea — LEAK" "$CLOSED" && return 0
  awk -v m="$marker" -v l="$line" '{print} index($0,m)&&!d{print l; d=1}' "$CLOSED" > "$CLOSED.tmp" \
    && mv "$CLOSED.tmp" "$CLOSED"
}

# A win is a record — append it to closed.md too, in the same shape the records
# board parses (slug — WIN: trt=<val> … (Δ<delta>) … <date>). Without this, a
# daemon-judged win flips to done but never reaches the record timeline.
append_closed_win() {  # append_closed_win <idea> <val> <delta> <mean> <band>
  local idea="$1" val="$2" delta="$3" mean="$4" band="$5" line marker
  marker='<!-- reviewer/evidence step appends one line per close here -->'
  line="- $idea — WIN: trt=$val vs baseline ${mean}±${band} (Δ$delta) at tiny1m3m — $(date -u +%F)"
  [ -f "$CLOSED" ] || return 0
  grep -qF -- "$idea — WIN:" "$CLOSED" && return 0
  awk -v m="$marker" -v l="$line" '{print} index($0,m)&&!d{print l; d=1}' "$CLOSED" > "$CLOSED.tmp" \
    && mv "$CLOSED.tmp" "$CLOSED"
}

# Locate an idea's runnable stub (run.json arq_file, else _arq_<idea>.py at root).
champion_stub_for() {  # champion_stub_for <idea>
  local idea="$1" arq
  arq="$(python3 -c "import json;print(json.load(open('$IDEAS/$idea/run.json')).get('arq_file',''))" 2>/dev/null)"
  [ -n "$arq" ] && [ -f "$ROOT/$arq" ] && { echo "$arq"; return 0; }
  [ -f "$ROOT/_arq_${idea}.py" ] && { echo "_arq_${idea}.py"; return 0; }
  return 1
}

# A new record promotes ITSELF to champion: it becomes the baseline the next
# batch is judged against and stacked on. Fully deterministic — no LLM, and no
# re-measure (the winning run already measured the new baseline; we just pin it).
promote_champion() {  # promote_champion <idea> <val> <rdir>
  local idea="$1" val="$2" rdir="$3" stub cls
  stub="$(champion_stub_for "$idea")" || { log "champion: no stub for $idea — promotion skipped"; return 0; }
  cls="$(python3 - "$ROOT/$stub" <<'PY' 2>/dev/null || true
import re, sys
src = open(sys.argv[1]).read()
m = re.search(r'class\s+C\s*\(\s*([A-Za-z_][\w.]*)\s*\)', src)
parent = m.group(1) if m else ""
mod = ""
if parent and '.' not in parent:
    im = re.search(r'from\s+([\w.]+)\s+import\s+([^\n]+)', src)
    if im and parent in [x.strip() for x in im.group(2).split(',')]:
        mod = im.group(1)
print(f"{mod}.{parent}" if mod else parent)
PY
)"
  if [ "$DRY" = 1 ]; then log "DRY promote champion -> $idea ($val)"; return 0; fi
  # Pin the new champion val as this box's baseline (no future ctrl runs).
  "$BASELINE" promote "$rdir/results.json" "$val" >&2 2>/dev/null || true
  # Rewrite champion.json: new stub/class/val + append to lineage.
  python3 - "$CHAMPION_JSON" "$idea" "$stub" "$cls" "$val" <<'PY' 2>/dev/null || true
import json, sys, datetime
path, idea, stub, cls, val = sys.argv[1:6]
val = float(val); today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
try: d = json.load(open(path))
except Exception: d = {}
lin = d.get("lineage", []); lin.append({"idea": idea, "config_class": cls, "val": val, "promoted": today})
d.update({"stub": stub, "config_class": cls, "val": val,
          "band": d.get("band", 0.04), "seed": d.get("seed", 42),
          "lineage": lin, "updated": today})
with open(path, "w") as f: json.dump(d, f, indent=2); f.write("\n")
PY
  CHAMPION_STUB="$stub"; CHAMPION_CLASS="$cls"; CHAMPION_VAL="$val"
  log "NEW CHAMPION: $idea @ $val (${cls:-stub:$stub}) — next batch builds on it"
}

flip() {  # respects --dry-run
  if [ "$DRY" = 1 ]; then log "DRY flip $*"; return 0; fi
  # flip.sh prints its "<idea>: <from> -> <to> ... logged" confirmation to STDOUT.
  # claimable()/sync_and_smoke() return their batch via command substitution, so a
  # stray flip line on stdout gets swallowed into the batch and parsed as a garbage
  # "run <idea>: python <to>" job (trailing colon on the slug -> awk can't-open-file
  # flood in finalize). Force it to stderr like log(), so it stays visible in the
  # pane but never pollutes the data stream. See the stdout-discipline note above.
  "$FLIP" "$@" >&2
}

# ── parse one pulled log's Final readout (deterministic — see RUN-CONTRACT.md) ─
# echoes "<val> <train> <acc>"; empty val => run did not finish cleanly
parse_log() {
  local f="$1" val trn acc
  val="$(grep -a 'Final Val Loss:'     "$f" 2>/dev/null | tail -1 | awk '{print $NF}')"
  trn="$(grep -a 'Final Train Loss:'   "$f" 2>/dev/null | tail -1 | awk '{print $NF}')"
  acc="$(grep -a 'Final Val Accuracy:' "$f" 2>/dev/null | tail -1 | awk '{print $NF}')"
  echo "$val $trn $acc"
}

# ── 1. finalize: drain ~/arq/STATUS into verdicts (idempotent) ───────────────
finalize() {
  local status rdir mean band
  status="$(SSH "cat ~/arq/STATUS 2>/dev/null")" || return 0
  [ -n "$status" ] || return 0
  rdir="$(state_get results_dir)"; [ -n "$rdir" ] || rdir="$ROOT/remote-results/$(date -u +%F)-vast-tiny1m3m"
  mean="$(state_get mean)"; band="$(state_get band)"
  mkdir -p "$rdir"

  local measured_ctrls=0 line tag name
  while IFS= read -r line; do
    tag="${line%% *}"; name="$(echo "$line" | awk '{print $2}')"
    name="${name%:}"   # belt-and-suspenders: a legit slug never ends in ':'; a
                       # trailing colon means a stray flip line leaked into the
                       # batch (now fixed at the flip() wrapper) — strip it so an
                       # already-written STATUS line can't flood awk with a bad path
    [ -n "$name" ] || continue
    case "$tag" in
      OK)
        # ctrls feed the baseline; they are not ideas
        if [[ "$name" == ctrl* ]]; then
          local clog="$rdir/${name}_${PORT}.log"
          [ -f "$clog" ] || SCP_FROM "~/arq/logs/$name.log" "$clog" 2>/dev/null || true
          read -r cval ctrn cacc < <(parse_log "$clog")
          [ -n "$cval" ] && results_upsert "$rdir/results.json" "$name" "$cval" "$ctrn" "$cacc" "$(basename "$clog")"
          measured_ctrls=1; continue
        fi
        # a treatment idea: finalize only if still `running` (idempotent)
        [ "$(idea_status "$name")" = "running" ] || continue
        local tlog="$rdir/${name}_${PORT}.log"
        SCP_FROM "~/arq/logs/$name.log" "$tlog" 2>/dev/null || { log "pull failed $name"; continue; }
        read -r val trn acc < <(parse_log "$tlog")
        if [ -z "$val" ]; then
          flip "$name" needs-recode daemon "OK but no Final Val Loss in log — incomplete run"
          continue
        fi
        results_upsert "$rdir/results.json" "$name" "$val" "$trn" "$acc" "$(basename "$tlog")"
        finalize_one "$name" "$val" "$rdir"
        ;;
      FAIL|TIMEOUT)
        [[ "$name" == ctrl* ]] && continue
        [ "$(idea_status "$name")" = "running" ] || continue
        local flog="$rdir/${name}_${PORT}.log"
        SCP_FROM "~/arq/logs/$name.log" "$flog" 2>/dev/null || true
        local cause; cause="$(grep -aiE 'Error|Traceback|OOM|CUDA|assert|NaN' "$flog" 2>/dev/null | tail -1 | cut -c1-160)"
        flip "$name" needs-recode daemon "run FAILED ($tag): ${cause:-see log}"
        ;;
    esac
  done <<<"$status"

  # MEASURE queue just produced fresh ctrls -> (re)write the cache before any
  # later verdict trusts the band. CACHED queue -> advance the staleness counter.
  if [ -f "$rdir/results.json" ]; then
    if [ "$measured_ctrls" = 1 ]; then
      [ "$DRY" = 1 ] || "$BASELINE" measure "$rdir/results.json" || true
    fi
  fi
}

# judge one finished treatment via baseline.sh verdict (mean ± band)
finalize_one() {  # finalize_one <idea> <val> <rdir>
  local idea="$1" val="$2" rdir="$3" out verdict delta mean=0 band=0 _tag=X _key=
  # refresh mean/band from the cache for this box (works for CACHED + post-measure).
  # Defaults above keep `set -u` from tripping if `check` yields fewer fields.
  read -r _tag mean band _key < <("$BASELINE" check "$rdir/results.json" 2>/dev/null || echo "X 0 0 0") || true
  # Guarantee mean/band are bound + numeric no matter what `read` did. `:=` pins a
  # default in place. NOTE: the verdict/flip strings below MUST brace the vars as
  # `${mean}±${band}` — an unbraced `$mean±` lets bash fold the leading byte of the
  # multibyte `±` into the variable name (`mean\xC2`), which set -u then reports as
  # an unbound var and kills the whole finalize loop at the verdict print.
  : "${mean:=0}" "${band:=0}"
  # ── champion is the AUTHORITATIVE bar ────────────────────────────────────
  # Judge against the CURRENT champion's val, not the per-box control mean. When
  # the box_key changes (new rental / commit churn) `check` re-measures a baseline,
  # and if those controls ran the BASE config instead of the champion the per-box
  # mean sits far ABOVE the champion — judging a treatment against THAT falsely
  # promoted 209 (6.2519) over the alibi champion (6.2403, Δ+0.012 = a NULL). When
  # a champion is defined we pin the bar to its val so a WIN must beat the champion,
  # never a stray base measurement. (band stays the noise band; default 0.04.)
  # ── SCREEN band, NOT a promotion band ────────────────────────────────────
  # This verdict is a 1-seed SCREEN whose only outcomes are: NULL (done) or
  # SCREEN-WIN (→ needs-confirm). Since the lucky-seed guard, NOTHING auto-
  # promotes here — every win must clear a PAIRED 3-seed confirm (band 0.018,
  # same-box same-session, drift-free) before becoming champion. So the screen's
  # job is sensitivity (don't lose a real win), and the paired confirm provides
  # the specificity (kill flukes). The old 0.04 (=2σ of CROSS-BOX drift) made the
  # screen so deaf that real +0.01–0.02 stacking wins read NULL and never reached
  # the confirm that would validate them — the lab's core blindness (NOISE-AND-
  # BAND.md). We set the SCREEN gate to ~1σ of within-session noise (0.015) so
  # those wins surface as needs-confirm. Loosening this can only OFFER a candidate
  # for confirmation; it can never promote a fluke (the paired confirm does that).
  # Lowered 0.02 -> 0.015 (operator policy 2026-06-17): 0.02 was wider than the
  # ~0.01-0.015 effect sizes now in play at this saturated tier, so real near-miss
  # wins (e.g. 347 stack-gmlp-mish at Δ-0.0195) read NULL and never reached the
  # confirm. 0.015 ≈ 1σ within-session — sensitive enough to surface them while the
  # paired 3-seed confirm (band 0.001 + 3/3 sign agreement) provides specificity.
  # Override unconditionally: the per-box cache returns band=0.04, which would
  # otherwise win over the default below. Env SCREEN_BAND tunes it.
  if [ -n "$CHAMPION_VAL" ] && awk -v v="$CHAMPION_VAL" 'BEGIN{exit !(v+0>0)}'; then
    mean="$CHAMPION_VAL"
    band="${SCREEN_BAND:-0.015}"
  fi
  # ── leak guard (runs BEFORE the verdict) ─────────────────────────────────
  # A val far below the baseline neighborhood is never a win — it's a broken
  # eval. A treatment that leaks future tokens past the causal mask collapses the
  # loss toward 0 (180-qk-logit-conv: val 0.984 / acc 0.878 vs baseline 6.24,
  # auto-promoted to champion before this guard existed). No legitimate single
  # lever halves the loss at fixed scale/data, so any val below HALF the baseline
  # mean is a suspected leak: reject it, and crucially never promote_champion.
  if awk -v v="$val" -v m="$mean" 'BEGIN{exit !(m>0 && v>0 && v < m*0.5)}'; then
    write_evidence "$idea" LEAK "$val" "0" "$mean" "$band" "$rdir"
    flip "$idea" rejected daemon "LEAK: val=$val implausibly below baseline $mean (likely broken causal mask / label leak) — not a win, not promoted"
    [ "$DRY" = 1 ] || append_closed_leak "$idea" "$val" "$mean"
    log "$idea — LEAK val=$val << baseline $mean (rejected, NOT promoted)"
    return 0
  fi
  # Verdict against the (champion-pinned) mean/band. Computed locally — NOT via
  # `baseline.sh verdict`, which re-reads the per-box cache mean and would undo the
  # champion override above and re-introduce the false-promotion. WIN iff the
  # treatment clears the bar by more than the noise band; NO-BASELINE only when
  # there is genuinely no champion and no cached baseline (mean<=0).
  local verdict delta
  if awk -v m="$mean" 'BEGIN{exit !(m+0>0)}'; then
    delta="$(awk -v v="$val" -v m="$mean" 'BEGIN{printf "%.4f", v-m}')"
    if awk -v v="$val" -v m="$mean" -v b="$band" 'BEGIN{exit !(v+0 < m-b)}'; then verdict="WIN"; else verdict="NULL"; fi
  else
    verdict="NO-BASELINE"; delta="0"
  fi
  case "$verdict" in
    WIN)
      # LUCKY-SEED GUARD: a single-seed screen WIN is NOT promoted. A lone seed
      # that beats the bar is how 180 (leak) and 209 (false win) became champion
      # and poisoned the baseline. It must clear a paired 3-seed confirm against
      # the champion first (same box, same session — see PROMOTION.md /
      # NOISE-AND-BAND.md / 208 confirm-3seed.md). We park it in `needs-confirm`;
      # `autoresearch/bin/confirm_paired.py <idea> <flags>` runs the confirm and
      # only then is it promoted. NOT closed (no closed.md line), NOT promoted here.
      write_evidence "$idea" SCREEN-WIN "$val" "$delta" "$mean" "$band" "$rdir"
      flip "$idea" needs-confirm daemon "SCREEN-WIN (1 seed): trt=$val vs champion ${CHAMPION_CLASS:-base} ${mean}±${band} (Δ$delta) — REQUIRES paired 3-seed confirm before promotion: autoresearch/bin/confirm_paired.py $idea <flags>"
      log "$idea — SCREEN-WIN Δ$delta → needs-confirm (lucky-seed guard; NOT promoted)" ;;
    NULL)
      write_evidence "$idea" NULL "$val" "$delta" "$mean" "$band" "$rdir"
      flip "$idea" done daemon "NULL: trt=$val inside champion ${CHAMPION_CLASS:-base} ${mean}±${band} (Δ$delta)"
      [ "$DRY" = 1 ] || append_closed_null "$idea" "$delta"
      log "$idea — NULL Δ$delta" ;;
    *)
      log "$idea — NO-BASELINE (left running; needs a MEASURE queue first)" ;;
  esac
}

# ── 3a. reclaim dead `running` ideas (queue died, no OK/FAIL) ────────────────
reclaim() {
  local now d idea up age
  now=$(date -u +%s)
  for d in "$IDEAS"/*/; do
    [ -f "$d/idea.md" ] || continue          # skip non-idea dirs (_closed/ etc.)
    idea="$(basename "$d")"
    [ "$(idea_status "$idea")" = "running" ] || continue
    up="$(field "$d/idea.md" updated)"
    age=$(( (now - $(iso_to_epoch "$up")) / 60 ))
    if [ "$age" -ge "$STALE_MIN" ]; then
      log "reclaim $idea (running, stale ${age}m, no live queue)"
      flip "$idea" needs-run daemon "reclaimed: queue died (stale ${age}m)"
    fi
  done
}

# ── 3a½. push local model code so the box's `git pull` actually gets it ──────
# Implementers edit $SYNC_PATHS in the working tree but never push (human-review
# gate), so the box would pull stale code and smoke-FAIL on import. We close that
# gap here: stage only $SYNC_PATHS, py_compile-guard them (never push a syntax
# error), commit if changed, and push the current branch. Best-effort — any
# failure just means the box pulls whatever was last pushed, same as before.
autosync_code() {
  ( cd "$ROOT" || exit 0
    git add -- $SYNC_PATHS 2>/dev/null || exit 0
    git diff --cached --quiet -- $SYNC_PATHS && exit 0   # nothing new to ship
    # syntax-guard: bail (leaving staged) if any staged .py won't compile
    local pyfiles
    pyfiles="$(git diff --cached --name-only -- $SYNC_PATHS | grep '\.py$')"
    if [ -n "$pyfiles" ] && ! python3 -m py_compile $pyfiles 2>/dev/null; then
      log "autosync SKIP: staged model code fails py_compile — not pushing"; exit 0
    fi
    git commit -q -m "daemon: auto-sync model code for box pull [$(date -u +%FT%TZ)]" || exit 0
    git push -q 2>&1 | tail -1 >&2 || log "autosync push warned (continuing)"
    log "autosync: pushed model code $(git rev-parse --short HEAD)"
  ) || true
}

# ── 3b. sync + CPU build-smoke every claimed arq on the box (BATCHED) ────────
# echoes the subset of "<idea> <arq> <to>" lines that passed smoke. The whole
# step is 3 connections regardless of batch size — git pull, one batched scp of
# all stubs, one ssh that smokes them in a remote loop — instead of the old
# 2N+1 (an scp + an ssh PER idea), which is what bursts Vast's ssh throttle.
sync_and_smoke() {
  local batch="$1" pass="" idea arq to
  ensure_master
  local ideas=() arqs=() tos=() srcs=()
  while read -r idea arq to; do
    [ -n "$idea" ] || continue
    ideas+=("$idea"); arqs+=("$arq"); tos+=("$to"); srcs+=("$ROOT/$arq")
  done <<<"$batch"
  [ "${#arqs[@]}" -gt 0 ] || return 0

  autosync_code   # ship implementer-written model code before the box pulls it
  SSH "cd $REMOTE_REPO && git pull --ff-only 2>&1 | tail -1" >&2 || log "git pull warned (continuing)"
  # one batched scp: the smoke helper + every stub, all into the repo root
  SCP_MANY_TO "$TOOL_DIR/_box_smoke.py" "${srcs[@]}" "$REMOTE_REPO/" 2>/dev/null \
    || log "batch scp warned (continuing; missing stubs will smoke-FAIL)"
  # one ssh: smoke every stub remotely, one result line each: "SMOKE <arq> <msg>".
  # SMOKE_* tell _box_smoke.py the repo's trainer + model ctor (from config.json).
  local results
  results="$(SSH "cd $REMOTE_REPO && export PATH=$REMOTE_VENV/bin:\$PATH TORCHDYNAMO_DISABLE=1 \
    SMOKE_TRAINER='$SMOKE_TRAINER' SMOKE_MODEL_IMPORT='$SMOKE_MODEL_IMPORT' SMOKE_MODEL_CTOR='$SMOKE_MODEL_CTOR'
    for a in ${arqs[*]}; do echo \"SMOKE \$a \$(python _box_smoke.py \"\$a\" 2>&1 | tail -1)\"; done")"

  local i line msg
  for i in "${!arqs[@]}"; do
    line="$(printf '%s\n' "$results" | grep -m1 "^SMOKE ${arqs[$i]} ")"
    if printf '%s' "$line" | grep -q SMOKE_OK; then
      pass+="${ideas[$i]} ${arqs[$i]} ${tos[$i]}"$'\n'
    else
      msg="$(printf '%s' "${line:-SMOKE ${arqs[$i]} no smoke output (scp/connection failed)}" | sed "s#^SMOKE ${arqs[$i]} ##" | cut -c1-160)"
      log "smoke FAIL ${ideas[$i]}: $msg"
      flip "${ideas[$i]}" needs-recode daemon "build-smoke failed: $msg"
    fi
  done
  printf '%s' "$pass"
}

# ── 3c. build the guarded queue script and launch it detached ───────────────
launch_queue() {  # launch_queue <smoked-batch> <mode CACHED|MEASURE>
  local batch="$1" mode="$2" rdir maxto="$DEFAULT_TIMEOUT" idea arq to
  rdir="$ROOT/remote-results/$(date -u +%F)-vast-tiny1m3m"
  # pick the largest job_timeout in the batch as the global cap
  while read -r idea arq to; do [ -n "$to" ] && maxto="$to"; done <<<"$batch"

  local qs="/tmp/run_queue.sh"
  {
    echo '#!/usr/bin/env bash'
    echo "export PATH=$REMOTE_VENV/bin:\$PATH"
    echo 'export PYTHONUNBUFFERED=1 TORCHDYNAMO_DISABLE=1'
    echo "cd $REMOTE_REPO || exit 1"
    echo 'mkdir -p ~/arq/logs'
    echo "JOB_TIMEOUT=\"$maxto\""
    cat <<'WRAP'
run () {
  local name="$1"; shift
  echo "START $name $(date -u +%FT%TZ)" >> ~/arq/STATUS
  if timeout "$JOB_TIMEOUT" "$@" > ~/arq/logs/"$name".log 2>&1; then
    echo "OK   $name $(date -u +%FT%TZ)" >> ~/arq/STATUS
  else
    rc=$?
    [ "$rc" = 124 ] && echo "TIMEOUT $name killed after $JOB_TIMEOUT" >> ~/arq/logs/"$name".log
    echo "FAIL $name rc=$rc $(date -u +%FT%TZ)" >> ~/arq/STATUS
  fi
}
WRAP
    if [ "$mode" = "MEASURE" ]; then
      local CTRL
      if [ -n "$CHAMPION_STUB" ]; then
        # The champion IS the baseline — measure it directly (self-contained stub,
        # fixed seed) so the bar equals the champion's loss. Only fires when no
        # pinned baseline exists yet (bootstrap); after that the cache is pinned
        # and a winning run promotes itself, so controls stop running entirely.
        CTRL="python $CHAMPION_STUB"
      else
        # CTRL_CMD is the repo's baseline-control command template from config.json.
        CTRL="${CTRL_CMD//\{config\}/$CTRL_CONFIG}"; CTRL="${CTRL//\{seed\}/42}"; CTRL="${CTRL//\{dataset\}/$DATASET}"
      fi
      echo "run ctrl  $CTRL"
      echo "run ctrl2 $CTRL"
      echo "run ctrl3 $CTRL"
    fi
    while read -r idea arq to; do
      [ -n "$idea" ] || continue
      echo "run $idea python $arq"
    done <<<"$batch"
    echo 'echo "QUEUE_DONE $(date -u +%FT%TZ)" >> ~/arq/STATUS'
  } > "$qs"

  if [ "$DRY" = 1 ]; then log "DRY launch ($mode): $(echo "$batch" | grep -c .) jobs"; cat "$qs"; return 0; fi
  SSH "mkdir -p ~/arq && : > ~/arq/STATUS"
  # MEASURE controls run `python $CHAMPION_STUB`, but sync_and_smoke only ships
  # the *treatment* stubs — ship the champion control stub too, or all 3 ctrls
  # die rc=2 (No such file) and the queue silently falls back to the cached band.
  if [ "$mode" = "MEASURE" ] && [ -n "$CHAMPION_STUB" ]; then
    if [ -f "$ROOT/$CHAMPION_STUB" ]; then
      SCP_TO "$ROOT/$CHAMPION_STUB" "$REMOTE_REPO/$CHAMPION_STUB" 2>/dev/null \
        || log "champion stub scp warned ($CHAMPION_STUB) — ctrls may FAIL"
    else
      log "champion stub $CHAMPION_STUB missing locally — MEASURE ctrls will FAIL"
    fi
  fi
  SCP_TO "$qs" "~/arq/run_queue.sh"
  # ── GPU 1-by-1 HARD GUARD ──────────────────────────────────────────────────
  # Enforce exactly one experiment on the GPU at a time. The has-session check,
  # the GPU-busy check, and the session create all run in ONE remote shell, so
  # there is no cross-network TOCTOU window (the old bare `tmux new-session` had
  # one: arq_live() ran in a prior ssh, and a manual run or a second daemon could
  # slip a process onto the GPU in between → two procs → CUDA OOM collision).
  #   • tmux has-session  : refuse if our queue is already live.
  #   • nvidia-smi        : refuse if ANY compute proc holds the GPU — catches
  #                         stray/manual runs the tmux check can't see.
  #   • tmux new-session  : atomic on the session name, so two daemons racing the
  #                         same tick can't both win `arq`; the loser gets nothing.
  # Fail-closed: unless the GPU is provably idle AND we won the session, we do NOT
  # launch — claimed ideas bounce back to needs-run for a later tick.
  local launch_out
  launch_out="$(SSH "
    if tmux has-session -t $REMOTE_TMUX 2>/dev/null; then echo 'ABORT:arq-already-live'; exit 0; fi
    busy=\$(nvidia-smi --query-compute-apps=pid --format=csv,noheader 2>/dev/null | grep -c .)
    if [ \"\${busy:-0}\" -ne 0 ]; then echo \"ABORT:gpu-busy-\${busy}proc\"; exit 0; fi
    if tmux new-session -d -s $REMOTE_TMUX 'bash ~/arq/run_queue.sh'; then echo 'LAUNCH_OK'; else echo 'ABORT:tmux-create-lost-race'; fi
  ")"
  if [ "$launch_out" != "LAUNCH_OK" ]; then
    log "LAUNCH ABORTED (${launch_out:-no-box-response}) — GPU not provably idle; bouncing treatments back to needs-run"
    while read -r idea arq to; do
      [ -n "$idea" ] && flip "$idea" needs-run daemon "launch aborted: ${launch_out:-box unreachable} — GPU not idle (1-by-1 guard)"
    done <<<"$batch"
    return 1
  fi
  results_init "$rdir"
  # decide + cache the baseline mode/band for this queue, store for finalize
  local chk tag mean band key
  chk="$("$BASELINE" check "$rdir/results.json" 2>/dev/null || echo "MEASURE pending fresh)")"
  tag="${chk%% *}"
  if [ "$tag" = "CACHED" ]; then mean="$(echo "$chk" | awk '{print $2}')"; band="$(echo "$chk" | awk '{print $3}')"; key="$(echo "$chk" | awk '{print $4}')"
  else mean=""; band=""; key=""; fi
  state_write "$rdir" "$mode" "$mean" "$band" "$key"
  log "launched $mode queue: $(echo "$batch" | grep -c .) treatments in detached $REMOTE_TMUX tmux"
}

# ── one full tick ────────────────────────────────────────────────────────────
tick() {
  load_box || { log "skipping tick — no box"; return 0; }
  # Re-read champion.json EVERY tick so a manual promotion (hand-edited
  # champion.json) takes effect without a daemon restart. Without this the
  # daemon caches CHAMPION_VAL from startup forever, so a manual re-pin (e.g.
  # deepnet 6.2539→6.2367) silently keeps judging treatments against the STALE
  # bar — the exact bug that mislabeled 264/267 as NULL against 6.2539.
  load_champion
  # Reachability guard FIRST: a transient ssh blip must be a no-op, never a
  # reason to claim ideas and then bounce them all to needs-recode on failed scp.
  if ! box_reachable; then log "box $HOST:$PORT unreachable — skipping tick (no claims)"; return 0; fi

  mirror_neon pull   # feed any Neon-approved jobs DOWN before we claim (guarded)

  finalize    # always: drain any leftover OK/FAIL into verdicts (idempotent)

  if arq_live; then
    log "queue LIVE — runs in flight; polled + finalized what's done."
    return 0
  fi

  reclaim     # queue is gone: recover any idea stuck `running` with no result

  local batch; batch="$(claimable)"
  if [ -z "$(echo "$batch" | grep -c .)" ] || [ -z "$batch" ]; then
    log "GPU IDLE: no needs-run candidates with a valid run.json — upstream starving"
    return 0
  fi

  # claim the whole set first (lock them as running)
  local idea arq to claimed=""
  while read -r idea arq to; do
    [ -n "$idea" ] || continue
    flip "$idea" running daemon "claimed: queued by daemon"
    claimed+="$idea $arq $to"$'\n'
  done <<<"$batch"

  # sync + smoke (drops + bounces the ones that fail to build)
  local smoked; smoked="$(sync_and_smoke "$claimed")"
  if [ -z "$smoked" ] || [ -z "$(echo "$smoked" | grep -c .)" ]; then
    log "no idea survived build-smoke this tick"; return 0
  fi

  # baseline: does this box need fresh ctrls, or can we run treatment-only?
  local rdir="$ROOT/remote-results/$(date -u +%F)-vast-tiny1m3m"
  results_init "$rdir" 2>/dev/null || true
  local chk tag mode
  chk="$("$BASELINE" check "$rdir/results.json" 2>/dev/null)"; tag="${chk%% *}"
  if [ "$tag" = "CACHED" ]; then mode="CACHED"; else mode="MEASURE"; fi
  # ONE baseline, measured once. When a champion is pinned, NEVER re-measure it:
  # finalize_one judges every treatment against CHAMPION_VAL (one seed) directly,
  # so running 3 controls per queue just burns GPU AND lets `baseline.sh measure`
  # overwrite the pinned champion with a fresh BASE-config control mean (that's how
  # the pin kept reverting to 6.3988). Force treatment-only whenever a champion exists.
  if [ -n "$CHAMPION_VAL" ] && awk -v v="$CHAMPION_VAL" 'BEGIN{exit !(v+0>0)}'; then
    [ "$mode" = "MEASURE" ] && log "champion pinned ($CHAMPION_VAL) — skipping baseline re-measure (treatment-only)"
    mode="CACHED"
  fi
  log "baseline: $chk -> $mode path"

  launch_queue "$smoked" "$mode"
}

# ── entry ────────────────────────────────────────────────────────────────────
# Single-tick lock. flock on Linux; macOS has no flock (the dashboard fires this
# from a Mac), so fall back to an atomic mkdir lock. Without this fallback every
# tick exited at "flock: command not found" on macOS — the daemon never ran and
# its reclaim/multiplexing were dead code. A stale lock (dead PID) is reclaimed
# so a crashed tick can't wedge the drainer.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK"
  if ! flock -n 9; then log "another tick holds the lock — exiting"; exit 0; fi
else
  LOCKD="$LOCK.d"
  if ! mkdir "$LOCKD" 2>/dev/null; then
    opid="$(cat "$LOCKD/pid" 2>/dev/null)"
    if [ -n "$opid" ] && kill -0 "$opid" 2>/dev/null; then
      log "another tick holds the lock (pid $opid) — exiting"; exit 0
    fi
    rm -rf "$LOCKD"; mkdir "$LOCKD" 2>/dev/null || { log "lock race — exiting"; exit 0; }
  fi
  echo "$$" > "$LOCKD/pid"
  trap 'rm -rf "$LOCKD"' EXIT
fi

if [ "$MODE" = "loop" ]; then
  log "loop mode, every ${LOOP_SECS}s (ctrl-c to stop)"
  # Isolate each tick in a subshell: `set -uo pipefail` makes any single unbound
  # var / pipe failure fatal, and without this guard ONE bad tick kills the whole
  # drainer (which then silently stops draining the GPU). The subshell contains
  # the blast radius — a failed tick just logs and the loop carries on next cycle.
  while true; do
    ( tick ) || log "tick failed (rc $?) — continuing next cycle"
    mirror_neon push   # mirror final state UP after every tick (all return paths)
    sleep "$LOOP_SECS"
  done
else
  tick
  mirror_neon push
fi
