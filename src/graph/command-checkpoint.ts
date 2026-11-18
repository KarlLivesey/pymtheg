// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import type { SqliteGraphStore } from "./store.js";
import type { CapturedPath } from "./command-snapshot.js";
export const checkpointSchema = "pymtheg.graph-complete/v1";
export interface CommandMetadata {
  files: ReturnType<SqliteGraphStore["fileInventory"]>;
  contexts: ReturnType<SqliteGraphStore["contextInventory"]>;
  counts: ReturnType<SqliteGraphStore["counts"]>;
}
export interface CommandCheckpoint extends CommandMetadata {
  schema: typeof checkpointSchema;
  projectId: string;
  fingerprint: string;
  inventory: CapturedPath[];
  configuration: unknown;
  settings: unknown;
}
export const zeroCounts = () => ({
  files: 0,
  symbols: 0,
  links: 0,
  failed: 0,
  partial: 0,
  unresolved: 0,
  ambiguous: 0,
  library: 0,
});
export function readMetadata(store: SqliteGraphStore | null): CommandMetadata {
  return {
    files: store?.fileInventory() ?? [],
    contexts: store?.contextInventory() ?? [],
    counts: store?.counts() ?? zeroCounts(),
  };
}
/** Only a small metadata record is read on the warm path, never graph_files.body. */
export function readCheckpoint(
  store: SqliteGraphStore | null,
): CommandCheckpoint | null {
  try {
    const value =
      store?.graphCommandState() as Partial<CommandCheckpoint> | null;
    if (
      !value ||
      value.schema !== checkpointSchema ||
      value.projectId !== store?.projectId ||
      typeof value.fingerprint !== "string" ||
      !Array.isArray(value.inventory) ||
      !Array.isArray(value.files) ||
      !Array.isArray(value.contexts) ||
      !value.counts
    )
      return null;
    if (
      !Object.keys(zeroCounts()).every(
        (key) =>
          Number.isSafeInteger(
            value.counts![key as keyof CommandMetadata["counts"]],
          ) && value.counts![key as keyof CommandMetadata["counts"]] >= 0,
      )
    )
      return null;
    if (
      !value.files.every(
        (file) =>
          file &&
          typeof file.path === "string" &&
          typeof file.hash === "string" &&
          typeof file.module === "string" &&
          typeof file.version === "string" &&
          typeof file.cacheable === "boolean" &&
          ["clean", "partial", "failed"].includes(file.status),
      )
    )
      return null;
    if (
      !value.contexts.every(
        (file) =>
          file &&
          typeof file.path === "string" &&
          typeof file.hash === "string" &&
          ["clean", "failed"].includes(file.status),
      )
    )
      return null;
    if (
      !value.inventory.every(
        (file) =>
          file &&
          typeof file.path === "string" &&
          typeof file.hash === "string" &&
          (typeof file.module === "string" || file.module === null) &&
          typeof file.context === "boolean" &&
          (typeof file.reason === "string" || file.reason === null),
      )
    )
      return null;
    const state = value as CommandCheckpoint;
    if (
      fingerprint(
        state.projectId,
        state.configuration,
        state.settings,
        state.inventory,
        state,
      ) !== state.fingerprint
    )
      return null;
    return state;
  } catch {
    return null;
  }
}
export function fingerprint(
  projectId: string | undefined,
  configuration: unknown,
  settings: unknown,
  inventory: CapturedPath[],
  metadata: CommandMetadata,
): string {
  const digest = createHash("sha256");
  digest.update(
    JSON.stringify({
      schema: checkpointSchema,
      projectId,
      configuration,
      settings,
      counts: metadata.counts,
    }),
  );
  for (const [kind, records] of [
    ["inventory", inventory],
    ["files", metadata.files],
    ["contexts", metadata.contexts],
  ] as const) {
    digest.update(kind);
    for (const record of records) digest.update(JSON.stringify(record) + "\n");
  }
  return digest.digest("hex");
}
