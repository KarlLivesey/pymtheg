// SPDX-License-Identifier: MIT
import { workspaceSchema } from "../../src/shared/workspace";
import { readRecipeFormDraft } from "../../src/studio/recipes";
import { readInterfaceDraft } from "../../src/studio/interface-data";
import { isCallableShape } from "../../src/studio/shapes";
import { projectConfig } from "../../src/shared/config";
import validateReport from "./generated/report.js";
import type { Report } from "../../src/reporting/report";
import type {
  ProjectView,
  StudioRun,
  StudioEvent,
  StudioFile,
} from "../../src/studio/protocol";

const record = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
export function report(value: unknown): Report {
  if (!validateReport(value))
    throw Error("This report does not match the Pymtheg evidence schema.");
  return value;
}
const span = (v: unknown) =>
  record(v) &&
  typeof v.file === "string" &&
  Number.isSafeInteger(v.start) &&
  Number.isSafeInteger(v.end) &&
  Number(v.start) >= 0 &&
  Number(v.end) >= Number(v.start);
const symbol = (v: unknown) =>
  record(v) &&
  typeof v.id === "string" &&
  typeof v.name === "string" &&
  typeof v.kind === "string" &&
  typeof v.signature === "string" &&
  span(v.span) &&
  (v.headerEnd === undefined ||
    (Number.isSafeInteger(v.headerEnd) &&
      Number(v.headerEnd) >=
        Number((v.span as Record<string, unknown>).start) &&
      Number(v.headerEnd) <=
        Number((v.span as Record<string, unknown>).end))) &&
  (v.visibleFrom === undefined ||
    (Array.isArray(v.visibleFrom) &&
      v.visibleFrom.every((file) => typeof file === "string"))) &&
  (v.callable === undefined || isCallableShape(v.callable)) &&
  (v.machineDomains === undefined ||
    (record(v.machineDomains) &&
      Object.values(v.machineDomains).every((v) => typeof v === "string"))) &&
  (!v.states ||
    (Array.isArray(v.states) &&
      v.states.every((s) => typeof s === "string"))) &&
  (!v.terminal ||
    (Array.isArray(v.terminal) &&
      v.terminal.every((s) => typeof s === "string"))) &&
  (!v.transitions ||
    (Array.isArray(v.transitions) &&
      v.transitions.every(
        (t) =>
          record(t) && typeof t.from === "string" && typeof t.to === "string",
      )));
export function run(value: unknown): StudioRun {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    !Number.isSafeInteger(value.sequence) ||
    !["running", "completed", "cancelled", "superseded", "failed"].includes(
      String(value.status),
    ) ||
    !record(value.request) ||
    typeof value.request.file !== "string" ||
    typeof value.request.clientId !== "string" ||
    typeof value.request.revision !== "number" ||
    !Array.isArray(value.symbols) ||
    !value.symbols.every(symbol) ||
    typeof value.phase !== "string" ||
    !(value.error === null || typeof value.error === "string") ||
    !(value.report === null || validateReport(value.report))
  )
    throw Error("Invalid run response.");
  return value as unknown as StudioRun;
}
export function sourceFile(value: unknown): StudioFile {
  if (
    !record(value) ||
    typeof value.path !== "string" ||
    typeof value.text !== "string" ||
    typeof value.hash !== "string" ||
    (value.loaded !== undefined && typeof value.loaded !== "boolean")
  )
    throw Error("Invalid source file response");
  return value as unknown as StudioFile;
}
export function project(value: unknown): ProjectView {
  if (
    !record(value) ||
    typeof value.root !== "string" ||
    (value.inventoryWarnings !== undefined &&
      (!Array.isArray(value.inventoryWarnings) ||
        !value.inventoryWarnings.every((v) => typeof v === "string"))) ||
    (value.architectureAvailable !== undefined &&
      typeof value.architectureAvailable !== "boolean") ||
    (value.outputTargets !== undefined &&
      (!Array.isArray(value.outputTargets) ||
        !value.outputTargets.every(
          (t) =>
            record(t) &&
            typeof t.id === "string" &&
            typeof t.label === "string" &&
            typeof t.builtin === "boolean",
        ))) ||
    !Array.isArray(value.files) ||
    !value.files.every(
      (f) =>
        record(f) &&
        typeof f.path === "string" &&
        typeof f.text === "string" &&
        typeof f.hash === "string" &&
        (f.loaded === undefined || typeof f.loaded === "boolean"),
    ) ||
    !Array.isArray(value.runs) ||
    !record(value.agentConnection) ||
    typeof value.agentConnection.command !== "string" ||
    !Array.isArray(value.agentConnection.args) ||
    !value.agentConnection.args.every((a) => typeof a === "string")
  )
    throw Error("Invalid project response.");
  if (
    !record(value.recovery) ||
    !Number.isSafeInteger(value.recovery.revision) ||
    !Array.isArray(value.recovery.drafts) ||
    !value.recovery.drafts.every(
      (d) =>
        record(d) &&
        typeof d.path === "string" &&
        typeof d.text === "string" &&
        (typeof d.baseHash === "string" || d.baseHash === null),
    ) ||
    typeof value.recovery.enabled !== "boolean"
  )
    throw Error("Invalid recovery response");
  if (
    record(value.recovery.context) &&
    value.recovery.context.interfaceDraft != null
  )
    readInterfaceDraft(value.recovery.context.interfaceDraft);
  if (
    record(value.recovery.context) &&
    value.recovery.context.newDesign != null
  )
    readRecipeFormDraft(value.recovery.context.newDesign);
  if (value.workspace !== undefined && value.workspace !== null)
    workspaceSchema.parse(value.workspace);
  value.runs.forEach(run);
  projectConfig(value.config);
  return value as unknown as ProjectView;
}
export function token(): string {
  const value = new URLSearchParams(location.hash.slice(1)).get("token");
  if (value) {
    sessionStorage.setItem("pymtheg-session", value);
    history.replaceState(null, "", location.pathname);
  }
  return value ?? sessionStorage.getItem("pymtheg-session") ?? "";
}
const session = token();
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly conflictKind?: "architecture" | "request" | undefined,
  ) {
    super(message);
  }
}
export async function api(
  path: string,
  data?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch("/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Bearer " + session,
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    ...(signal ? { signal } : {}),
  });
  const value: unknown = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      record(value) && typeof value.error === "string"
        ? value.error
        : `Request failed (${response.status})`,
      record(value) &&
      (value.conflictKind === "architecture" ||
        value.conflictKind === "request")
        ? value.conflictKind
        : undefined,
    );
  return value;
}
export async function events(
  onEvent: (event: StudioEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/events", {
    headers: { Authorization: "Bearer " + session },
    signal,
  });
  if (!response.ok || !response.body)
    throw Error("Could not connect to the workspace event stream.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      pending += decoder.decode(next.value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (!line) continue;
        const value: unknown = JSON.parse(line);
        if (record(value) && value.kind === "run")
          onEvent({ kind: "run", run: run(value.run) });
        else if (
          record(value) &&
          value.kind === "recovery" &&
          Number.isSafeInteger(value.revision) &&
          (value.owner === null || typeof value.owner === "string")
        )
          onEvent(value as unknown as StudioEvent);
        else if (
          record(value) &&
          value.kind === "saved" &&
          record(value.file) &&
          typeof value.file.path === "string" &&
          typeof value.file.text === "string" &&
          typeof value.file.hash === "string"
        )
          onEvent(value as unknown as StudioEvent);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
