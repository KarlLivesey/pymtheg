import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { contentHash } from "./identity.js";
import type { Json } from "./types.js";
import type { CapturedPath } from "./command-snapshot.js";
import { installation, runHelper } from "./languages/go/toolchain.js";

/** One toolchain route's state for a command answer (W3-L2). */
export interface ToolchainModuleState {
  /** used: facts merged; unavailable: source-only, with the reason; not-indexed: no index with the setting yet. */
  state: "used" | "unavailable" | "not-indexed";
  reason?: string;
  /**
   * What the facts were computed from: the Go route's cache key, or
   * "unavailable:<reason>". A warm query recomputes it (goToolchainKey).
   */
  key?: string;
  go?: string;
  version?: string;
  configuration?: string;
  cached?: boolean;
  packages?: { total: number; clean: number };
  universeClean?: boolean;
  errors?: string[];
  /** Links the toolchain made definite (from unresolved, candidates or failed). */
  upgradedLinks?: number;
  /** Source-only definite links the toolchain confirmed. */
  confirmedLinks?: number;
  /** Candidate sets (or unresolved dispatch) the toolchain verified. */
  verifiedSets?: number;
  /** Definite targets the source-only route had and the toolchain disagreed with. */
  disagreements?: number;
}
export interface ToolchainState {
  setting: Record<string, boolean | string>;
  go: ToolchainModuleState;
}

/** The Go route's state, from the index report's toolchain notes. */
export function toolchainState(
  setting: Record<string, boolean | string>,
  notes: readonly { module: string; note: Json }[] | undefined,
): ToolchainState {
  const own = (notes ?? [])
    .filter((item) => item.module === "go")
    .map((item) => item.note as Record<string, unknown>);
  const unavailable = own.find((note) => note.status === "unavailable");
  if (unavailable)
    return {
      setting,
      go: {
        state: "unavailable",
        reason: String(unavailable.reason),
        key: `unavailable:${String(unavailable.reason)}`,
      },
    };
  const available = own.find((note) => note.status === "available");
  const merged = own.find((note) => note.status === "merged");
  if (!available)
    return {
      setting,
      go: { state: "unavailable", reason: "no toolchain report" },
    };
  const decided = (merged?.decided ?? {}) as Record<string, number>;
  let upgraded = 0,
    confirmed = 0,
    verified = 0;
  for (const [key, count] of Object.entries(decided)) {
    const [upgrade, from] = key.split(":");
    if (upgrade === "verified") verified += count;
    else if (upgrade === "definite" && from === "definite") confirmed += count;
    else if (upgrade === "definite") upgraded += count;
  }
  return {
    setting,
    go: {
      state: "used",
      key: String(available.key),
      go: String(available.go),
      version: String(available.version),
      configuration: String(available.configuration),
      cached: available.cached === true,
      packages: available.packages as { total: number; clean: number },
      universeClean: available.universeClean === true,
      errors: (available.errors as string[] | undefined) ?? [],
      upgradedLinks: upgraded,
      confirmedLinks: confirmed,
      verifiedSets: verified,
      disagreements: Array.isArray(merged?.disagreements)
        ? merged.disagreements.length
        : 0,
    },
  };
}

/**
 * The Go route's key for the project as it is now, computed as the Go
 * module's analysis would: the installation, then the helper's fingerprint
 * pass over the captured Go files (read from disk; their hashes must match
 * the inventory). With unchanged inputs that is one `go list` (the helper's
 * facts are reused); with changed inputs the helper runs and its facts are
 * kept for the index that follows. Null when it cannot be computed: the
 * caller then syncs. Never decides "unchanged" on its own.
 */
export async function goToolchainKey(
  root: string,
  setting: boolean | string,
  inventory: readonly CapturedPath[],
  workDir: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    if (!inventory.some((file) => file.path === "go.mod" && file.context))
      return "unavailable:no go.mod at the project root";
    if (inventory.some((file) => file.path === "go.work" && file.context))
      return "unavailable:go.work workspaces are not supported yet";
    const dir = join(workDir, "go");
    const install = await installation(setting, process.env, dir, signal);
    if ("unavailable" in install) return `unavailable:${install.unavailable}`;
    const sources: { path: string; text: string; hash: string }[] = [];
    for (const file of inventory) {
      if (file.module !== "go" || !file.path.endsWith(".go")) continue;
      if (file.reason) return null;
      const bytes = await readFile(join(root, file.path));
      if (contentHash(bytes) !== file.hash) return null;
      sources.push({
        path: file.path,
        text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        hash: file.hash,
      });
    }
    const run = await runHelper(
      await realpath(root),
      install,
      sources,
      dir,
      signal,
    );
    return "unavailable" in run ? `unavailable:${run.unavailable}` : run.key;
  } catch (error) {
    signal?.throwIfAborted();
    void error;
    return null;
  }
}
