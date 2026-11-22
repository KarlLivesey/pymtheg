// SPDX-License-Identifier: MIT
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { contentHash } from "./identity.js";
import type { Json } from "./types.js";
import type { CapturedPath } from "./command-snapshot.js";
import { installation, runHelper } from "./languages/go/toolchain.js";
import {
  installation as rustInstallation,
  routeKey as rustRouteKey,
} from "./languages/rust/toolchain.js";
import { matchesPattern } from "./registry.js";

/** One toolchain route's state for a command answer (W3-L2). */
export interface ToolchainModuleState {
  /**
   * used: answers merged; partial: the toolchain ran but its index is
   * incomplete, so no answer is used (Rust); unavailable: source-only, with
   * the reason; not-indexed: no index with the setting yet.
   */
  state: "used" | "partial" | "unavailable" | "not-indexed";
  reason?: string;
  /**
   * What the answers were computed from: the route's cache key, or
   * "unavailable:<reason>". A warm query recomputes it.
   */
  key?: string;
  go?: string;
  /** Rust: the rust-analyzer binary, and its own version line. */
  rustAnalyzer?: string;
  version?: string;
  rustc?: string;
  configuration?: string;
  cached?: boolean;
  packages?: { total: number; clean: number };
  universeClean?: boolean;
  errors?: string[];
  /** Rust: why the index is partial. */
  partial?: string[];
  /** Links the toolchain made definite (from unresolved, candidates or failed). */
  upgradedLinks?: number;
  /** Source-only definite links the toolchain confirmed. */
  confirmedLinks?: number;
  /** Candidate sets (or unresolved dispatch) the toolchain verified. */
  verifiedSets?: number;
  /** Definite targets the source-only route had and the toolchain disagreed with. */
  disagreements?: number;
  /** Rust: answers a gate withheld, by gate. */
  withheld?: Record<string, number>;
  /** Rust: answers naming another crate, counted and never applied. */
  libraryAnswers?: number;
}
export interface ToolchainState {
  setting: Record<string, boolean | string>;
  go?: ToolchainModuleState;
  rust?: ToolchainModuleState;
}

const notesOf = (
  module: string,
  notes: readonly { module: string; note: Json }[] | undefined,
) =>
  (notes ?? [])
    .filter((item) => item.module === module)
    .map((item) => item.note as Record<string, unknown>);

function goState(
  notes: readonly { module: string; note: Json }[] | undefined,
): ToolchainModuleState {
  const own = notesOf("go", notes);
  const unavailable = own.find((note) => note.status === "unavailable");
  if (unavailable)
    return {
      state: "unavailable",
      reason: String(unavailable.reason),
      key: `unavailable:${String(unavailable.reason)}`,
    };
  const available = own.find((note) => note.status === "available");
  const merged = own.find((note) => note.status === "merged");
  if (!available)
    return { state: "unavailable", reason: "no toolchain report" };
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
  };
}

function rustState(
  notes: readonly { module: string; note: Json }[] | undefined,
): ToolchainModuleState {
  const own = notesOf("rust", notes);
  const unavailable = own.find((note) => note.status === "unavailable");
  if (unavailable)
    return {
      state: "unavailable",
      reason: String(unavailable.reason),
      key: `unavailable:${String(unavailable.reason)}`,
    };
  const available = own.find((note) => note.status === "available");
  if (!available)
    return {
      state: "unavailable",
      reason: "no Rust files",
      key: "unavailable:no Rust files",
    };
  const partial = (available.partial as string[] | undefined) ?? [];
  const join = (available.join ?? {}) as Record<string, number>;
  const common: ToolchainModuleState = {
    state: partial.length ? "partial" : "used",
    key: String(available.key),
    rustAnalyzer: String(available.rustAnalyzer),
    version: String(available.version),
    rustc: String(available.rustc),
    configuration: String(available.configuration),
    cached: available.cached === true,
    libraryAnswers: join["unapplied:library"] ?? 0,
  };
  if (partial.length)
    return {
      ...common,
      reason: `${partial[0]}${partial.length > 1 ? ` (and ${partial.length - 1} more)` : ""}`,
      partial: partial.slice(0, 20),
      upgradedLinks: 0,
      confirmedLinks: 0,
      disagreements: 0,
    };
  const merged = own.find((note) => note.status === "merged");
  const decided = (merged?.decided ?? {}) as Record<string, number>;
  const withheld: Record<string, number> = {};
  for (const [key, count] of Object.entries(decided))
    if (key.startsWith("withheld:")) withheld[key.slice(9)] = count;
  return {
    ...common,
    upgradedLinks:
      (decided["definite:unresolved"] ?? 0) +
      (decided["definite:candidates"] ?? 0),
    confirmedLinks: decided["definite:definite"] ?? 0,
    disagreements: decided["kept:source-only-differs"] ?? 0,
    withheld,
  };
}

/** Each enabled route's state, from the index report's toolchain notes. */
export function toolchainState(
  setting: Record<string, boolean | string>,
  notes: readonly { module: string; note: Json }[] | undefined,
): ToolchainState {
  return {
    setting,
    ...(setting.go !== undefined ? { go: goState(notes) } : {}),
    ...(setting.rust !== undefined ? { rust: rustState(notes) } : {}),
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

/**
 * The Rust route's key for the project as it is now, computed as the Rust
 * module's analysis would, without running rust-analyzer. A partial or used
 * index keys the same way; an unavailable route keys by its reason. Null
 * when it cannot be computed: the caller then syncs.
 */
export async function rustToolchainKey(
  root: string,
  setting: boolean | string,
  inventory: readonly CapturedPath[],
  contextPatterns: readonly string[],
  workDir: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const contexts: { path: string; text: string }[] = [];
    for (const file of inventory) {
      if (
        !file.context ||
        !contextPatterns.some((pattern) => matchesPattern(file.path, pattern))
      )
        continue;
      if (file.reason) return null;
      const bytes = await readFile(join(root, file.path));
      if (contentHash(bytes) !== file.hash) return null;
      contexts.push({
        path: file.path,
        text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      });
    }
    if (!inventory.some((file) => file.module === "rust"))
      return "unavailable:no Rust files";
    if (!contexts.some((file) => file.path === "Cargo.toml"))
      return "unavailable:no Cargo.toml at the project root";
    const dir = join(workDir, "rust");
    const install = await rustInstallation(setting, process.env, dir, signal);
    if ("unavailable" in install) return `unavailable:${install.unavailable}`;
    const sources: { path: string; hash: string }[] = [];
    for (const file of inventory) {
      if (file.module !== "rust" || !file.path.endsWith(".rs")) continue;
      if (file.reason) return null;
      sources.push({ path: file.path, hash: file.hash });
    }
    return await rustRouteKey(
      await realpath(root),
      install,
      sources,
      contexts,
      signal,
    );
  } catch (error) {
    signal?.throwIfAborted();
    void error;
    return null;
  }
}
