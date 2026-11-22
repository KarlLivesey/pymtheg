// SPDX-License-Identifier: MIT
import type { Report } from "../reporting/report.js";
import type { Span } from "../shared/identity.js";
export interface StudioFile {
  path: string;
  text: string;
  hash: string;
  exists?: boolean;
  loaded?: boolean;
}
export interface SymbolView {
  id: string;
  name: string;
  kind: string;
  span: Span;
  signature: string;
  headerEnd?: number;
  visibleFrom?: string[];
  callable?: import("./shapes.js").CallableShape;
  machineDomains?: Record<string, string>;
  references?: Span[];
  states?: string[];
  terminal?: string[];
  initial?: string;
  transitions?: { from: string; to: string }[];
}
export interface RunRequest {
  scope?: Record<string, unknown>;
  timeoutMs?: number;
  clientId: string;
  revision: number;
  file: string;
  buffers: Record<string, string>;
  kind: "check" | "simulate" | "verify";
  entry: string;
  seed: string;
  maxSteps: number;
  maxSamples: number;
}
export interface StudioRun {
  sequence: number;
  id: string;
  request: RunRequest;
  status: "running" | "completed" | "cancelled" | "superseded" | "failed";
  phase: string;
  report: Report | null;
  symbols: SymbolView[];
  error: string | null;
  persistenceError?: string;
}
export interface ProjectView {
  workspace?: import("../shared/workspace.js").WorkspaceIdentity | null;
  /** D22: the trust that applies on this machine, for an initialised project. */
  trust?: import("../shared/config.js").TrustState;
  inventoryWarnings?: string[];
  outputTargets?: { id: string; label: string; builtin: boolean }[];
  agentConnection: {
    command: string;
    args: string[];
  };
  root: string;
  architectureAvailable?: boolean;
  files: StudioFile[];
  runs: StudioRun[];
  defaultFile: string | null;
  config: import("../shared/config.js").ProjectConfig;
  configHash: string | null;
  recovery: import("./recovery.js").RecoveryView;
}
export type StudioEvent =
  | { kind: "run"; run: StudioRun }
  | { kind: "saved"; file: StudioFile }
  | { kind: "recovery"; revision: number; owner: string | null };
