export type View = "home" | "analytics" | "documentation";

export type Session = {
  name: string;
  created: number;
  windows: number;
  agentLabel: string | null;
  agentCommand: string | null;
};

export type Result = {
  verdict: string;
  controlVal: number | null;
  treatmentVal: number | null;
  ctrl2Val: number | null;
  deltaCtrl: number | null;
  deltaCtrl2: number | null;
};

export type Idea = {
  id: string;
  title: string;
  status: string;
  plain: string;
  updated: string;
  created: number | null; // epoch ms first mined; drives the "added Xago" label
  path: string;
  evidencePath: string | null;
  result: Result | null;
};

export type GpuInfo = {
  host: string;
  status: string;
  tmuxAlive: boolean;
  gpu: string;
  logName: string;
  logTail: string;
  sshAttach: string;
};

export type GpuUsage = {
  name: string;
  utilization: number;
  memUsed: number;
  memTotal: number;
};

export type SessionTagKind = "codex" | "minimax" | "claude" | "shell" | "other";
