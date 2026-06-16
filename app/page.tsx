"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Cpu,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Gauge,
  Lightbulb,
  LoaderCircle,
  Minus,
  Play,
  Plus,
  Power,
  RefreshCw,
  Server,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { MarkdownPanel } from "@/components/markdown-panel";
import AnalyticsView from "@/components/analytics-view";
import DocumentationView from "@/components/documentation-view";
import ResearchRecords, { type RecordsData } from "@/components/research-records";
import HealthBar from "@/components/health-bar";
import MonitorPanel from "@/components/monitor-panel";
import TrackSwitcher from "@/components/track-switcher";
import { IdeaCard } from "@/components/idea-card";

import type {
  View,
  Session,
  Idea,
  GpuInfo,
  GpuUsage,
} from "@/lib/dashboard/types";
import {
  IDEAS_PROMPT_PATH,
  IMPLEMENT_PROMPT_PATH,
  RUN_PROMPT_PATH,
  RUNNER_PROMPT_PATH,
  SETUP_BOX_PROMPT_PATH,
  REMOTE_BOX_PATH,
  IMPLEMENT_SESSION_PREFIX,
  RUN_SESSION_PREFIX,
  GENERATE_SESSION_PREFIX,
  AGENT_OPTIONS,
  GPU_IDLE_UTIL,
  GPU_IDLE_MIN_MS,
  GPU_BUSY_MIN_MS,
  GPU_IDLE_BOX_MIN_MS,
  FINISHED_STATUSES,
} from "@/lib/dashboard/constants";
import { formatAgo, sessionTagMeta } from "@/lib/dashboard/format";

export default function LaunchCodexPage() {
  const [view, setView] = useState<View>("home");
  // Simple vs Advanced UI. Simple hides the manual power-user controls (idea
  // generation form, prompt editor, raw tmux session lists) — when Autoresearch
  // drives the loop you don't need them. Persisted to localStorage; defaults to
  // simple so a fresh/public user gets the focused view. Loaded in an effect to
  // avoid an SSR/hydration mismatch.
  const [uiMode, setUiMode] = useState<"simple" | "advanced">("simple");
  const advanced = uiMode === "advanced";
  useEffect(() => {
    const saved = typeof window !== "undefined" && localStorage.getItem("voidspark-ui-mode");
    if (saved === "advanced" || saved === "simple") setUiMode(saved);
  }, []);
  const toggleUiMode = useCallback(() => {
    setUiMode((m) => {
      const next = m === "simple" ? "advanced" : "simple";
      try { localStorage.setItem("voidspark-ui-mode", next); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const [agent, setAgent] = useState<string>("minimax");
  // Headless = run the agent non-interactively so it exits (and the tmux pane
  // self-closes) when the task finishes. On by default; uncheck to keep the
  // agent open at its REPL so you can attach and watch/intervene.
  const [headless, setHeadless] = useState<boolean>(true);
  // How many ideas the next "Generate Ideas" press asks the agent for — injected
  // into the generate prompt server-side.
  const [ideaCount, setIdeaCount] = useState<number>(10);
  // Autorun: when on, each finished run auto-launches the next queued idea
  // (server-side, via run-done). Mirrors a persisted flag; reflects real state.
  const [autorunOn, setAutorunOn] = useState<boolean>(false);
  const [autorunBusy, setAutorunBusy] = useState<boolean>(false);

  // Autopilot: when on, the app poll ticks /api/orchestrate — it runs the gate
  // orchestrator (reviews/revises/recodes stuck ideas) and refills the idea pool
  // when it drops below the floor. Enabling it also turns on autorun so the GPU
  // queue drains too — one switch runs the whole pipeline.
  const [autopilotOn, setAutopilotOn] = useState<boolean>(false);
  const [autopilotBusy, setAutopilotBusy] = useState<boolean>(false);
  const [autopilotInfo, setAutopilotInfo] = useState<{
    inFlight: number;
    needsRun: number;
    floor: number;
    ceiling: number;
  } | null>(null);
  // MiniMax Token Plan quota (polled from /api/minimax-usage). When the 5-hour
  // interval is exhausted MiniMax 429s and the launcher falls back to Codex —
  // this badge makes that visible and counts down to the reset.
  const [minimaxUsage, setMinimaxUsage] = useState<{
    ok: boolean;
    intervalPercent?: number;
    weeklyPercent?: number;
    exhausted?: boolean;
    intervalResetAt?: number;
    error?: string;
  } | null>(null);
  // Free-text instructions appended to the GPU runner agent's prompt (e.g. a
  // one-off Vast.ai bash command). Persisted server-side via /api/runner-extra.
  const [runnerExtra, setRunnerExtra] = useState<string>("");
  const [runnerExtraSaving, setRunnerExtraSaving] = useState<boolean>(false);
  const [runnerExtraMsg, setRunnerExtraMsg] = useState<string>("");
  // Multi-project: the registered repos and which one is active. Switching
  // re-points every agent/API at that repo (see lib/projects.ts).
  const [projects, setProjects] = useState<{ id: string; name: string; repoPath: string }[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>("");
  // False until the registry fetch resolves, so we don't flash the onboarding
  // card before we know whether any project exists.
  const [projectsLoaded, setProjectsLoaded] = useState<boolean>(false);
  // No project registered yet (fresh clone) — the dashboard shows the onboarding
  // card instead of the ideas/queue sections until the user adds a repo.
  const hasProject = projects.length > 0;
  const [projectSwitching, setProjectSwitching] = useState<boolean>(false);
  // Sidebar "Add repo" form. Hidden by default; the + button opens the native
  // folder picker, then surfaces this form pre-filled.
  const [addRepoOpen, setAddRepoOpen] = useState<boolean>(false);
  const [addRepoPath, setAddRepoPath] = useState<string>("");
  const [addRepoName, setAddRepoName] = useState<string>("");
  const [addRepoBusy, setAddRepoBusy] = useState<boolean>(false);
  const [addRepoPicking, setAddRepoPicking] = useState<boolean>(false);
  const [addRepoError, setAddRepoError] = useState<string>("");
  // Set after adding a repo that has no autoresearch/ folder — the dashboard
  // will be empty (VoidSpark drives only that folder), so we surface a banner
  // offering to scaffold a starter. Holds the repoPath to scaffold.
  const [scaffoldRepo, setScaffoldRepo] = useState<string | null>(null);
  const [scaffoldBusy, setScaffoldBusy] = useState<boolean>(false);
  const [scaffoldMsg, setScaffoldMsg] = useState<string>("");
  // Disconnect (remove) flow. `confirmRemoveId` is set when the user has
  // clicked × on a row and is being asked to confirm; clicking it again (or
  // Cancel) clears it. `removeRepoBusy` is the id currently in flight.
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [removeRepoBusy, setRemoveRepoBusy] = useState<string | null>(null);
  // Auto-implement: when on, Proposed ideas get implemented automatically (up to
  // a parallel cap). Defaults ON — optimistic so the toggle reads "on" before
  // the first state fetch resolves.
  const [autoImplementOn, setAutoImplementOn] = useState<boolean>(true);
  const [autoImplementBusy, setAutoImplementBusy] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateMessage, setGenerateMessage] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [killing, setKilling] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [openFile, setOpenFile] = useState<{ path: string; title: string } | null>(
    null
  );
  // Settings popover (uncommon controls: agent, headless, prompt files).
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  // Wraps the gear button + popover so a click anywhere outside closes it.
  const settingsRef = useRef<HTMLDivElement>(null);
  // GPU box (Vast.ai) connection — paste the SSH command Vast gives you; the
  // server parses host/port/user into the active repo's remote-box.json.
  const [boxSsh, setBoxSsh] = useState<string>("");
  const [boxRepo, setBoxRepo] = useState<string>("");
  const [boxVenv, setBoxVenv] = useState<string>("");
  const [boxShow, setBoxShow] = useState<boolean>(false);
  const [boxBusy, setBoxBusy] = useState<boolean>(false);
  const [boxSetupBusy, setBoxSetupBusy] = useState<boolean>(false);
  const [boxMsg, setBoxMsg] = useState<string>("");
  const [boxConfigured, setBoxConfigured] = useState<{ host: string; port: number | null; user: string } | null>(null);
  const [expandedIdeaGroups, setExpandedIdeaGroups] = useState<Set<string>>(
    () => new Set()
  );
  const [runnerExtraOpen, setRunnerExtraOpen] = useState<boolean>(false);
  const [showAllFinished, setShowAllFinished] = useState<boolean>(false);
  // Record timeline + closed/rejected ledger, derived from closed.md +
  // baseline-cache.json (one fetch, shared by the timeline and the merged
  // "All experiments" section). `expFilter` drives the verdict chips.
  const [recordsApi, setRecordsApi] = useState<RecordsData | null>(null);
  const [expFilter, setExpFilter] = useState<"all" | "win" | "null" | "reject">("all");
  const [gpuQueueExpanded, setGpuQueueExpanded] = useState<boolean>(false);
  // Ids we've already auto-requeued this stale-episode, so the self-healing
  // effect fires once per stuck run (not every tick). Cleared when a run leaves
  // the stale set so a future stall can re-trigger.
  const autoRequeuedRef = useRef<Set<string>>(new Set());
  const [implementing, setImplementing] = useState<string | null>(null);
  const [attaching, setAttaching] = useState<string | null>(null);
  const [ideaActionMsg, setIdeaActionMsg] = useState("");
  const [sessionMsg, setSessionMsg] = useState("");
  const [isRunningNext, setIsRunningNext] = useState(false);
  const [runMessage, setRunMessage] = useState("");
  const [ideaLoadError, setIdeaLoadError] = useState("");
  const [sessionLoadError, setSessionLoadError] = useState("");
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null>(null);
  const [gpuError, setGpuError] = useState("");
  const [gpuLoading, setGpuLoading] = useState(false);
  const [gpuUsage, setGpuUsage] = useState<GpuUsage | null>(null);
  const [gpuUsageStale, setGpuUsageStale] = useState(false);
  // When the last GPU-usage reading landed, and how long that SSH round-trip
  // took — so the UI can show how far behind the compute/VRAM numbers are.
  const [gpuUsageAt, setGpuUsageAt] = useState<number | null>(null);
  const [gpuUsageLatencyMs, setGpuUsageLatencyMs] = useState<number | null>(null);
  // Epoch ms the GPU first went idle (util < GPU_IDLE_UTIL) in the current idle
  // stretch, or null while it's working. Set in the poll, counted up live by the
  // 1s `now` ticker → "idle Ns since last busy". Lets the operator spot a box
  // doing no work, and only resets after a sustained busy period.
  const [gpuIdleSince, setGpuIdleSince] = useState<number | null>(null);
  // Whether the remote training tmux (`arq`) is alive right now — only true
  // while a run is active. Drives the "Attach GPU" button.
  const [arqAlive, setArqAlive] = useState(false);
  // Two queue-activity clocks from /api/health: when something last ENTERED the
  // queue (an implement agent marked it needs-run) and when the daemon last
  // DRAINED a run onto the GPU. Both are absolute epoch ms (or null = never), so
  // the 1s `now` ticker can count them up live.
  const [queueAddedAt, setQueueAddedAt] = useState<number | null>(null);
  const [queueDrainAt, setQueueDrainAt] = useState<number | null>(null);
  // Guards against overlapping usage polls when a request is slow / box is down.
  const usageInFlight = useRef(false);
  // Busy streak start time for debouncing the idle-clock reset.
  const gpuBusySince = useRef<number | null>(null);
  // A 1s ticker so "updated Ns ago" labels stay live between polls.
  const [now, setNow] = useState(() => Date.now());

  // Per-session expandable logs (tmux capture-pane, mirrored to disk).
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [logData, setLogData] = useState<
    Record<string, { text: string; alive: boolean; at: number }>
  >({});
  const logInFlight = useRef<Set<string>>(new Set());
  // One <pre> ref per session name so we can auto-scroll the right log panel
  // when its content updates. Storing in a ref (not state) avoids re-renders
  // when refs are registered/unregistered.
  const logRefs = useRef<Map<string, HTMLPreElement>>(new Map());
  const setLogRef = (name: string) => (el: HTMLPreElement | null) => {
    if (el) logRefs.current.set(name, el);
    else logRefs.current.delete(name);
  };

  const refreshSessions = useCallback(async () => {
    try {
      const response = await fetch("/api/tmux/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(data.sessions)) {
        setSessionLoadError(data.error ?? "Failed to refresh tmux sessions");
        return;
      }
      setSessionLoadError("");
      setSessions(data.sessions);
    } catch {
      setSessionLoadError("Failed to refresh tmux sessions");
    }
  }, []);

  const refreshIdeas = useCallback(async () => {
    try {
      const response = await fetch("/api/ideas/", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(data.ideas)) {
        setIdeaLoadError(data.error ?? "Failed to refresh ideas");
        return;
      }
      setIdeaLoadError("");
      setIdeas(data.ideas);
    } catch {
      setIdeaLoadError("Failed to refresh ideas");
    }
  }, []);

  const refreshRecords = useCallback(async () => {
    try {
      const res = await fetch("/api/research-records/", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!d?.success) return;
      setRecordsApi({
        records: Array.isArray(d.records) ? d.records : [],
        archivedRecords: Array.isArray(d.archivedRecords) ? d.archivedRecords : [],
        closed: Array.isArray(d.closed) ? d.closed : [],
        counts: d.counts ?? {},
        bestVal: d.bestVal ?? null,
        baseline: d.baseline ?? null,
      });
    } catch {
      /* non-fatal — the results sections just stay on their last state */
    }
  }, []);

  // Switching/adding a record track re-points the track-scoped routes (ideas,
  // records, leaderboard), so pull both fresh views right away.
  const onTrackChange = useCallback(() => {
    refreshIdeas();
    refreshRecords();
  }, [refreshIdeas, refreshRecords]);

  const refreshGpu = useCallback(async () => {
    setGpuLoading(true);
    try {
      const response = await fetch("/api/gpu/", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (data.success) {
        setGpuError("");
        setGpuInfo({
          host: data.host ?? "",
          status: data.status ?? "",
          tmuxAlive: Boolean(data.tmuxAlive),
          gpu: data.gpu ?? "",
          logName: data.logName ?? "",
          logTail: data.logTail ?? "",
          sshAttach: data.sshAttach ?? "",
        });
      } else {
        setGpuError(data.error ?? "Failed to reach GPU box");
      }
    } catch {
      setGpuError("Failed to reach GPU box");
    } finally {
      setGpuLoading(false);
    }
  }, []);

  // Lightweight, always-on GPU usage poll (util % + VRAM). Skips when a poll is
  // already in flight so a slow/unreachable box can't stack requests.
  const refreshGpuUsage = useCallback(async () => {
    if (usageInFlight.current) return;
    usageInFlight.current = true;
    const startedAt = Date.now();
    try {
      const response = await fetch("/api/gpu-usage/", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      setGpuUsageLatencyMs(Date.now() - startedAt);
      if (data.success) {
        const fetchedAt = Date.now();
        const util = Number(data.utilization) || 0;
        setGpuUsage({
          name: data.name ?? "",
          utilization: util,
          memUsed: Number(data.memUsed) || 0,
          memTotal: Number(data.memTotal) || 0,
        });
        setGpuUsageStale(false);
        setGpuUsageAt(fetchedAt);
        if (util < GPU_IDLE_UTIL) {
          gpuBusySince.current = null;
          // Open an idle stretch the first poll util drops low; keep the
          // existing start time while still idle.
          setGpuIdleSince((prev) => prev ?? fetchedAt);
        } else {
          const busySince = gpuBusySince.current ?? fetchedAt;
          gpuBusySince.current = busySince;
          // Only clear the idle clock once the GPU has stayed busy long
          // enough to count as a real return to work.
          if (fetchedAt - busySince >= GPU_BUSY_MIN_MS) {
            setGpuIdleSince(null);
            gpuBusySince.current = null;
          }
        }
      } else {
        setGpuUsageStale(true);
      }
      // arqAlive is reported even when there's no GPU reading.
      setArqAlive(Boolean(data.arqAlive));
    } catch {
      setGpuUsageStale(true);
    } finally {
      usageInFlight.current = false;
    }
  }, []);

  // Fetch (and persist) one session's tmux log. Mirrors capture-pane to disk so
  // it survives the session ending. Skips if a fetch for this name is in flight.
  const fetchLog = useCallback(async (name: string) => {
    if (logInFlight.current.has(name)) return;
    logInFlight.current.add(name);
    try {
      const response = await fetch("/api/tmux-log/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json().catch(() => ({}));
      if (data.success) {
        setLogData((prev) => ({
          ...prev,
          [name]: { text: data.text ?? "", alive: Boolean(data.alive), at: Date.now() },
        }));
      }
    } catch {
      /* leave the last-known log in place */
    } finally {
      logInFlight.current.delete(name);
    }
  }, []);

  const toggleLog = useCallback(
    (name: string) => {
      setExpandedLogs((prev) => {
        const next = new Set(prev);
        if (next.has(name)) {
          next.delete(name);
        } else {
          next.add(name);
          fetchLog(name); // fetch immediately on expand
        }
        return next;
      });
    },
    [fetchLog]
  );

  const toggleIdeaGroup = useCallback((key: string) => {
    setExpandedIdeaGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    refreshSessions();
    refreshIdeas();
    refreshRecords();
    const interval = setInterval(() => {
      refreshSessions();
      refreshIdeas();
      refreshRecords();
    }, 5000);
    return () => clearInterval(interval);
  }, [refreshSessions, refreshIdeas, refreshRecords]);

  // Autorun: a bodyless POST reports state AND drives one tick — it re-invokes
  // the single lab-autorun runner agent (which drains the whole needs-run queue
  // on the box) whenever autorun is on, no runner is alive, and there's work.
  // Poll on load + every 5s so the queue keeps draining without a click.
  useEffect(() => {
    const tick = () => {
      fetch("/api/autorun/", { method: "POST" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d && typeof d.enabled === "boolean") setAutorunOn(d.enabled);
        })
        .catch(() => {
          /* default off */
        });
    };
    tick();
    const interval = setInterval(tick, 5000);
    return () => clearInterval(interval);
  }, []);

  // Autopilot: a bodyless POST reports state AND drives one orchestrator tick
  // when it's on (reclaim stale locks, fan out gate workers, refill when low).
  // Slower cadence (20s) than autorun — each tick may spawn cmf workers and
  // orchestrate.sh is heavier; it self-guards against stacking duplicates.
  useEffect(() => {
    const tick = () => {
      fetch("/api/orchestrate/", { method: "POST" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d || typeof d.enabled !== "boolean") return;
          setAutopilotOn(d.enabled);
          setAutopilotInfo({
            inFlight: d.inFlight ?? 0,
            needsRun: d.needsRun ?? 0,
            floor: d.floor ?? 5,
            ceiling: d.ceiling ?? 20,
          });
        })
        .catch(() => {
          /* default off */
        });
    };
    tick();
    const interval = setInterval(tick, 20000);
    return () => clearInterval(interval);
  }, []);

  // Load the persisted runner extra-instructions once on mount.
  useEffect(() => {
    fetch("/api/runner-extra/", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.text === "string") setRunnerExtra(d.text);
      })
      .catch(() => {
        /* leave empty */
      });
  }, []);

  // Load the project registry + active project once on mount.
  useEffect(() => {
    fetch("/api/projects/", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.projects)) setProjects(d.projects);
        if (d && typeof d.activeId === "string") setActiveProjectId(d.activeId);
      })
      .catch(() => {
        /* no registry */
      })
      .finally(() => setProjectsLoaded(true));
  }, []);

  // Auto-implement: a bodyless POST reports state AND drives one tick (launches
  // implements for Proposed ideas up to the cap). Call it on load and every 5s
  // so freshly-generated ideas get picked up without a click. The server-side
  // implement-done chain keeps it going when the tab is closed.
  useEffect(() => {
    const tick = () => {
      fetch("/api/auto-implement/", { method: "POST" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d && typeof d.enabled === "boolean") setAutoImplementOn(d.enabled);
        })
        .catch(() => {
          /* leave the optimistic state; next tick retries */
        });
    };
    tick();
    const interval = setInterval(tick, 5000);
    return () => clearInterval(interval);
  }, []);

  // Poll the two queue clocks from /api/health (read-only, never ticks the
  // pipeline). The route returns ages relative to its own `now`; convert to
  // absolute epochs here once so the 1s ticker counts them up smoothly.
  useEffect(() => {
    const tick = () => {
      fetch("/api/health/")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d?.queue) return;
          const at = Date.now();
          setQueueAddedAt(
            typeof d.queue.lastAddedMs === "number" ? at - d.queue.lastAddedMs : null
          );
          setQueueDrainAt(
            typeof d.queue.lastDrainMs === "number" ? at - d.queue.lastDrainMs : null
          );
        })
        .catch(() => {
          /* keep last known clocks; next tick retries */
        });
    };
    tick();
    const interval = setInterval(tick, 5000);
    return () => clearInterval(interval);
  }, []);

  // Poll GPU usage every 4s, but pause while the tab is hidden so we don't SSH
  // the box in the background for a page nobody is looking at.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval) return;
      refreshGpuUsage();
      interval = setInterval(refreshGpuUsage, 4000);
    };
    const stop = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshGpuUsage]);

  // Poll MiniMax token-plan quota every 60s (cheap remote call; the window only
  // moves on a 5-hour cadence so high frequency is pointless). Pauses when the
  // tab is hidden.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      try {
        const res = await fetch("/api/minimax-usage/", { cache: "no-store" });
        setMinimaxUsage(await res.json());
      } catch {
        /* transient — keep last value */
      }
    };
    const start = () => {
      if (interval) return;
      tick();
      interval = setInterval(tick, 60000);
    };
    const stop = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Whether this machine has a working MiniMax subscription. `minimaxUsage` is
  // null until the first poll returns, so we only treat MiniMax as *absent* once
  // we have a definitive { ok:false } answer — that keeps subscribers from
  // briefly losing the MiniMax option on load.
  const hasMinimax = minimaxUsage?.ok === true;
  const minimaxKnownAbsent = minimaxUsage != null && minimaxUsage.ok === false;
  // Runner choices offered in Settings — MiniMax only when it's actually usable.
  const agentOptions = hasMinimax
    ? AGENT_OPTIONS
    : AGENT_OPTIONS.filter((o) => o.id !== "minimax");

  // No MiniMax subscription → drop it as a runner choice and switch the active
  // agent off it (the default) so the user never picks an agent they can't run.
  useEffect(() => {
    if (minimaxKnownAbsent && agent === "minimax") setAgent("codex");
  }, [minimaxKnownAbsent, agent]);

  // Close the settings popover on any click/tap outside it (and on Escape).
  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [settingsOpen]);

  // 1s ticker so "updated Ns ago" labels count up between polls. Pauses with
  // the tab hidden. Cheap: just bumps a timestamp.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!interval) interval = setInterval(() => setNow(Date.now()), 1000);
    };
    const stop = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Refresh every expanded session log every 3s while the tab is visible.
  useEffect(() => {
    if (expandedLogs.size === 0) return;
    const tick = () => {
      if (document.hidden) return;
      expandedLogs.forEach((name) => fetchLog(name));
    };
    const interval = setInterval(tick, 3000);
    return () => clearInterval(interval);
  }, [expandedLogs, fetchLog]);

  // Auto-scroll each expanded log panel to its tail on every content update
  // — but only when the user is already near the bottom (≤32px gap). If they
  // scrolled up to read older lines, we leave them alone so we don't yank
  // them away mid-read. Manual scroll back to the bottom re-arms the follow.
  useEffect(() => {
    for (const name of expandedLogs) {
      const el = logRefs.current.get(name);
      if (!el) continue;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distanceFromBottom <= 32) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [logData, expandedLogs]);

  // While an idea is marked `running`, poll the GPU box so the panel stays live.
  // When nothing is running we don't SSH on a timer — refresh on demand instead.
  const hasRunningIdea = ideas.some((idea) => idea.status === "running");
  useEffect(() => {
    if (!hasRunningIdea) return;
    refreshGpu();
    const interval = setInterval(refreshGpu, 10000);
    return () => clearInterval(interval);
  }, [hasRunningIdea, refreshGpu]);

  // Auto-dismiss the "Generating ideas in tmux session …" toast after a few
  // seconds so the page doesn't keep showing a stale success message. Errors
  // use the same state but deserve a longer dwell — fall back to the
  // success timeout when the message is short, give errors more time.
  useEffect(() => {
    if (!generateMessage) return;
    const isError = generateMessage.startsWith("✗");
    const ttl = isError ? 8_000 : 4_000;
    const timer = setTimeout(() => setGenerateMessage(""), ttl);
    return () => clearTimeout(timer);
  }, [generateMessage]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsGenerating(true);
    setGenerateMessage("");

    try {
      const response = await fetch("/api/generate-ideas/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, headless, count: ideaCount }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok && data.success) {
        setGenerateMessage(`✓ Generating ideas in tmux session ${data.session}`);
      } else {
        setGenerateMessage(
          `✗ Failed to generate ideas: ${data.error ?? "unknown error"}`
        );
      }
    } catch {
      setGenerateMessage("✗ Error generating ideas");
    } finally {
      setIsGenerating(false);
      refreshSessions();
    }
  };

  const handleKill = async (name: string) => {
    setKilling(name);
    try {
      const response = await fetch("/api/tmux/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kill", name }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success && Array.isArray(data.sessions)) {
        setSessions(data.sessions);
      } else {
        await refreshSessions();
      }
    } catch {
      await refreshSessions();
    } finally {
      setKilling(null);
    }
  };

  const handleImplement = async (slug: string) => {
    setImplementing(slug);
    setIdeaActionMsg("");
    try {
      const response = await fetch("/api/implement-idea/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, agent, headless }),
      });
      const data = await response.json().catch(() => ({}));
      setIdeaActionMsg(
        response.ok && data.success
          ? `✓ Implementing ${slug} (session ${data.session})`
          : `✗ Failed to implement ${slug}: ${data.error ?? "unknown error"}`
      );
    } catch {
      setIdeaActionMsg("✗ Error launching implementation");
    } finally {
      setImplementing(null);
      refreshSessions();
      refreshIdeas();
    }
  };

  // Flip autorun on/off. Enabling also kicks the first run server-side (and we
  // pass the selected agent so the whole chain uses it).
  // --- Auto subsystems -------------------------------------------------------
  // Each apply* sets ONE subsystem to an explicit enabled value (not a toggle)
  // and returns the server-confirmed state, so both the individual buttons and
  // the master "Autoresearch" switch can drive them.
  const applyAutorun = async (next: boolean): Promise<boolean | null> => {
    setAutorunBusy(true);
    try {
      const response = await fetch("/api/autorun/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next, agent, headless }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && typeof data.enabled === "boolean") {
        setAutorunOn(data.enabled);
        return data.enabled;
      }
    } catch {
      setRunMessage("Failed to toggle autorun");
    } finally {
      setAutorunBusy(false);
    }
    return null;
  };

  const applyAutopilot = async (next: boolean): Promise<boolean | null> => {
    setAutopilotBusy(true);
    try {
      const response = await fetch("/api/orchestrate/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next, agent }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && typeof data.enabled === "boolean") {
        setAutopilotOn(data.enabled);
        return data.enabled;
      }
    } catch {
      setRunMessage("Failed to toggle autopilot");
    } finally {
      setAutopilotBusy(false);
    }
    return null;
  };

  const applyAutoImplement = async (next: boolean): Promise<boolean | null> => {
    setAutoImplementBusy(true);
    setAutoImplementOn(next); // optimistic
    try {
      const response = await fetch("/api/auto-implement/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next, agent }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && typeof data.enabled === "boolean") {
        setAutoImplementOn(data.enabled);
        return data.enabled;
      }
    } catch {
      setAutoImplementOn(!next); // revert on failure
    } finally {
      setAutoImplementBusy(false);
    }
    return null;
  };

  const handleToggleAutorun = async () => {
    const enabled = await applyAutorun(!autorunOn);
    if (enabled !== null) {
      setRunMessage(
        enabled
          ? "Autorun on — finished runs auto-launch the next queued idea."
          : "Autorun off."
      );
    }
    refreshSessions();
    refreshIdeas();
  };

  // Flip autopilot on/off. Enabling drives the gate pipeline AND turns on autorun
  // so the GPU queue drains too — one switch runs the whole loop end to end.
  const handleToggleAutopilot = async () => {
    const enabled = await applyAutopilot(!autopilotOn);
    if (enabled !== null) {
      setRunMessage(
        enabled
          ? "Autopilot on — pipeline self-runs: gates advance, ideas refill, GPU drains."
          : "Autopilot off."
      );
      // Keep the GPU side in lockstep: enabling autopilot enables autorun.
      if (enabled && !autorunOn) await applyAutorun(true);
    }
    refreshSessions();
    refreshIdeas();
  };

  // Master switch. "Autoresearch" = the whole loop (ideas → implement → gates →
  // GPU). Flips all three subsystems together; when on, the individual toggles
  // are hidden in the UI and only this one shows.
  const handleToggleAutoresearch = async () => {
    const next = !(autopilotOn && autorunOn && autoImplementOn);
    await Promise.all([
      applyAutopilot(next),
      applyAutorun(next),
      applyAutoImplement(next),
    ]);
    setRunMessage(
      next
        ? "Autoresearch on — the full loop self-runs end to end."
        : "Autoresearch off — control each part individually."
    );
    refreshSessions();
    refreshIdeas();
  };

  // Switch the active project. Every API route resolves the active repo per
  // request, so after switching we just re-pull the project-scoped state.
  const handleSwitchProject = async (id: string) => {
    if (id === activeProjectId || projectSwitching) return;
    setProjectSwitching(true);
    try {
      const response = await fetch("/api/projects/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeId: id }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && typeof data.activeId === "string") {
        setActiveProjectId(data.activeId);
        if (Array.isArray(data.projects)) setProjects(data.projects);
        // Re-pull everything that is per-project.
        refreshIdeas();
        refreshSessions();
        fetch("/api/runner-extra/", { method: "POST" })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (d && typeof d.text === "string") setRunnerExtra(d.text);
          })
          .catch(() => {});
      }
    } catch {
      /* ignore */
    } finally {
      setProjectSwitching(false);
    }
  };

  // Open the OS native folder picker. On confirm, returns the absolute path
  // and pre-fills the form. On cancel, does nothing. On no-GUI / spawn
  // failure, surfaces a clear message so the user knows to paste a path.
  const handlePickFolder = async () => {
    if (addRepoPicking) return;
    setAddRepoPicking(true);
    setAddRepoError("");
    try {
      const response = await fetch("/api/projects/pick", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (data?.canceled) return; // user closed the dialog — silent
      if (!response.ok || !data?.success || typeof data.path !== "string") {
        setAddRepoError(
          data?.error
            ? `Native picker unavailable: ${data.error}`
            : "Native picker unavailable — paste the path manually."
        );
        setAddRepoOpen(true);
        return;
      }
      setAddRepoPath(data.path);
      setAddRepoOpen(true);
    } catch {
      setAddRepoError("Couldn't reach the picker — is the dev server running?");
      setAddRepoOpen(true);
    } finally {
      setAddRepoPicking(false);
    }
  };

  // Load the current GPU box connection whenever the Settings popover opens, so
  // the field reflects what's in the active repo's remote-box.json.
  useEffect(() => {
    if (!settingsOpen || !hasProject) return;
    let alive = true;
    fetch("/api/remote-box/")
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !d?.ok) return;
        setBoxSsh(d.ssh ?? "");
        setBoxRepo(d.remote_repo ?? "");
        setBoxVenv(d.remote_venv ?? "");
        setBoxConfigured(
          d.configured ? { host: d.host, port: d.port, user: d.user } : null
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [settingsOpen, hasProject]);

  // Parse + persist the pasted Vast.ai SSH command into remote-box.json.
  const handleSaveBox = async () => {
    if (boxBusy || !boxSsh.trim()) return;
    setBoxBusy(true);
    setBoxMsg("");
    try {
      const response = await fetch("/api/remote-box/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssh: boxSsh.trim(), remote_repo: boxRepo.trim(), remote_venv: boxVenv.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!data?.ok) {
        setBoxMsg(data?.error ?? "Couldn't save the GPU box.");
        setBoxConfigured(null);
        return;
      }
      setBoxConfigured({ host: data.host, port: data.port, user: data.user });
      setBoxMsg(`Saved · ${data.user}@${data.host}:${data.port}`);
    } catch {
      setBoxMsg("Network error — is the dev server running?");
    } finally {
      setBoxBusy(false);
    }
  };

  // Launch a local agent (tmux) that SSHes into the saved box and sets it up:
  // clones this project's GitHub repo, reads the repo's instructions, builds the
  // venv + installs deps, and smoke-tests a run. Saves the box first so the
  // freshest pasted SSH command is what the agent connects to.
  const handleSetupBox = async () => {
    if (boxSetupBusy || boxBusy) return;
    setBoxSetupBusy(true);
    setBoxMsg("");
    try {
      // Persist the current SSH command first, so the agent targets it.
      if (boxSsh.trim()) await handleSaveBox();
      const response = await fetch("/api/setup-box/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, headless }),
      });
      const data = await response.json().catch(() => ({}));
      if (!data?.success) {
        setBoxMsg(data?.error ?? "Couldn't launch the setup agent.");
        return;
      }
      setBoxMsg(`Setup agent launched → tmux ${data.session}`);
    } catch {
      setBoxMsg("Network error — is the dev server running?");
    } finally {
      setBoxSetupBusy(false);
    }
  };

  // Register a new repo folder from the sidebar. Validates server-side (path
  // exists, is a directory, not already registered) then auto-activates the new
  // entry so the loop points at it immediately.
  const handleAddProject = async () => {
    if (addRepoBusy) return;
    const name = addRepoName.trim() || addRepoPath.split("/").filter(Boolean).pop() || "new-repo";
    setAddRepoBusy(true);
    setAddRepoError("");
    try {
      const response = await fetch("/api/projects/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ add: { name, repoPath: addRepoPath.trim() } }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        const code = data?.error as string | undefined;
        const msg =
          code === "path-not-found"
            ? "That folder doesn't exist on disk."
            : code === "path-not-directory"
            ? "That path is a file, not a folder."
            : code === "invalid-path"
            ? "Enter an absolute path to a folder."
            : code === "invalid-name"
            ? "Give the project a name."
            : "Couldn't add that project.";
        setAddRepoError(msg);
        return;
      }
      if (Array.isArray(data.projects)) setProjects(data.projects);
      // The repo was added but has no autoresearch/ folder — warn + offer to
      // scaffold one, otherwise the dashboard looks empty (and the user thinks
      // their data vanished).
      if (data.warning === "no-autoresearch") {
        setScaffoldRepo(addRepoPath.trim());
        setScaffoldMsg("");
      }
      // Auto-activate the new entry so the loop points at it immediately.
      // Fire-and-forget: the project list already shows a `projectSwitching`
      // spinner for the per-project API repulls, so closing the form here is
      // the right UX — we don't want the "Adding…" state to be gated on a slow
      // switch (e.g. first-hit route compile on the new repo in Next.js dev).
      const added = (data as { added?: { id: string } }).added;
      if (added?.id) {
        void handleSwitchProject(added.id);
      }
      // Reset the form.
      setAddRepoPath("");
      setAddRepoName("");
      setAddRepoOpen(false);
    } catch {
      setAddRepoError("Network error — is the dev server running?");
    } finally {
      setAddRepoBusy(false);
    }
  };

  // Copy the starter autoresearch/ template into the just-added repo so the loop
  // has something to drive. Called from the no-autoresearch warning banner.
  const handleScaffold = async () => {
    if (!scaffoldRepo || scaffoldBusy) return;
    setScaffoldBusy(true);
    setScaffoldMsg("");
    try {
      const response = await fetch("/api/projects/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scaffold: { repoPath: scaffoldRepo } }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        setScaffoldMsg(`✗ ${data?.error ?? "Couldn't scaffold autoresearch/."}`);
        return;
      }
      setScaffoldMsg("✓ Created autoresearch/ — now fill in autoresearch/config.json, then generate ideas.");
      setScaffoldRepo(null);
      refreshIdeas();
    } catch {
      setScaffoldMsg("✗ Network error while scaffolding.");
    } finally {
      setScaffoldBusy(false);
    }
  };

  // Disconnect (remove) a project from the registry. This is purely a
  // VoidSpark-side edit — the target repo's ideas, flags, and code are
  // untouched, so re-adding the same path later picks up where it left off.
  // If the removed project was active, the server picks a new active one and
  // the client re-pulls per-project state to match.
  const handleRemoveProject = async (id: string) => {
    if (removeRepoBusy) return;
    setRemoveRepoBusy(id);
    try {
      const response = await fetch("/api/projects/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remove: { id } }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        // unknown id or network — leave the row in place so the user can retry
        return;
      }
      if (Array.isArray(data.projects)) setProjects(data.projects);
      const newActive = data.activeId as string | undefined;
      if (newActive && newActive !== activeProjectId) {
        // Server already changed the active pointer; resync client + repull
        // everything that is per-project.
        setActiveProjectId(newActive);
        refreshIdeas();
        refreshSessions();
        fetch("/api/runner-extra/", { method: "POST" })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (d && typeof d.text === "string") setRunnerExtra(d.text);
          })
          .catch(() => {});
      }
      setConfirmRemoveId(null);
    } catch {
      /* network — leave the row in place */
    } finally {
      setRemoveRepoBusy(null);
    }
  };

  // Save the runner extra-instructions. Applies to the NEXT runner launch
  // (autorun tick or manual "Run next") — not a run already in flight.
  const handleSaveRunnerExtra = async () => {
    setRunnerExtraSaving(true);
    setRunnerExtraMsg("");
    try {
      const response = await fetch("/api/runner-extra/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: runnerExtra }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && typeof data.text === "string") {
        setRunnerExtra(data.text);
        setRunnerExtraMsg(
          data.text ? "Saved — appended to the next runner launch." : "Cleared."
        );
      } else {
        setRunnerExtraMsg("Save failed.");
      }
    } catch {
      setRunnerExtraMsg("Save failed.");
    } finally {
      setRunnerExtraSaving(false);
    }
  };

  // Flip auto-implement on/off. The toggle response also carries the running
  // state back; enabling drives an immediate tick server-side.
  const handleToggleAutoImplement = async () => {
    await applyAutoImplement(!autoImplementOn);
    refreshSessions();
    refreshIdeas();
  };

  // Autoresearch is "on" only when every subsystem is on; busy if any is mid-flip.
  const autoresearchOn = autopilotOn && autorunOn && autoImplementOn;
  const autoresearchBusy = autopilotBusy || autorunBusy || autoImplementBusy;

  const handleRunNext = async () => {
    setIsRunningNext(true);
    setRunMessage("");
    try {
      const response = await fetch("/api/run-next/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, headless }),
      });
      const data = await response.json().catch(() => ({}));
      setRunMessage(
        response.ok && data.success
          ? `Running ${data.slug} (session ${data.session})`
          : `Run next blocked: ${data.error ?? "unknown error"}`
      );
    } catch {
      setRunMessage("Error launching GPU run");
    } finally {
      setIsRunningNext(false);
      refreshSessions();
      refreshIdeas();
    }
  };

  const handleReset = async (
    slug: string,
    status = "needs-taste",
    note = "reset stuck idea from UI"
  ) => {
    setImplementing(slug);
    setIdeaActionMsg("");
    try {
      const response = await fetch("/api/flip/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          status,
          note,
        }),
      });
      const data = await response.json().catch(() => ({}));
      setIdeaActionMsg(
        response.ok && data.success
          ? `Reset ${slug} -> ${status}`
          : `✗ Failed to reset ${slug}: ${data.error ?? "unknown error"}`
      );
    } catch {
      setIdeaActionMsg("✗ Error resetting idea");
    } finally {
      setImplementing(null);
      refreshIdeas();
    }
  };

  const handleAttach = async (name: string) => {
    setAttaching(name);
    setSessionMsg("");
    try {
      const response = await fetch("/api/attach/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json().catch(() => ({}));
      if (!(response.ok && data.success)) {
        setSessionMsg(`✗ Attach failed: ${data.error ?? "unknown error"}`);
      }
    } catch {
      setSessionMsg("✗ Error attaching");
    } finally {
      setAttaching(null);
    }
  };

  // Open a Terminal SSH'd straight into the remote GPU tmux (`arq`).
  const handleAttachGpu = async () => {
    setAttaching("__gpu__");
    setGpuError("");
    try {
      const response = await fetch("/api/attach/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remote: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!(response.ok && data.success)) {
        setGpuError(`Attach GPU failed: ${data.error ?? "unknown error"}`);
      }
    } catch {
      setGpuError("Error attaching to GPU tmux");
    } finally {
      setAttaching(null);
    }
  };

  // "How long it's been in this state" — measured from the idea's last status
  // flip (idea.updated, written by flip.sh). `now` ticks every 1s, so the label
  // counts up live between the 5s polls. Returns null for an unparseable stamp.
  const timeInState = (iso: string): string | null => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? formatAgo(now - t) : null;
  };

  // The same flip moment as a wall-clock time in the viewer's LOCAL timezone
  // (toLocaleTimeString defaults to the browser's zone). Used for the hover
  // tooltip on the elapsed-time labels, so "32m" also tells you it started at
  // "3:42:10 AM your time".
  const localTime = (iso: string): string => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? new Date(t).toLocaleTimeString() : "";
  };

  // Join: which ideas have a live implement/run session right now.
  const liveSessions = new Set(sessions.map((s) => s.name));
  const queuedIdeas = ideas
    .filter((idea) => idea.status === "needs-run")
    .sort((a, b) => (a.updated || a.id).localeCompare(b.updated || b.id));
  const runningIdeas = ideas
    .filter((idea) => idea.status === "running")
    .sort((a, b) => (a.updated || a.id).localeCompare(b.updated || b.id));
  const gpuQueue = [...runningIdeas, ...queuedIdeas];
  const gpuBusy = runningIdeas.length > 0;
  const currentLogSlug = gpuInfo?.logName?.replace(/\.log$/, "") ?? "";
  const currentRunIdea =
    runningIdeas.find((idea) => idea.id === currentLogSlug) ??
    runningIdeas[0] ??
    null;
  const staleRunningIdeas = runningIdeas.filter((idea) => {
    const sessionName = RUN_SESSION_PREFIX + idea.id;
    // A run is in flight if EITHER a local per-idea supervisor session is alive
    // (the old one-tmux-per-run model) OR the remote arq batch is alive. The
    // daemon runs a whole BATCH inside a single `arq` tmux and trains the ideas
    // one at a time, so only one is "current" while the rest sit queued — but
    // they are NOT stale. Treating non-current batch members as dead was yanking
    // live runs back to `needs-run` (the "0 running while the GPU is busy" bug).
    return !liveSessions.has(sessionName) && !arqAlive;
  });

  // Self-healing: an idea marked `running` with no live supervisor and no remote
  // arq is a dead marker — flip it back to `needs-run` automatically so the
  // queue recovers without a button. Guards against false positives: a run must
  // have been "running" for >90s (so a just-launched run whose supervisor/arq
  // haven't registered yet isn't yanked), and each id is requeued at most once
  // per stale episode. Runs on the 1s `now` tick; the body is cheap and no-ops
  // when nothing qualifies. Page-open only, which is fine — staleness is a local
  // UI/session signal, and the server-side autorun chain handles the rest.
  useEffect(() => {
    const staleIds = new Set(staleRunningIdeas.map((i) => i.id));
    // Forget ids that recovered, so a future stall can re-trigger.
    autoRequeuedRef.current.forEach((id) => {
      if (!staleIds.has(id)) autoRequeuedRef.current.delete(id);
    });
    const ripe = staleRunningIdeas.filter((idea) => {
      const t = Date.parse(idea.updated);
      return (
        Number.isFinite(t) &&
        Date.now() - t > 90_000 &&
        !autoRequeuedRef.current.has(idea.id)
      );
    });
    if (ripe.length === 0) return;
    ripe.forEach((idea) => {
      autoRequeuedRef.current.add(idea.id);
      fetch("/api/flip/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: idea.id,
          status: "needs-run",
          note: "auto-requeued stale GPU run (no live supervisor)",
        }),
      })
        .then(() => refreshIdeas())
        .catch(() => {
          autoRequeuedRef.current.delete(idea.id); // allow a retry next tick
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  const compactGpuQueue = [
    ...(currentRunIdea ? [currentRunIdea] : []),
    ...queuedIdeas.slice(0, 3),
  ].filter(
    (idea, idx, arr) => arr.findIndex((candidate) => candidate.id === idea.id) === idx
  );
  const visibleGpuQueue = gpuQueueExpanded ? gpuQueue : compactGpuQueue;

  // Group ideas into clear buckets instead of one scattered list. needs-run /
  // running live in the GPU section below, and finished experiments get their
  // own section at the very bottom — so the Ideas section only shows pre-GPU
  // work, grouped by where it is in the pipeline.
  const byStatus = (...statuses: string[]) =>
    ideas
      .filter((i) => statuses.includes(i.status))
      .sort((a, b) => (a.updated || a.id).localeCompare(b.updated || b.id));
  // Keep brand-new implementation separate from failed-run bug-fixing — they
  // look identical otherwise but mean very different things ("building the idea"
  // vs "a GPU run broke and we're debugging it"). The fixing group gets an
  // orange tone so recovery work is visually obvious.
  // The code-implementer reuses the `implementing` status when it CLAIMS a
  // failed (`needs-recode`) idea, so a fresh build and a post-failure retry look
  // identical by status alone. The tell: a retry already carries a prior A/B
  // result (the run that failed). Route those to "Fixing failed runs" so a brand
  // new idea is never shown next to a stale FAILED number.
  const isRetry = (i: Idea) => i.status === "implementing" && i.result != null;
  const fixingIdeas = ideas
    .filter((i) => i.status === "needs-recode" || i.status === "recoding" || isRetry(i))
    .sort((a, b) => (a.updated || a.id).localeCompare(b.updated || b.id));
  const ideaGroups: { key: string; label: string; ideas: Idea[]; tone?: "warn" }[] = [
    { key: "proposed", label: "Proposed", ideas: byStatus("needs-taste") },
    {
      key: "implementing",
      label: "Implementing new ideas",
      ideas: byStatus("implementing").filter((i) => !isRetry(i)),
    },
    { key: "fixing", label: "Fixing failed runs", ideas: fixingIdeas, tone: "warn" },
    { key: "review", label: "In review", ideas: byStatus("needs-review") },
  ];
  // Anything not finished, not on the GPU, and not in a named bucket above —
  // so a new/unexpected status never silently disappears.
  const bucketed = new Set([
    "needs-taste",
    "implementing",
    "needs-recode",
    "recoding",
    "needs-review",
    "needs-run",
    "running",
  ]);
  const otherIdeas = ideas.filter(
    (i) => !FINISHED_STATUSES.has(i.status) && !bucketed.has(i.status)
  );
  if (otherIdeas.length > 0) {
    ideaGroups.push({ key: "other", label: "Other", ideas: otherIdeas });
  }
  const activeIdeaCount = ideaGroups.reduce((n, g) => n + g.ideas.length, 0);
  const finishedIdeas = ideas
    .filter((i) => FINISHED_STATUSES.has(i.status))
    .sort((a, b) => (b.updated || b.id).localeCompare(a.updated || a.id));

  // ---- Merged "All experiments" ledger (was Finished + Closed/failed) --------
  // One section, two data sources, deduped by slug:
  //   • ran ideas (finishedIdeas) → rich cards with the verdict + deltas
  //   • closed.md entries with no ran card → compact rows (archived/never-ran)
  // Buckets: win (beat baseline), null (no change / diverged), reject (killed
  // on paper). A ran card always wins over its closed.md row for the same slug.
  const ideaBucket = (i: Idea): "win" | "null" =>
    i.result?.verdict?.toUpperCase() === "WIN" ? "win" : "null";
  const closedBucket = (v: string): "null" | "reject" =>
    v === "reject" || v === "taste-reject" ? "reject" : "null";
  const finishedSlugs = new Set(finishedIdeas.map((i) => i.id));
  const extraClosed = (recordsApi?.closed ?? [])
    .filter((c) => !finishedSlugs.has(c.slug))
    .sort((a, b) => b.date.localeCompare(a.date));

  const winCount = finishedIdeas.filter((i) => ideaBucket(i) === "win").length;
  const nullCount =
    finishedIdeas.filter((i) => ideaBucket(i) === "null").length +
    extraClosed.filter((c) => closedBucket(c.verdict) === "null").length;
  const rejectCount = extraClosed.filter((c) => closedBucket(c.verdict) === "reject").length;
  const allCount = winCount + nullCount + rejectCount;

  const shownIdeas =
    expFilter === "reject"
      ? []
      : finishedIdeas.filter((i) => expFilter === "all" || ideaBucket(i) === expFilter);
  const shownClosed =
    expFilter === "win"
      ? []
      : extraClosed.filter((c) => expFilter === "all" || closedBucket(c.verdict) === expFilter);
  // Preview window over the combined list (ran cards first, then closed rows).
  const EXP_PREVIEW = 6;
  const ideaShown = showAllFinished ? shownIdeas : shownIdeas.slice(0, EXP_PREVIEW);
  const closedBudget = Math.max(0, EXP_PREVIEW - ideaShown.length);
  const closedShownExp = showAllFinished ? shownClosed : shownClosed.slice(0, closedBudget);
  const expTotalShown = ideaShown.length + closedShownExp.length;
  const expTotal = shownIdeas.length + shownClosed.length;

  const EXP_CHIPS: { id: typeof expFilter; label: string; n: number }[] = [
    { id: "all", label: "All", n: allCount },
    { id: "win", label: "Wins", n: winCount },
    { id: "null", label: "No change", n: nullCount },
    { id: "reject", label: "Rejected", n: rejectCount },
  ];

  // Split the flat tmux list by what each session is for, so idea-generation
  // sessions sit with the Ideas section and GPU-run supervisors with the GPU
  // section. Anything unrecognised falls into "other".
  const ideaSessions = sessions.filter(
    (s) =>
      s.name.startsWith(GENERATE_SESSION_PREFIX) ||
      s.name.startsWith(IMPLEMENT_SESSION_PREFIX)
  );
  const runSessions = sessions.filter((s) => s.name.startsWith(RUN_SESSION_PREFIX));
  const otherSessions = sessions.filter(
    (s) => !ideaSessions.includes(s) && !runSessions.includes(s)
  );

  // ----- Queue health diagnosis ---------------------------------------------
  // Derived purely from existing client state (no new polls). The operator
  // home dashboard is meant to read "what should I do next?" at a glance, so this
  // collapses the live signals into one status + one next-action sentence.
  // Priority order matters: most actionable / least ambiguous state wins.
  const stuckCount = staleRunningIdeas.length;
  const liveRunCount = runSessions.length;
  const noWork = runningIdeas.length === 0 && queuedIdeas.length === 0;

  type HealthTone = "ok" | "warn" | "alert" | "info" | "muted";
  type Health = {
    state: string;
    label: string;
    nextAction: string;
    tone: HealthTone;
    badge: string;
  };

  let queueHealth: Health;
  // 1. If we can't see the box at all and something is supposedly running,
  //    every other signal is suspect — surface the telemetry gap first.
  if (gpuUsageStale && (runningIdeas.length > 0 || arqAlive)) {
    queueHealth = {
      state: "telemetry-stale",
      label: "GPU telemetry stale",
      nextAction:
        "Can't reach the GPU box — requeue stuck rows or check remote-box.json.",
      tone: "warn",
      badge: "stale",
    };
  } else if (noWork) {
    queueHealth = {
      state: "no-work",
      label: "Queue idle",
      nextAction:
        "No running or ready ideas. Generate new ideas to refill the pipeline.",
      tone: "muted",
      badge: "idle",
    };
  } else if (runningIdeas.length > 0 && arqAlive && stuckCount === 0) {
    queueHealth = {
      state: "healthy-remote",
      label: "Healthy remote run",
      nextAction: `${runningIdeas.length} running on the box — attach to watch live.`,
      tone: "ok",
      badge: "live",
    };
  } else if (runningIdeas.length > 0 && arqAlive && stuckCount > 0) {
    queueHealth = {
      state: "remote-mixed",
      label: "Remote live, self-healing",
      nextAction: `Box is training fine. ${stuckCount} stale marker${stuckCount === 1 ? "" : "s"} being auto-requeued — nothing to do.`,
      tone: "ok",
      badge: "healing",
    };
  } else if (
    runningIdeas.length > 0 &&
    arqAlive &&
    liveRunCount === 0
  ) {
    queueHealth = {
      state: "remote-active-local-stale",
      label: "Remote active, local stale",
      nextAction:
        "Box is training but no local supervisor is attached — open Attach GPU.",
      tone: "warn",
      badge: "unattended",
    };
  } else if (runningIdeas.length > 0 && !arqAlive && liveRunCount === 0) {
    queueHealth = {
      state: "stale-local",
      label: "Stale run, auto-requeuing",
      nextAction:
        "Marked running with no supervisor and no remote arq — auto-requeuing to the queue.",
      tone: "warn",
      badge: "healing",
    };
  } else if (queuedIdeas.length > 0 && runningIdeas.length === 0 && !arqAlive) {
    queueHealth = {
      state: "ready-idle",
      label: "Ready but idle",
      nextAction: autorunOn
        ? "Autorun is on — waiting for the next tick to pick the first ready idea."
        : "Turn on Autorun or press Run next to start draining the queue.",
      tone: "info",
      badge: "ready",
    };
  } else if (queuedIdeas.length > 0 && runningIdeas.length > 0) {
    queueHealth = {
      state: "draining",
      label: "Queue draining",
      nextAction: `${runningIdeas.length} running, ${queuedIdeas.length} ready — see rows below.`,
      tone: "info",
      badge: "draining",
    };
  } else {
    queueHealth = {
      state: "steady",
      label: "Queue steady",
      nextAction: "No action needed.",
      tone: "muted",
      badge: "ok",
    };
  }

  // Tailwind can't pick dynamic class names from a string lookup, so resolve
  // the per-tone styles to a literal object — keeps the JIT happy.
  const HEALTH_TONE_STYLES: Record<HealthTone, string> = {
    ok: "border-emerald-400/20 bg-white/[0.025] text-emerald-100",
    warn: "border-amber-300/20 bg-white/[0.025] text-amber-100",
    alert: "border-red-400/25 bg-red-400/[0.035] text-red-100",
    info: "border-cyan-300/20 bg-white/[0.025] text-cyan-100",
    muted: "border-white/10 bg-white/[0.025] text-[#faf9f6]/70",
  };
  const HEALTH_DOT_STYLES: Record<HealthTone, string> = {
    ok: "bg-emerald-400",
    warn: "bg-amber-300",
    alert: "bg-red-400",
    info: "bg-cyan-300",
    muted: "bg-[#faf9f6]/40",
  };

  // location: where these tmux sessions live ("Local · Mac"). Each row can be
  // expanded to follow (and scroll back through) its saved log.
  const renderSessionList = (list: Session[], emptyText: string, location = "Local · Mac") =>
    list.length === 0 ? (
      <p className="rounded-md border border-white/10 bg-white/[0.02] px-4 py-4 text-center text-sm text-[#faf9f6]/40">
        {emptyText}
      </p>
    ) : (
      <ul className="space-y-2">
        {list.map((session) => {
          const open = expandedLogs.has(session.name);
          const log = logData[session.name];
          return (
            <li
              key={session.name}
              className="rounded-md border border-white/10 bg-white/[0.025] px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-mono text-sm text-[#faf9f6]">
                      {session.name}
                    </p>
                    {(() => {
                      const tag = sessionTagMeta(session);
                      if (!tag) return null;
                      return (
                        <span
                          title={tag.title}
                          className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${tag.tone}`}
                        >
                          {tag.kind === "codex" ? (
                            <Cpu className="h-3 w-3" aria-hidden />
                          ) : tag.kind === "minimax" ? (
                            <Sparkles className="h-3 w-3" aria-hidden />
                          ) : (
                            <Terminal className="h-3 w-3" aria-hidden />
                          )}
                          <span className="max-w-[11rem] truncate">{tag.label}</span>
                        </span>
                      );
                    })()}
                    <span className="shrink-0 rounded border border-sky-300/20 bg-sky-300/[0.06] px-1.5 py-0.5 text-[9px] font-medium text-sky-200/75">
                      {location}
                    </span>
                  </div>
                  <p className="text-xs text-[#faf9f6]/40">
                    {session.windows} window{session.windows === 1 ? "" : "s"} ·
                    started {new Date(session.created).toLocaleTimeString()} ·{" "}
                    <span className="font-mono tabular-nums text-[#faf9f6]/55">
                      ⏱ {formatAgo(now - session.created)}
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleLog(session.name)}
                    title={open ? "Hide log" : "Show logs"}
                    aria-label={open ? `Hide log for ${session.name}` : `Show logs for ${session.name}`}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2 text-xs font-medium text-[#faf9f6]/65 transition hover:border-white/25 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20"
                  >
                    <FileText className="h-3.5 w-3.5" aria-hidden />
                    <span className="hidden sm:inline">{open ? "Hide" : "Logs"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAttach(session.name)}
                    disabled={attaching === session.name}
                    title="Attach tmux session"
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-cyan-300/25 bg-cyan-300/[0.07] px-2 text-xs font-medium text-cyan-200 transition hover:border-cyan-300/50 hover:bg-cyan-300/[0.12] hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/35 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {attaching === session.name ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Terminal className="h-3.5 w-3.5" aria-hidden />
                    )}
                    <span className="hidden sm:inline">Attach</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleKill(session.name)}
                    disabled={killing === session.name}
                    title="Kill tmux session"
                    aria-label={`Kill ${session.name}`}
                    className="inline-flex h-8 items-center justify-center rounded-md border border-red-400/25 bg-red-400/[0.07] px-2 text-xs font-medium text-red-300 transition hover:border-red-400/50 hover:bg-red-400/[0.12] hover:text-white focus:outline-none focus:ring-2 focus:ring-red-400/35 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {killing === session.name ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <X className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </button>
                </div>
              </div>

              {open && (
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-[#faf9f6]/35">
                    <span>tmux capture · {location}</span>
                    <span>
                      {log
                        ? `${log.alive ? "live" : "ended"} · updated ${formatAgo(now - log.at)} ago`
                        : "loading…"}
                    </span>
                  </div>
                  <pre
                    ref={setLogRef(session.name)}
                    className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-[#faf9f6]/75"
                  >
                    {log
                      ? log.text || "(no output captured yet)"
                      : "Loading log…"}
                  </pre>
                  <p className="mt-1 text-[10px] text-[#faf9f6]/30">
                    Refreshes every 3s · saved to disk, swept after 1h.
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );

  // Final A/B result under a finished idea. Just the mark (verdict badge) and
  // the numbers — no loss bars, no training curve. The verdict carries the
  // result at a glance; the deltas tell you the size and direction.
  // One idea row — the title, status badge, action buttons, and (if the A/B
  // has finished) the verdict + numbers. Used by every grouped list so the
  // cards stay identical wherever they appear.
  // Props every IdeaCard needs from this component's live state/handlers.
  // Spread into each <IdeaCard> so the two call sites stay in sync.
  const ideaCardShared = {
    liveSessions,
    implementing,
    attaching,
    autoImplementOn,
    now,
    onOpenFile: setOpenFile,
    onReset: handleReset,
    onImplement: handleImplement,
    onAttach: handleAttach,
  };

  return (
    <div className="flex min-h-screen bg-[#1f1e1d] text-[#faf9f6]">
      {/* Project sidebar — pick which repo the loop drives. Switching re-points
          every agent/API at that repo (its ideas, queue, autorun, GPU box). */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-white/10 bg-black/20 px-4 py-6 md:flex">
        <div className="flex items-center justify-between px-1">
          {/* Wordmark doubles as "home" — click to return to the dashboard. */}
          <button
            type="button"
            onClick={() => setView("home")}
            title="Back to home"
            className="-mx-1 rounded-md px-1 text-sm font-semibold tracking-tight text-[#faf9f6] transition hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20"
          >
            VoidSpark
          </button>
          <button
            type="button"
            onClick={handlePickFolder}
            disabled={addRepoPicking}
            aria-busy={addRepoPicking}
            title="Add a repo folder (opens a folder picker)"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-white/12 bg-white/[0.03] text-[#faf9f6]/60 transition hover:border-white/30 hover:text-white disabled:opacity-50"
          >
            <span className="text-sm leading-none">{addRepoPicking ? "…" : "+"}</span>
          </button>
        </div>

        {/* Top-level views — home (dashboard), analytics, documentation. */}
        <nav className="mt-6 flex flex-col gap-1">
          {([
            { id: "home", label: "Home", icon: "▣" },
            { id: "analytics", label: "Analytics", icon: "📊" },
            { id: "documentation", label: "Documentation", icon: "📖" },
          ] as { id: View; label: string; icon: string }[]).map((item) => {
            const active = view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
                  active
                    ? "bg-white/[0.08] text-[#faf9f6]"
                    : "text-[#faf9f6]/55 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                <span aria-hidden className="text-[11px] opacity-70">
                  {item.icon}
                </span>
                <span className="font-medium">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="mt-6 px-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#faf9f6]/40">
          Projects
        </div>
        <nav className="mt-2 flex flex-col gap-1">
          {projects.length === 0 && (
            <span className="px-2 py-1.5 text-xs text-[#faf9f6]/40">No projects</span>
          )}
          {projects.map((p) => {
            const active = p.id === activeProjectId;
            const confirming = confirmRemoveId === p.id;
            const busy = removeRepoBusy === p.id;
            return (
              <div key={p.id} className="group relative">
                <button
                  type="button"
                  onClick={() => handleSwitchProject(p.id)}
                  disabled={projectSwitching}
                  title={p.repoPath}
                  className={`flex w-full flex-col items-start rounded-md px-2 py-1.5 pr-7 text-left text-xs transition disabled:opacity-50 ${
                    active
                      ? "bg-white/[0.08] text-[#faf9f6]"
                      : "text-[#faf9f6]/55 hover:bg-white/[0.04] hover:text-white"
                  }`}
                >
                  <span className="flex w-full items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        active ? "bg-emerald-400" : "bg-[#faf9f6]/25"
                      }`}
                    />
                    <span className="truncate font-medium">{p.name}</span>
                  </span>
                  <span className="mt-0.5 w-full truncate pl-3 text-[10px] text-[#faf9f6]/30">
                    {p.repoPath}
                  </span>
                </button>
                {/* Disconnect button (×). Hidden by default, revealed on row
                    hover or while the confirm step is showing. Lives outside
                    the switch button so its click doesn't trigger a switch. */}
                {!confirming && (
                  <button
                    type="button"
                    onClick={() => setConfirmRemoveId(p.id)}
                    title="Disconnect this repo from VoidSpark (registry only — files stay put)"
                    aria-label={`Disconnect ${p.name}`}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded text-[#faf9f6]/30 opacity-0 transition hover:bg-white/[0.08] hover:text-rose-300 group-hover:opacity-100 focus:opacity-100"
                  >
                    <span className="text-base leading-none">×</span>
                  </button>
                )}
                {confirming && (
                  <div className="absolute inset-0 flex items-center justify-end gap-1.5 rounded-md bg-black/85 px-2 backdrop-blur-sm">
                    <span className="mr-auto text-[10px] text-[#faf9f6]/70">
                      Disconnect?
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveProject(p.id)}
                      disabled={busy}
                      className="rounded bg-rose-500/80 px-2 py-0.5 text-[10px] font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50"
                    >
                      {busy ? "…" : "Yes"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveId(null)}
                      disabled={busy}
                      className="rounded px-2 py-0.5 text-[10px] text-[#faf9f6]/70 transition hover:text-white disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        {addRepoOpen && (
          <div className="mt-3 flex flex-col gap-2 rounded-md border border-white/10 bg-white/[0.03] p-2">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={addRepoPath}
                onChange={(e) => setAddRepoPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddProject();
                  if (e.key === "Escape") {
                    setAddRepoOpen(false);
                    setAddRepoError("");
                  }
                }}
                placeholder="/absolute/path/to/repo"
                className="min-w-0 flex-1 rounded border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-[11px] text-[#faf9f6] placeholder-[#faf9f6]/25 focus:border-white/30 focus:outline-none"
                disabled={addRepoBusy}
              />
              <button
                type="button"
                onClick={handlePickFolder}
                disabled={addRepoPicking}
                title="Open the folder picker"
                className="shrink-0 rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-[#faf9f6]/70 transition hover:border-white/30 hover:text-white disabled:opacity-50"
              >
                {addRepoPicking ? "…" : "Pick…"}
              </button>
            </div>
            <input
              type="text"
              value={addRepoName}
              onChange={(e) => setAddRepoName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddProject();
                if (e.key === "Escape") {
                  setAddRepoOpen(false);
                  setAddRepoError("");
                }
              }}
              placeholder="Display name (optional)"
              className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-[#faf9f6] placeholder-[#faf9f6]/25 focus:border-white/30 focus:outline-none"
              disabled={addRepoBusy}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAddProject}
                disabled={addRepoBusy || !addRepoPath.trim()}
                className="flex-1 rounded bg-white/[0.08] px-2 py-1.5 text-[11px] font-semibold text-[#faf9f6] transition hover:bg-white/[0.14] disabled:opacity-40"
              >
                {addRepoBusy ? "Adding…" : "Add"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddRepoOpen(false);
                  setAddRepoError("");
                  setAddRepoPath("");
                  setAddRepoName("");
                }}
                disabled={addRepoBusy}
                className="rounded px-2 py-1.5 text-[11px] text-[#faf9f6]/55 transition hover:text-white disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
            {addRepoError && (
              <p className="px-0.5 text-[10px] leading-snug text-rose-300/90">
                {addRepoError}
              </p>
            )}
          </div>
        )}
        {!addRepoOpen && (
          <p className="mt-4 px-2 text-[10px] leading-relaxed text-[#faf9f6]/30">
            Click <span className="font-mono">+</span> to pick a repo folder.
          </p>
        )}
      </aside>

      {view === "analytics" ? (
        <AnalyticsView onHome={() => setView("home")} />
      ) : view === "documentation" ? (
        <DocumentationView onHome={() => setView("home")} />
      ) : (
      <main className="min-h-screen flex-1 bg-[#1f1e1d] text-[#faf9f6]">
        {/* System health bar — sticky at the top of the dashboard. At-a-glance
            loop status (workers, dead panes, idea pool, throughput, GPU, quota)
            plus the master Autoresearch toggle. Read-only poll; the toggle is
            the page's own handler so state stays single-sourced. */}
        <HealthBar
          autoresearchOn={autoresearchOn}
          busy={autoresearchBusy}
          onToggle={handleToggleAutoresearch}
        />
        <div className="container mx-auto flex min-h-[calc(100vh-12rem)] flex-col items-center px-6 py-10 pt-6">
        {/* No-autoresearch warning — the added repo has no autoresearch/ folder,
            so the dashboard is empty. Offer to scaffold a starter rather than
            leave the user thinking their data vanished. */}
        {scaffoldRepo && (
          <div className="mb-4 w-full max-w-2xl rounded-lg border border-amber-300/30 bg-amber-300/[0.07] px-4 py-3">
            <p className="text-xs font-semibold text-amber-100">
              This folder has no <span className="font-mono">autoresearch/</span> — nothing to drive yet.
            </p>
            <p className="mt-1 text-[11px] leading-snug text-[#faf9f6]/55">
              VoidSpark only reads the <span className="font-mono">autoresearch/</span> folder. If you
              expected experiments here, double-check the path. Or scaffold a starter to begin.
            </p>
            <p className="mt-1 break-all font-mono text-[10px] text-[#faf9f6]/35">{scaffoldRepo}</p>
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={handleScaffold}
                disabled={scaffoldBusy}
                className="inline-flex h-7 items-center rounded-md border border-amber-300/50 bg-amber-300/15 px-2.5 text-[11px] font-medium text-amber-100 transition hover:bg-amber-300/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {scaffoldBusy ? "Creating…" : "Create starter autoresearch/"}
              </button>
              <button
                type="button"
                onClick={() => { setScaffoldRepo(null); setScaffoldMsg(""); }}
                className="text-[11px] text-[#faf9f6]/45 transition hover:text-[#faf9f6]/75"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        {scaffoldMsg && (
          <p className={`mb-4 w-full max-w-2xl text-[11px] ${scaffoldMsg.startsWith("✓") ? "text-emerald-300/85" : "text-rose-300/90"}`}>
            {scaffoldMsg}
          </p>
        )}
        {/* Uncommon controls (agent, headless, prompt files) live behind this
            gear so the main view stays focused on ideas + the queue. */}
        <div className="flex w-full max-w-2xl items-center justify-end gap-2">
          {/* Simple/Advanced UI toggle — Simple hides the manual power-user
              controls so the loop's status takes center stage. */}
          <button
            type="button"
            onClick={toggleUiMode}
            title={
              advanced
                ? "Advanced UI — every manual control is shown. Click for the simple view."
                : "Simple UI — manual controls hidden; let Autoresearch drive. Click for advanced."
            }
            className="inline-flex h-9 items-center gap-2 rounded-md border border-white/12 bg-white/[0.03] px-2.5 text-xs font-medium text-[#faf9f6]/55 transition hover:border-white/30 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20"
          >
            {advanced ? <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
            <span className="hidden sm:inline">{advanced ? "Advanced" : "Simple"}</span>
          </button>
          <div className="relative" ref={settingsRef}>
            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              aria-expanded={settingsOpen}
              title="Open settings"
              className={`inline-flex h-9 items-center gap-2 rounded-md border px-2.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-white/20 ${
                settingsOpen
                  ? "border-white/30 bg-white/[0.08] text-white"
                  : "border-white/12 bg-white/[0.03] text-[#faf9f6]/55 hover:border-white/30 hover:text-white"
              }`}
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">Settings</span>
              <span className="h-1 w-1 rounded-full bg-[#faf9f6]/30" aria-hidden />
              <span>{agentOptions.find((o) => o.id === agent)?.label ?? agent}</span>
            </button>

            {settingsOpen && (
            <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-white/12 bg-[#262524] p-4 text-left shadow-xl shadow-black/40">
              <div className="mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#faf9f6]/45">
                  Agent
                </span>
                <select
                  value={agent}
                  onChange={(e) => setAgent(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-cyan-300/30 bg-[#1f1e1d] px-3 py-2 text-sm font-semibold tracking-[0.04em] text-cyan-200 transition hover:border-cyan-300/60 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
                >
                  {agentOptions.map((opt) => (
                    <option key={opt.id} value={opt.id} className="bg-[#1f1e1d] text-cyan-100">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex cursor-pointer items-start gap-2 text-[11px] text-[#faf9f6]/65">
                <input
                  type="checkbox"
                  checked={headless}
                  onChange={(e) => setHeadless(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-cyan-400"
                />
                <span>
                  Headless — exit &amp; auto-close tmux when done{" "}
                  <span className="text-[#faf9f6]/30">(uncheck to watch)</span>
                </span>
              </label>

              <div className="mt-4 border-t border-white/10 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#faf9f6]/40">
                    GPU box (Vast.ai)
                  </span>
                  <a
                    href="https://cloud.vast.ai/"
                    target="_blank"
                    rel="noreferrer"
                    title="Open Vast.ai in your default browser"
                    className="inline-flex items-center gap-1 rounded-md border border-white/12 px-1.5 py-0.5 text-[10px] font-medium text-[#faf9f6]/65 transition hover:border-white/30 hover:text-white"
                  >
                    Open Vast.ai <ExternalLink className="h-2.5 w-2.5" aria-hidden />
                  </a>
                </div>
                <p className="mt-1.5 text-[10px] leading-snug text-[#faf9f6]/40">
                  Paste the SSH command from your Vast.ai instance — host, port, and user are parsed
                  into <span className="font-mono">remote-box.json</span>.
                </p>
                <div className="mt-2 flex gap-1.5">
                  {/* This is an SSH command, not a credential — but it looks
                      secret enough that browsers offer to "save password" on a
                      real type=password field. Keep it type=text (so Chrome /
                      Firefox / 1Password leave it alone) and mask via CSS when
                      hidden. The data-*-ignore attrs deter the popular managers. */}
                  <input
                    type="text"
                    value={boxSsh}
                    onChange={(e) => setBoxSsh(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveBox(); }}
                    placeholder="ssh -p 52674 root@1.2.3.4"
                    spellCheck={false}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    name="vast-ssh-command"
                    data-1p-ignore
                    data-lpignore="true"
                    data-form-type="other"
                    style={!boxShow ? ({ WebkitTextSecurity: "disc" } as React.CSSProperties) : undefined}
                    className="h-8 flex-1 rounded-md border border-white/12 bg-[#1f1e1d] px-2.5 font-mono text-[11px] text-[#faf9f6]/85 focus:border-white/30 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setBoxShow((v) => !v)}
                    title={boxShow ? "Hide" : "Show"}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/12 text-[#faf9f6]/55 transition hover:border-white/30 hover:text-white"
                  >
                    {boxShow ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
                  </button>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  <input
                    value={boxRepo}
                    onChange={(e) => setBoxRepo(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveBox(); }}
                    placeholder="remote repo (/root/…)"
                    spellCheck={false}
                    className="h-7 w-full rounded-md border border-white/12 bg-[#1f1e1d] px-2 font-mono text-[10px] text-[#faf9f6]/80 focus:border-white/30 focus:outline-none"
                  />
                  <input
                    value={boxVenv}
                    onChange={(e) => setBoxVenv(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveBox(); }}
                    placeholder="venv (/venv/main)"
                    spellCheck={false}
                    className="h-7 w-full rounded-md border border-white/12 bg-[#1f1e1d] px-2 font-mono text-[10px] text-[#faf9f6]/80 focus:border-white/30 focus:outline-none"
                  />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSaveBox}
                    disabled={boxBusy || boxSetupBusy || !boxSsh.trim()}
                    className="inline-flex h-7 items-center rounded-md border border-violet-400/50 bg-violet-400/15 px-2.5 text-[11px] font-medium text-violet-100 transition hover:bg-violet-400/25 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {boxBusy ? "Saving…" : "Save box"}
                  </button>
                  <button
                    type="button"
                    onClick={handleSetupBox}
                    disabled={boxBusy || boxSetupBusy || (!boxSsh.trim() && !boxConfigured)}
                    title="Save the box, then launch an agent that SSHes in, clones this repo, reads its setup instructions, and installs everything"
                    className="inline-flex h-7 items-center rounded-md border border-cyan-400/50 bg-cyan-400/15 px-2.5 text-[11px] font-medium text-cyan-100 transition hover:bg-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {boxSetupBusy ? "Launching…" : "Set up box →"}
                  </button>
                  {boxConfigured ? (
                    <span className="truncate font-mono text-[10px] text-emerald-300/80">
                      {boxConfigured.user}@{boxConfigured.host}:{boxConfigured.port}
                    </span>
                  ) : null}
                </div>
                {boxMsg ? (
                  <p className={`mt-1.5 text-[10px] leading-snug ${boxMsg.startsWith("Saved") || boxMsg.startsWith("Setup agent launched") ? "text-emerald-300/80" : "text-rose-300/90"}`}>
                    {boxMsg}
                  </p>
                ) : null}
              </div>

              {advanced && (
              <div className="mt-4 border-t border-white/10 pt-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#faf9f6]/40">
                  Edit prompts
                </span>
                <div className="mt-2 flex flex-col gap-1.5 text-xs">
                  {[
                    { path: IDEAS_PROMPT_PATH, title: "generate-ideas.md", label: "Generate ideas" },
                    { path: IMPLEMENT_PROMPT_PATH, title: "implement-idea.md", label: "Implement" },
                    { path: RUNNER_PROMPT_PATH, title: "runner.md", label: "Autorun runner" },
                    { path: RUN_PROMPT_PATH, title: "run-idea.md", label: "Single run" },
                    { path: SETUP_BOX_PROMPT_PATH, title: "setup-box.md", label: "Set up box" },
                    { path: REMOTE_BOX_PATH, title: "remote-box.json", label: "GPU box" },
                  ].map((p) => (
                    <button
                      key={p.path}
                      type="button"
                      onClick={() => {
                        setOpenFile({ path: p.path, title: p.title });
                        setSettingsOpen(false);
                      }}
                      title={`Open ${p.title}`}
                      className="flex items-center justify-between rounded-md px-2 py-1 text-left text-[#faf9f6]/70 transition hover:bg-white/[0.06] hover:text-white"
                    >
                      <span>{p.label}</span>
                      <span className="text-[10px] text-[#faf9f6]/35">{p.title}</span>
                    </button>
                  ))}
                </div>
              </div>
              )}

              {/* MiniMax quota — only shown when the key is configured and the
                  API answered (ok). Percents are how much is LEFT to use. */}
              {minimaxUsage?.ok && (
                <div className="mt-4 border-t border-white/10 pt-3">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#faf9f6]/40">
                    MiniMax tokens left
                  </span>
                  <div className="mt-2 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[#faf9f6]/55">5-hour window</span>
                      <span
                        className={`font-semibold ${
                          minimaxUsage.exhausted ? "text-rose-300" : "text-[#faf9f6]/80"
                        }`}
                      >
                        {minimaxUsage.intervalPercent}% left
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#faf9f6]/55">This week</span>
                      <span className="font-semibold text-[#faf9f6]/80">
                        {minimaxUsage.weeklyPercent}% left
                      </span>
                    </div>
                    {minimaxUsage.exhausted && (
                      <p className="pt-1 text-[11px] text-rose-300/80">
                        Out of tokens — agents fall back to Codex
                        {minimaxUsage.intervalResetAt != null
                          ? (() => {
                              const m = Math.max(
                                0,
                                Math.round((minimaxUsage.intervalResetAt - now) / 60000)
                              );
                              return ` · resets in ${m < 1 ? "<1" : m}m`;
                            })()
                          : ""}
                        .
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          </div>
        </div>

        {/* First-run onboarding — no project registered yet. The whole loop is
            scoped to one research repo, so until the user adds one there's
            nothing to show. Reuses the sidebar add-project flow. */}
        {projectsLoaded && !hasProject ? (
          <section className="mt-10 w-full max-w-xl">
            <div className="rounded-2xl border border-white/12 bg-[#262524] p-8 shadow-xl shadow-black/30">
              <h2 className="text-lg font-semibold text-[#faf9f6]">Point VoidSpark at a research repo</h2>
              <p className="mt-2 text-sm leading-relaxed text-[#faf9f6]/55">
                VoidSpark drives one local repo at a time — mining ideas, implementing them behind a
                flag, running the A/B on your GPU, and judging the result. Add the absolute path to
                that repo to begin.
              </p>

              <div className="mt-6 flex flex-col gap-2">
                <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#faf9f6]/40">
                  Repo folder (absolute path)
                </label>
                <div className="flex gap-2">
                  <input
                    value={addRepoPath}
                    onChange={(e) => setAddRepoPath(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddProject(); }}
                    placeholder="/Users/you/code/your-research-repo"
                    spellCheck={false}
                    className="h-10 flex-1 rounded-lg border border-white/12 bg-[#1f1e1d] px-3 font-mono text-sm text-[#faf9f6]/85 focus:border-white/30 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handlePickFolder}
                    disabled={addRepoPicking}
                    title="Open the OS folder picker"
                    className="inline-flex h-10 items-center rounded-lg border border-white/15 bg-white/[0.04] px-3 text-xs font-medium text-[#faf9f6]/70 transition hover:border-white/30 hover:text-white disabled:opacity-50"
                  >
                    {addRepoPicking ? "Opening…" : "Browse…"}
                  </button>
                </div>
                <input
                  value={addRepoName}
                  onChange={(e) => setAddRepoName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddProject(); }}
                  placeholder="Display name (optional)"
                  spellCheck={false}
                  className="h-10 w-full rounded-lg border border-white/12 bg-[#1f1e1d] px-3 text-sm text-[#faf9f6]/85 focus:border-white/30 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddProject}
                  disabled={addRepoBusy || !addRepoPath.trim()}
                  className="mt-1 inline-flex h-10 items-center justify-center rounded-lg border border-violet-400/50 bg-violet-400/20 px-4 text-sm font-medium text-violet-100 transition hover:bg-violet-400/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {addRepoBusy ? "Adding…" : "Add repo & start"}
                </button>
                {addRepoError && (
                  <p className="text-[11px] leading-snug text-rose-300/90">{addRepoError}</p>
                )}
              </div>

              <p className="mt-6 border-t border-white/10 pt-4 text-[11px] leading-relaxed text-[#faf9f6]/40">
                Don&apos;t have one yet? Clone the reference target{" "}
                <a
                  href="https://github.com/vukrosic/universe-lm"
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-violet-300/80 underline-offset-2 hover:underline"
                >
                  github.com/vukrosic/universe-lm
                </a>{" "}
                and point VoidSpark at it. After adding a repo, open{" "}
                <span className="font-medium text-[#faf9f6]/55">Settings</span> to paste your Vast.ai
                GPU box SSH command.
              </p>
            </div>
          </section>
        ) : hasProject ? (
        <>

        {/* Record-track switcher — scopes the ideas, records, and leaderboard
            below to the active track. Add/switch independent research tracks. */}
        <div className="mt-8 flex w-full max-w-4xl justify-start">
          <TrackSwitcher onChange={onTrackChange} />
        </div>

        {/* ================= SECTION 1 · IDEAS ================= */}
        {/* Hidden in Simple mode — the records board + GPU status lead instead. */}
        {advanced && (
        <section className="mt-12 w-full max-w-4xl">
          <div className="mb-4 flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-300/20 bg-amber-300/[0.06] text-amber-200">
                <Lightbulb className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-normal text-amber-100">
                  Ideas
                </h2>
                <p className="text-[11px] text-[#faf9f6]/40">
                  Brainstorm to runnable A/B.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {/* Hidden while Autoresearch (master) is on — it covers
                  auto-implement; shown only for per-part control. */}
              {!autoresearchOn && (
              <button
                type="button"
                onClick={handleToggleAutoImplement}
                disabled={autoImplementBusy}
                title={
                  autoImplementOn
                    ? "Auto-implement is ON — Proposed ideas get implemented automatically (max 2 at once). Click to stop."
                    : "Auto-implement is OFF. Click to auto-implement Proposed ideas (max 2 at once)."
                }
                className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  autoImplementOn
                    ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200 hover:bg-emerald-400/25 focus:ring-emerald-400/40"
                    : "border-white/15 bg-white/[0.04] text-[#faf9f6]/55 hover:border-white/30 hover:text-white focus:ring-white/20"
                }`}
              >
                <Zap className={`h-3.5 w-3.5 ${autoImplementOn ? "fill-emerald-300/25" : ""}`} aria-hidden />
                {autoImplementBusy
                  ? "Saving"
                  : autoImplementOn
                    ? "Auto on"
                    : "Auto off"}
              </button>
              )}
              <button
                type="button"
                onClick={refreshIdeas}
                aria-label="Refresh ideas"
                title="Refresh ideas"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-amber-200/65 transition hover:border-amber-300/30 hover:text-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-300/25"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>

          {/* Manual idea generation — hidden in Simple mode, where Autoresearch
              refills the idea pool automatically. */}
          {advanced && (
          <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <form onSubmit={handleGenerate} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="inline-flex h-9 items-center overflow-hidden rounded-md border border-white/10 bg-white/[0.03] text-xs text-[#faf9f6]/60">
                <button
                  type="button"
                  onClick={() => setIdeaCount((n) => Math.max(1, n - 1))}
                  disabled={ideaCount <= 1 || isGenerating}
                  aria-label="Decrease idea count"
                  title={ideaCount <= 1 ? "Minimum count" : "Decrease idea count"}
                  className="flex h-full w-8 items-center justify-center text-[#faf9f6]/45 transition hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <Minus className="h-3.5 w-3.5" aria-hidden />
                </button>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={ideaCount}
                  onChange={(e) => {
                    const n = Math.round(Number(e.target.value));
                    setIdeaCount(Number.isFinite(n) ? Math.max(1, Math.min(20, n)) : 1);
                  }}
                  className="h-full w-11 border-x border-white/10 bg-[#1f1e1d] px-1 text-center text-sm font-semibold text-amber-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:outline-none focus:ring-2 focus:ring-amber-300/35"
                  aria-label="Number of ideas to generate"
                />
                <button
                  type="button"
                  onClick={() => setIdeaCount((n) => Math.min(20, n + 1))}
                  disabled={ideaCount >= 20 || isGenerating}
                  aria-label="Increase idea count"
                  title={ideaCount >= 20 ? "Maximum count" : "Increase idea count"}
                  className="flex h-full w-8 items-center justify-center text-[#faf9f6]/45 transition hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
              <button
                type="submit"
                disabled={isGenerating}
                title={`Generate ${ideaCount} idea${ideaCount === 1 ? "" : "s"}`}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-amber-300/25 bg-amber-300/[0.08] px-3 text-xs font-semibold text-amber-100 transition hover:border-amber-300/50 hover:bg-amber-300/[0.14] hover:text-white focus:outline-none focus:ring-2 focus:ring-amber-300/35 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isGenerating ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                )}
                {isGenerating ? "Generating" : `Generate ${ideaCount}`}
              </button>
            </form>
            {generateMessage && (
              <p className="text-xs text-amber-300/85 sm:text-right">{generateMessage}</p>
            )}
          </div>
          )}

          {ideaActionMsg && (
            <p className="mb-2 text-xs text-amber-300">{ideaActionMsg}</p>
          )}
          {ideaLoadError && (
            <p className="mb-2 text-xs text-orange-300">{ideaLoadError}</p>
          )}

          {activeIdeaCount === 0 ? (
            <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-6 text-center text-sm text-[#faf9f6]/40">
              No open ideas — finished experiments are at the bottom.
            </p>
          ) : (
            <div className="space-y-6">
              {ideaGroups
                .filter((group) => group.ideas.length > 0)
                .map((group) => {
                  const expanded = expandedIdeaGroups.has(group.key);
                  const visibleIdeas = expanded ? group.ideas : group.ideas.slice(0, 2);
                  const hiddenCount = group.ideas.length - visibleIdeas.length;
                  return (
                  <div key={group.key}>
                    <button
                      type="button"
                      onClick={() => toggleIdeaGroup(group.key)}
                      aria-expanded={expanded}
                      title={expanded ? "Collapse idea group" : "Expand idea group"}
                      className="mb-2 flex w-full items-center justify-between gap-3 rounded-md px-1 py-1 text-left transition hover:bg-white/[0.03] focus:outline-none focus:ring-2 focus:ring-amber-300/20"
                    >
                      <span
                        className={`flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] ${
                          group.tone === "warn" ? "text-orange-300/70" : "text-amber-200/50"
                        }`}
                      >
                        <span aria-hidden className="font-mono text-[#faf9f6]/30">
                          {expanded ? "−" : "+"}
                        </span>
                        {group.label}
                        <span className="text-[#faf9f6]/30">({group.ideas.length})</span>
                      </span>
                      {hiddenCount > 0 && (
                        <span className="text-[10px] uppercase tracking-[0.18em] text-[#faf9f6]/35">
                          {hiddenCount} hidden
                        </span>
                      )}
                    </button>
                    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {visibleIdeas.map((idea) => (
                        <IdeaCard key={idea.id} idea={idea} {...ideaCardShared} />
                      ))}
                    </ul>
                    {hiddenCount > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleIdeaGroup(group.key)}
                        title="Show the rest of this idea group"
                        className="mt-2 w-full rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#faf9f6]/45 transition hover:border-white/20 hover:text-[#faf9f6]/75 focus:outline-none focus:ring-2 focus:ring-amber-300/20"
                      >
                        Show {hiddenCount} more
                      </button>
                    )}
                  </div>
                );
                })}
            </div>
          )}

	          {/* Idea-work tmux sessions — advanced only (raw debugging surface). */}
	          {advanced && (
	          <div className="mt-6">
	            <div className="mb-2 flex items-center gap-2 text-[11px] text-amber-200/55">
	              <Terminal className="h-3.5 w-3.5" aria-hidden />
	              <h3 className="font-medium uppercase tracking-normal">Idea work</h3>
	              <span className="font-mono text-[#faf9f6]/35">{ideaSessions.length}</span>
	            </div>
	            {renderSessionList(ideaSessions, "No generate/implement sessions running.")}
	          </div>
	          )}
        </section>
        )}

        {/* ================= SECTION 2 · GPU RUNS ================= */}
        <section className="mt-16 w-full max-w-4xl">
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-cyan-300/20 bg-cyan-300/[0.06] text-cyan-200">
                <Cpu className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-normal text-cyan-100">
                  GPU runs
                </h2>
                <p className="text-[11px] text-[#faf9f6]/40">
                  Queue, launch, and watch A/Bs.
                </p>
              </div>
            </div>
          </div>

          {/* GPU queue */}
          <div className="w-full rounded-lg border border-white/10 bg-white/[0.02] px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cyan-300/[0.08] text-cyan-200/80">
                <Activity className="h-3.5 w-3.5" aria-hidden />
              </span>
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-normal text-cyan-100/80">
                  GPU queue
                </h2>
                <p className="text-xs text-[#faf9f6]/45">
                  {runningIdeas.length} running · {queuedIdeas.length} ready
                </p>
                {/* Two activity clocks so it's obvious the queue is moving even
                    when the running count looks static: when something last
                    entered the queue, and when the daemon last sent a run to the
                    GPU. Both count up live off the 1s `now` ticker. */}
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-[#faf9f6]/35">
                  <span title="When an idea was last marked needs-run (entered the queue)">
                    added{" "}
                    <span className="text-[#faf9f6]/60">
                      {queueAddedAt ? `${formatAgo(now - queueAddedAt)} ago` : "—"}
                    </span>
                  </span>
                  <span aria-hidden className="text-[#faf9f6]/20">·</span>
                  <span title="When the daemon last claimed a run and launched it on the GPU box">
                    drained{" "}
                    <span className="text-[#faf9f6]/60">
                      {queueDrainAt ? `${formatAgo(now - queueDrainAt)} ago` : "—"}
                    </span>
                  </span>
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Master switch. When Autoresearch is ON the whole loop self-runs
                  (ideas → implement → gates → GPU) and the individual auto-toggles
                  are hidden; when OFF they appear so each part can be run alone. */}
              <button
                type="button"
                onClick={handleToggleAutoresearch}
                disabled={autoresearchBusy}
                title={
                  autoresearchOn
                    ? "Autoresearch is ON — idea generation, auto-implement, the gate pipeline, and GPU runs all self-run. Click to stop everything and control each part individually."
                    : "Autoresearch is OFF. Click to run the ENTIRE loop automatically — idea generation, implement, gates, and GPU runs."
                }
                className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  autoresearchOn
                    ? "border-violet-400/60 bg-violet-400/20 text-violet-100 hover:bg-violet-400/30 focus:ring-violet-400/40"
                    : "border-white/15 bg-white/[0.04] text-[#faf9f6]/60 hover:border-white/30 hover:text-white focus:ring-white/20"
                }`}
              >
                {autoresearchBusy ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Sparkles
                    className={`h-3.5 w-3.5 ${autoresearchOn ? "fill-violet-200/30" : ""}`}
                    aria-hidden
                  />
                )}
                {autoresearchBusy
                  ? "Saving"
                  : autoresearchOn
                    ? `Autoresearch on${autopilotInfo ? ` · ${autopilotInfo.inFlight}` : ""}`
                    : "Autoresearch off"}
              </button>

              {/* Individual parts — only shown when the master is OFF. */}
              {!autoresearchOn && (
                <button
                  type="button"
                  onClick={handleToggleAutopilot}
                  disabled={autopilotBusy}
                  title={
                    autopilotOn
                      ? `Autopilot is ON — stuck gates advance, ideas refill below ${autopilotInfo?.floor ?? 5} (cap ${autopilotInfo?.ceiling ?? 20}), and the GPU drains. Click to stop.`
                      : "Autopilot is OFF. Click to auto-advance gates, refill ideas, and drain the GPU."
                  }
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                    autopilotOn
                      ? "border-violet-400/50 bg-violet-400/15 text-violet-200 hover:bg-violet-400/25 focus:ring-violet-400/40"
                      : "border-white/15 bg-white/[0.04] text-[#faf9f6]/60 hover:border-white/30 hover:text-white focus:ring-white/20"
                  }`}
                >
                  <Power
                    className={`h-3.5 w-3.5 ${autopilotOn ? "fill-violet-300/25" : ""}`}
                    aria-hidden
                  />
                  {autopilotBusy
                    ? "Saving"
                    : autopilotOn
                      ? `Pilot on${autopilotInfo ? ` · ${autopilotInfo.inFlight}` : ""}`
                      : "Pilot off"}
                </button>
              )}
              {!autoresearchOn && (
                <button
                  type="button"
                  onClick={handleToggleAutorun}
                  disabled={autorunBusy}
                  title={
                    autorunOn
                      ? "Autorun is ON — each finished run auto-launches the next queued idea. Click to stop."
                      : "Autorun is OFF. Click to march through the queue automatically (one run at a time)."
                  }
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                    autorunOn
                      ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200 hover:bg-emerald-400/25 focus:ring-emerald-400/40"
                      : "border-white/15 bg-white/[0.04] text-[#faf9f6]/60 hover:border-white/30 hover:text-white focus:ring-white/20"
                  }`}
                >
                  {autorunBusy ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Play
                      className={`h-3.5 w-3.5 ${autorunOn ? "fill-emerald-300/25" : ""}`}
                      aria-hidden
                    />
                  )}
                  {autorunBusy ? "Saving" : autorunOn ? "GPU drainer on" : "GPU drainer off"}
                </button>
              )}
              {/* Manual single-run only makes sense when autorun is off — when
                  it's on, the lab-autorun runner agent drains the queue itself. */}
              {!autorunOn && (
                <button
                  type="button"
                  onClick={handleRunNext}
                  disabled={isRunningNext || gpuBusy || queuedIdeas.length === 0}
                  title={
                    queuedIdeas.length === 0
                      ? "No queued ideas to run"
                      : "Launch the next queued idea on the GPU"
                  }
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-cyan-300/25 bg-cyan-300/[0.07] px-2.5 text-xs font-medium text-cyan-200 transition hover:border-cyan-300/50 hover:bg-cyan-300/[0.12] hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/35 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isRunningNext ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Play className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {isRunningNext
                    ? "Launching"
                    : gpuBusy
                      ? "GPU busy"
                      : queuedIdeas.length === 0
                        ? "Queue empty"
                        : "Run next"}
                </button>
              )}
            </div>
          </div>

          {/* Queue health diagnosis — derived from existing client state. Tells
              the operator whether to wait, attach, requeue, or fix config. */}
          <div
            role="status"
	            aria-live="polite"
	            data-testid="queue-health"
	            data-state={queueHealth.state}
	            className={`mt-3 rounded-md border px-3 py-2.5 ${HEALTH_TONE_STYLES[queueHealth.tone]}`}
	          >
	            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
	              <div className="flex min-w-0 items-center gap-2">
	                <span
	                  aria-hidden
	                  className={`h-2 w-2 shrink-0 rounded-full ${HEALTH_DOT_STYLES[queueHealth.tone]} ${
	                    queueHealth.tone === "ok" || queueHealth.tone === "info"
	                      ? "animate-pulse"
	                      : ""
	                  }`}
	                />
	                <Gauge className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
	                <span className="text-sm font-semibold text-[#faf9f6]">
	                  {queueHealth.label}
	                </span>
	                <span className="rounded border border-current/25 bg-black/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] opacity-70">
	                  {queueHealth.badge}
	                </span>
	              </div>
	              <p className="text-xs leading-snug text-[#faf9f6]/55 sm:max-w-md sm:text-right">
	                {queueHealth.nextAction}
	              </p>
	            </div>
	            <div className="min-w-0">
	              <p className="mt-1.5 font-mono text-[10px] tabular-nums opacity-70">
	                {runningIdeas.length} running · {queuedIdeas.length} ready · {stuckCount} stuck
	                {" · "}
                {liveRunCount} supervisor
                {" · "}arq {arqAlive ? "live" : "idle"}
                {gpuUsage && !gpuUsageStale ? ` · gpu ${gpuUsage.utilization}%` : ""}
                {!gpuUsageStale &&
                gpuIdleSince != null &&
                now - gpuIdleSince >= GPU_IDLE_MIN_MS ? (
                  <span
                    className="text-orange-300"
                    title={`GPU has read <${GPU_IDLE_UTIL}% utilization (no work) since ${localTime(new Date(gpuIdleSince).toISOString())}`}
                  >
                    {" · "}idle {formatAgo(now - gpuIdleSince)}
                  </span>
                ) : null}
                {gpuUsageStale ? " · telemetry stale" : ""}
              </p>
            </div>
          </div>

          {runMessage && <p className="mt-3 text-xs text-cyan-200">{runMessage}</p>}
          {(ideaLoadError || sessionLoadError) && (
            <p className="mt-3 text-xs text-orange-200">
              {ideaLoadError || sessionLoadError}
            </p>
          )}

          {/* Operator instructions appended to the GPU runner agent's prompt —
              e.g. a one-off Vast.ai bash command. Applies to the next launch. */}
	          <div className="mt-4 rounded-md border border-white/10 bg-white/[0.02]">
	            <button
	              type="button"
	              onClick={() => setRunnerExtraOpen((v) => !v)}
	              aria-expanded={runnerExtraOpen}
	              title={runnerExtraOpen ? "Hide runner instructions" : "Open runner instructions"}
	              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-white/[0.03] focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
	            >
	              <span className="flex min-w-0 items-center gap-2.5">
	                <Terminal className="h-3.5 w-3.5 shrink-0 text-cyan-200/70" aria-hidden />
	                <span className="min-w-0">
	                  <span className="block text-xs font-medium text-[#faf9f6]/70">
	                    Runner instructions
	                  </span>
	                  <span className="mt-0.5 block truncate text-[11px] text-[#faf9f6]/35">
	                    {runnerExtra
	                      ? "Custom text saved for the next launch."
	                      : "Optional one-off prompt text."}
	                  </span>
	                </span>
	              </span>
	              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-[#faf9f6]/45">
	                {runnerExtraOpen ? (
	                  <Minus className="h-3.5 w-3.5" aria-hidden />
	                ) : (
	                  <Plus className="h-3.5 w-3.5" aria-hidden />
	                )}
	              </span>
	            </button>
	            {runnerExtraOpen && (
              <div className="border-t border-white/10 p-3 pt-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label
                    htmlFor="runner-extra"
                    className="text-[10px] uppercase tracking-[0.18em] text-[#faf9f6]/35"
                  >
                    Appended prompt text
                  </label>
                  <div className="flex items-center gap-2">
                {runnerExtraMsg && (
                  <span className="text-[11px] text-emerald-200/80">
                    {runnerExtraMsg}
                  </span>
                )}
                  <button
                    type="button"
                    onClick={handleSaveRunnerExtra}
                    disabled={runnerExtraSaving}
                    title="Save runner instructions"
	                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/15 bg-white/[0.04] px-2 text-[11px] font-medium text-[#faf9f6]/70 transition hover:border-white/30 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50"
	                >
	                  {runnerExtraSaving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />}
	                  {runnerExtraSaving ? "Saving" : "Save"}
	                </button>
              </div>
                </div>
                <textarea
                  id="runner-extra"
                  value={runnerExtra}
                  onChange={(e) => setRunnerExtra(e.target.value)}
                  rows={3}
                  spellCheck={false}
                  placeholder={'e.g. Before training, run on the box:\nnvidia-smi; export TORCHDYNAMO_DISABLE=1'}
                  className="w-full resize-y rounded-md border border-white/10 bg-[#1f1e1d] px-3 py-2 font-mono text-xs text-[#faf9f6]/90 placeholder:text-[#faf9f6]/30 focus:outline-none focus:ring-2 focus:ring-cyan-300/30"
                />
              </div>
            )}
          </div>

          {gpuQueue.length === 0 ? (
            <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-5 text-center text-sm text-[#faf9f6]/40">
              No ready GPU work.
            </p>
	          ) : (
	            <>
	              {!gpuQueueExpanded && gpuQueue.length > compactGpuQueue.length && (
	                <p className="mt-3 text-[11px] text-[#faf9f6]/35">
	                  Showing current run and next queued items
	                </p>
	              )}

              <ul className="mt-3 space-y-2">
                {visibleGpuQueue.map((idea) => {
                  const sessionName = RUN_SESSION_PREFIX + idea.id;
                  const isRunLive = liveSessions.has(sessionName);
                  const isCurrentRun =
                    idea.status === "running" && currentRunIdea?.id === idea.id;
                  const isRunStuck = staleRunningIdeas.some((stale) => stale.id === idea.id);
                  const queuePosition = queuedIdeas.findIndex((queued) => queued.id === idea.id) + 1;

                  return (
	                    <li
	                      key={idea.id}
	                      className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.025] px-3 py-2.5"
	                    >
                      <button
                        type="button"
                        onClick={() =>
                          setOpenFile({ path: idea.path, title: idea.title })
                        }
                        title={`Open ${idea.title}`}
                        className="min-w-0 flex-1 text-left transition hover:opacity-80 focus:outline-none"
                      >
                        <p className="truncate text-sm font-semibold text-[#faf9f6]">
                          {idea.title}
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-[#faf9f6]/35">
                          {idea.id}
                        </p>
                      </button>
                      <div className="flex shrink-0 items-center gap-2">
                        {timeInState(idea.updated) && (
                          <span
                            title={`${
                              idea.status === "running" ? "running for" : "waiting in queue for"
                            } ${timeInState(idea.updated)} · since ${localTime(idea.updated)}`}
                            className="font-mono text-[10px] tabular-nums text-[#faf9f6]/45"
                          >
                            {timeInState(idea.updated)}
                          </span>
                        )}
	                        {isCurrentRun && (
	                          <span className="rounded border border-emerald-300/25 bg-emerald-300/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-emerald-200/90">
	                            current
	                          </span>
	                        )}
                        {isRunLive && (
                          <span className="flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] text-emerald-300">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                            runner
                          </span>
                        )}
                        {isRunStuck && (
                          <span className="text-[10px] uppercase tracking-[0.15em] text-orange-300">
                            stuck
                          </span>
                        )}
	                        {idea.status === "needs-run" && queuePosition > 0 && (
	                          <span className="rounded border border-cyan-300/20 bg-cyan-300/5 px-1.5 py-0.5 text-[10px] font-medium text-cyan-200/80">
	                            #{queuePosition}
	                          </span>
	                        )}
                        {isRunLive ? (
                          <button
                            type="button"
                            onClick={() => handleAttach(sessionName)}
	                            disabled={attaching === sessionName}
	                            title="Attach the local supervisor tmux (SSHes the box, polls, writes evidence). Not the GPU itself — use the GPU box panel below for that."
	                            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-cyan-300/25 bg-cyan-300/[0.07] px-2 text-[11px] font-medium text-cyan-200 transition hover:border-cyan-300/50 hover:bg-cyan-300/[0.12] hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/35 disabled:cursor-not-allowed disabled:opacity-50"
	                          >
	                            {attaching === sessionName ? (
	                              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
	                            ) : (
	                              <Terminal className="h-3.5 w-3.5" aria-hidden />
	                            )}
	                            Runner
	                          </button>
	                        ) : isRunStuck ? (
                          <button
                            type="button"
                            onClick={() =>
                              handleReset(
                                idea.id,
                                "needs-run",
                                "requeued stuck GPU run from UI"
                              )
	                            }
	                            disabled={implementing === idea.id}
	                            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-orange-400/25 bg-orange-400/[0.07] px-2 text-[11px] font-medium text-orange-300 transition hover:border-orange-400/50 hover:bg-orange-400/[0.12] hover:text-white focus:outline-none focus:ring-2 focus:ring-orange-400/35 disabled:cursor-not-allowed disabled:opacity-50"
	                          >
	                            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
	                            Requeue
	                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {gpuQueue.length > compactGpuQueue.length && (
	                <button
	                  type="button"
	                  onClick={() => setGpuQueueExpanded((v) => !v)}
	                  title={gpuQueueExpanded ? "Collapse full queue" : "Show the full queue"}
	                  className="mt-3 w-full rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#faf9f6]/45 transition hover:border-white/20 hover:text-[#faf9f6]/75 focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
	                >
                  {gpuQueueExpanded
                    ? "Collapse full queue"
                    : `Show full queue (${gpuQueue.length})`}
                </button>
              )}
            </>
          )}
	        </div>

	        {/* GPU box — the real training, in tmux `arq` on the remote Vast box */}
	        <div className="mt-6 w-full rounded-lg border border-white/10 bg-white/[0.02] px-3 py-3">
	          <div className="flex flex-wrap items-center justify-between gap-3">
	            <div className="flex min-w-0 items-start gap-2.5">
	              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-fuchsia-300/[0.08] text-fuchsia-200/80">
	                <Server className="h-3.5 w-3.5" aria-hidden />
	              </span>
	              <div className="min-w-0">
	                <div className="flex flex-wrap items-center gap-2">
	                  <h2 className="text-xs font-semibold uppercase tracking-normal text-fuchsia-100/80">
	                    GPU box
	                  </h2>
	                  <span className="rounded border border-fuchsia-300/20 bg-fuchsia-300/[0.07] px-1.5 py-0.5 text-[9px] font-medium text-fuchsia-200/75">
	                    Vast
	                  </span>
	                </div>
	              <p className="mt-0.5 text-xs text-[#faf9f6]/45">
	                {gpuInfo?.host ? `${gpuInfo.host} · ` : ""}
	                {arqAlive ? (
	                  <span className="text-emerald-300">tmux arq live</span>
                ) : (
                  "tmux arq idle (starts when a run is active)"
                )}
              </p>
              {!gpuUsageStale &&
              gpuIdleSince != null &&
              now - gpuIdleSince >= GPU_IDLE_BOX_MIN_MS ? (
                <p
                  className="mt-1 text-xs text-orange-300/80"
                  title={`GPU has read <${GPU_IDLE_UTIL}% utilization (no work) since ${localTime(
                    new Date(gpuIdleSince).toISOString()
                  )}`}
                >
	                  idle {formatAgo(now - gpuIdleSince)} since last busy
	                </p>
	              ) : null}
	              </div>
	            </div>
	            <div className="flex items-center gap-1.5">
	              <button
	                type="button"
	                onClick={refreshGpu}
	                disabled={gpuLoading}
	                aria-label="Refresh GPU box"
	                title="Refresh GPU box"
	                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-fuchsia-300/25 bg-fuchsia-300/[0.07] text-fuchsia-200 transition hover:border-fuchsia-300/50 hover:bg-fuchsia-300/[0.12] hover:text-white focus:outline-none focus:ring-2 focus:ring-fuchsia-300/35 disabled:cursor-not-allowed disabled:opacity-50"
	              >
	                {gpuLoading ? (
	                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
	                ) : (
	                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
	                )}
	              </button>
	              <button
	                type="button"
                onClick={handleAttachGpu}
                disabled={attaching === "__gpu__" || !arqAlive}
                title={
                  arqAlive
                    ? "Open a Terminal SSH'd into the live remote GPU tmux (arq)."
	                    : "No live GPU run. The arq tmux only exists while a run is active — start one with Run next."
	                }
	                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-fuchsia-300/25 bg-fuchsia-300/[0.07] px-2.5 text-xs font-medium text-fuchsia-200 transition hover:border-fuchsia-300/50 hover:bg-fuchsia-300/[0.12] hover:text-white focus:outline-none focus:ring-2 focus:ring-fuchsia-300/35 disabled:cursor-not-allowed disabled:opacity-50"
	              >
	                {attaching === "__gpu__" ? (
	                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
	                ) : (
	                  <Terminal className="h-3.5 w-3.5" aria-hidden />
	                )}
	                {arqAlive ? "Attach" : "Idle"}
	              </button>
            </div>
          </div>

          {/* Live usage — polled independently every 4s (util % + VRAM). */}
          <div className="mt-4 space-y-2.5">
            {(() => {
              const u = gpuUsage;
              const memPct =
                u && u.memTotal > 0 ? Math.round((u.memUsed / u.memTotal) * 100) : 0;
              const util = u ? Math.max(0, Math.min(100, Math.round(u.utilization))) : 0;
              return (
                <>
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-[#faf9f6]/40">
                    <span>{u?.name || "GPU usage"}</span>
                    <span className={gpuUsageStale ? "text-orange-300/80" : "text-emerald-300/70"}>
                      {gpuUsageStale ? "stale" : u ? "live" : "—"}
                    </span>
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-[11px] text-[#faf9f6]/60">
                      <span>Compute</span>
                      <span className="font-mono">{u ? `${util}%` : "—"}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-emerald-400/80 transition-[width] duration-500"
                        style={{ width: `${util}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-[11px] text-[#faf9f6]/60">
                      <span>VRAM</span>
                      <span className="font-mono">
                        {u ? `${u.memUsed} / ${u.memTotal} MiB · ${memPct}%` : "—"}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-fuchsia-400/80 transition-[width] duration-500"
                        style={{ width: `${memPct}%` }}
                      />
                    </div>
                  </div>
                  {/* How far behind the numbers are: age of the reading + the
                      SSH round-trip it took to fetch, polled every 4s. */}
                  <p className="text-[10px] text-[#faf9f6]/35">
                    {gpuUsageAt
                      ? `Reading ${formatAgo(now - gpuUsageAt)} old · ${
                          gpuUsageLatencyMs != null ? `~${gpuUsageLatencyMs}ms to fetch · ` : ""
                        }polled every 4s`
                      : "Polling GPU every 4s…"}
                  </p>
                </>
              );
            })()}
          </div>

          {gpuError && <p className="mt-3 text-xs text-orange-200">{gpuError}</p>}

          {gpuInfo && (
            <div className="mt-4 space-y-3">
              {gpuInfo.gpu && (
                <p className="font-mono text-[11px] text-fuchsia-200/80">{gpuInfo.gpu}</p>
              )}
              {gpuInfo.status && (
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#faf9f6]/40">
                    STATUS
                  </p>
                  <pre className="overflow-x-auto rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-[11px] leading-relaxed text-[#faf9f6]/75">
                    {gpuInfo.status}
                  </pre>
                </div>
              )}
              {gpuInfo.logTail && (
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#faf9f6]/40">
                    {gpuInfo.logName || "log"}
                  </p>
                  <pre className="max-h-64 overflow-auto rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-[11px] leading-relaxed text-[#faf9f6]/75">
                    {gpuInfo.logTail}
                  </pre>
                </div>
              )}
              {gpuInfo.sshAttach && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(gpuInfo.sshAttach);
                    setGpuError("Copied ssh attach command to clipboard");
                  }}
                  title="Copy: SSH into the remote GPU tmux"
                  className="block w-full overflow-x-auto rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-left font-mono text-[11px] text-[#faf9f6]/55 transition hover:text-[#faf9f6]/80"
                >
                  $ {gpuInfo.sshAttach}
                </button>
              )}
            </div>
          )}
        </div>

	          {/* Run-supervisor tmux sessions — advanced only (raw debugging surface). */}
	          {advanced && (
	          <div className="mt-6">
	            <div className="mb-2 flex items-center gap-2 text-[11px] text-cyan-200/55">
	              <Terminal className="h-3.5 w-3.5" aria-hidden />
	              <h3 className="font-medium uppercase tracking-normal">Run supervisors</h3>
	              <span className="font-mono text-[#faf9f6]/35">{runSessions.length}</span>
	            </div>
	            <p className="mb-2 text-[11px] text-[#faf9f6]/35">
	              Local SSH watchers; training runs in remote tmux <span className="font-mono">arq</span>.
	            </p>
	            {renderSessionList(runSessions, "No run supervisors active.")}
	          </div>
	          )}
	        </section>

	        {/* ================= SECTION 3 · OTHER SESSIONS ================= */}
	        {/* Hidden in Simple mode — raw tmux sessions are a power-user surface. */}
	        {advanced && (
	        <section className="mt-16 w-full max-w-4xl">
	          <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/10 pb-4">
	            <div className="flex min-w-0 items-center gap-2.5">
	              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-[#faf9f6]/60">
	                <Terminal className="h-4 w-4" aria-hidden />
	              </span>
	              <div>
	                <h2 className="text-sm font-semibold uppercase tracking-normal text-[#faf9f6]/75">
	                  Other tmux
	                </h2>
	                <p className="text-[11px] text-[#faf9f6]/40">
	                  Sessions outside the main loop.
	                </p>
	              </div>
	            </div>
	            <button
	              type="button"
	              onClick={refreshSessions}
	              aria-label="Refresh tmux sessions"
	              title="Refresh tmux sessions"
	              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-[#faf9f6]/55 transition hover:border-white/25 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20"
	            >
	              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
	            </button>
	          </div>

          {sessionMsg && <p className="mb-2 text-xs text-red-300">{sessionMsg}</p>}
          {sessionLoadError && (
            <p className="mb-2 text-xs text-orange-300">{sessionLoadError}</p>
          )}

          {renderSessionList(otherSessions, "No other tmux sessions.")}
        </section>
        )}

        {/* ===== SECTION 4 · RECORD TIMELINE (lead of the results view) ===== */}
        <ResearchRecords data={recordsApi} />

	        {/* ===== SECTION 5 · ALL EXPERIMENTS (merged: ran + closed, filtered) ===== */}
	        {/* Hidden in Simple mode — collapses the long experiment log. */}
	        {advanced && (
	        <section className="mt-12 w-full max-w-4xl">
	          <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/10 pb-4">
	            <div className="flex min-w-0 items-center gap-2.5">
	              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-200">
	                <FileText className="h-4 w-4" aria-hidden />
	              </span>
	              <div>
	                <h2 className="text-sm font-semibold uppercase tracking-normal text-emerald-100">
	                  All experiments
	                </h2>
	                <p className="text-[11px] text-[#faf9f6]/40">
	                  Ran and closed ideas, newest first.
	                </p>
	              </div>
	            </div>
	            <span className="shrink-0 rounded-md border border-emerald-300/20 bg-emerald-300/[0.06] px-2 py-1 font-mono text-xs text-emerald-200/75">
	              {allCount}
	            </span>
	          </div>

          {/* Verdict filter chips */}
          <div className="mb-4 flex flex-wrap gap-2">
            {EXP_CHIPS.map((chip) => {
              const active = expFilter === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => {
                    setExpFilter(chip.id);
                    setShowAllFinished(false);
                  }}
                  title={`Show ${chip.label.toLowerCase()} experiments`}
	                  className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition focus:outline-none ${
	                    active
	                      ? "border-emerald-300/35 bg-emerald-300/[0.12] text-emerald-100"
	                      : "border-white/10 bg-white/[0.02] text-[#faf9f6]/45 hover:border-white/25 hover:text-[#faf9f6]/75"
	                  }`}
	                >
                  {chip.label}
                  <span className="ml-1.5 font-mono tabular-nums opacity-60">{chip.n}</span>
                </button>
              );
            })}
          </div>

          {expTotal === 0 ? (
            <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-6 text-center text-sm text-[#faf9f6]/40">
              Nothing here yet.
            </p>
          ) : (
            <>
              <ul className="space-y-2">
                {ideaShown.map((idea) => (
                  <IdeaCard key={idea.id} idea={idea} showResult={false} {...ideaCardShared} />
                ))}
                {closedShownExp.map((c, i) => {
                  const isReject = closedBucket(c.verdict) === "reject";
                  return (
                    <li
                      key={`closed-${c.slug}-${i}`}
                      className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium text-[#faf9f6]/85" title={c.slug}>
                          {c.slug}
                        </span>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] ${
                            isReject
                              ? "border-red-300/25 bg-red-300/[0.06] text-red-200/80"
                              : "border-white/15 bg-white/[0.04] text-[#faf9f6]/55"
                          }`}
                        >
                          {isReject ? "Rejected" : "No change"}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between font-mono text-[10px] tabular-nums text-[#faf9f6]/40">
                        <span>{c.val != null ? `val ${c.val.toFixed(4)}` : "val —"}</span>
                        <span>{c.date}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {expTotal > expTotalShown && (
                <button
                  type="button"
                  onClick={() => setShowAllFinished(true)}
                  title="Show the rest of the finished experiments"
                  className="mt-3 w-full rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#faf9f6]/45 transition hover:border-white/20 hover:text-[#faf9f6]/75 focus:outline-none focus:ring-2 focus:ring-emerald-300/20"
                >
                  Show {expTotal - expTotalShown} more
                </button>
              )}
              {showAllFinished && expTotal > EXP_PREVIEW && (
                <button
                  type="button"
                  onClick={() => setShowAllFinished(false)}
                  title="Collapse the finished experiments list"
                  className="mt-3 w-full text-xs uppercase tracking-[0.18em] text-[#faf9f6]/35 transition hover:text-[#faf9f6]/65"
                >
                  Collapse
                </button>
              )}
            </>
          )}
        </section>
        )}
        </>
        ) : null}
      </div>

        <MarkdownPanel
          path={openFile?.path ?? null}
          title={openFile?.title ?? ""}
          onClose={() => setOpenFile(null)}
        />
      </main>
      )}
      {/* Watchdog agent dock — floating opener + right panel, fixed-positioned
          so it rides above the dashboard regardless of the active view. */}
      <MonitorPanel />
    </div>
  );
}
