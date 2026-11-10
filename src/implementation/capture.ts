import { realpath, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { sourceFileByteLimit } from "../shared/source-limits.js";
import { SourceReadError, readSourceBytes } from "../shared/source-read.js";
import { decodeUtf8 } from "../shared/text.js";
import { hash } from "../shared/identity.js";
import { staleSourcesAsync } from "../language/project.js";
import { findWorkspace } from "../project/workspace.js";
import { runProcess } from "../backends/process.js";
import {
  readObservedGraph,
  type ObservedGraph,
  type ObservedSource,
} from "./schema.js";
import { implementationSourcePath } from "./files.js";
import { partitionSources, combinePartitions } from "./partitions.js";
import {
  observeInProcess,
  ObservationFallbackError,
} from "./capture-process.js";

export class ObservationInputError extends Error {}

export async function captureImplementation(
  root: string,
  paths: readonly string[],
  label: string,
  signal: AbortSignal,
  execution: {
    runnerURL?: URL;
    partitionBytes?: number;
    onReady?: () => void;
    heapMiB?: number;
  } = {},
): Promise<ObservedGraph> {
  signal.throwIfAborted();
  root = await realpath(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT")
      throw new ObservationInputError(
        "The project folder is no longer available. Reopen its current location before observing code.",
      );
    throw error;
  });
  if (!paths.length || paths.length > 10000)
    throw new ObservationInputError(
      "Select 1–10,000 TypeScript or JavaScript files to observe",
    );
  const files: ObservedSource[] = [];
  const known = new Set<string>();
  const omittedFiles: NonNullable<ObservedGraph["omittedFiles"]> = [];
  const omit = (path: string, bytes: number) =>
    omittedFiles.push({
      path,
      bytes,
      reason:
        "Not captured: exceeds the 2 MiB per-file code read limit. Exclude generated/vendor bundles or split the source file; any smaller selected files can still be captured.",
    });
  let bytes = 0;
  for (const requested of paths) {
    signal.throwIfAborted();
    const requestedFile = resolve(root, requested);
    const requestedPath = relative(root, requestedFile).replaceAll("\\", "/");
    if (
      isAbsolute(requestedPath) ||
      requestedPath === ".." ||
      requestedPath.startsWith("../")
    )
      throw new ObservationInputError(
        "Observed source is outside the project root",
      );
    const missing = (error: NodeJS.ErrnoException): never => {
      if (error.code === "ENOENT")
        throw new ObservationInputError(
          `Observed source file was not found: ${requestedPath}. Refresh the source-file list and choose an existing file.`,
        );
      throw error;
    };
    const file = await realpath(requestedFile).catch(missing);
    const path = relative(root, file).replaceAll("\\", "/");
    if (isAbsolute(path) || path === ".." || path.startsWith("../"))
      throw new ObservationInputError(
        "Observed source is outside the project root",
      );
    const status = await stat(file).catch(missing);
    if (status.isDirectory())
      throw new ObservationInputError(
        "Choose source files to capture. To browse a folder first, use observe --list --directory " +
          JSON.stringify(path || ".") +
          ".",
      );
    if (!implementationSourcePath(path))
      throw new ObservationInputError(
        "This reader supports TypeScript and JavaScript; other languages require an observed-graph provider",
      );
    if (known.has(path)) continue;
    known.add(path);
    if (status.size > sourceFileByteLimit) {
      omit(path, status.size);
      continue;
    }
    const raw = await readSourceBytes(file, signal).catch(async (error) => {
      signal.throwIfAborted();
      if (error instanceof SourceReadError && error.kind === "too-large") {
        omit(path, (await stat(file)).size);
        return null;
      }
      return missing(error as NodeJS.ErrnoException);
    });
    if (raw === null) continue;
    bytes += raw.length;
    if (bytes > 32 * 1024 * 1024)
      throw new ObservationInputError(
        "Observation exceeds 32 MiB of captured source",
      );
    const text = decodeUtf8(raw, path);
    files.push({ path, text, hash: hash(text) });
  }
  const workspace = await findWorkspace(root);
  const git = await runProcess("git", ["rev-parse", "HEAD"], {
    cwd: root,
    signal,
    timeoutMs: 5000,
    maxBytes: 1024,
  });
  const commit =
    git.kind === "exited" &&
    git.code === 0 &&
    /^[a-f0-9]{40,64}$/.test(git.stdout.trim())
      ? git.stdout.trim()
      : null;
  const status = commit
    ? await runProcess(
        "git",
        ["status", "--porcelain", "--", ...files.map((file) => file.path)],
        { cwd: root, signal, timeoutMs: 5000, maxBytes: 65536 },
      )
    : null;
  const version = {
    label,
    gitCommit: commit,
    dirty:
      !status ||
      status.kind !== "exited" ||
      status.code !== 0 ||
      status.stdout.length > 0,
  };
  const observe = (selected: ObservedSource[]) =>
    observeInProcess(
      selected,
      version,
      workspace?.workspace.id ?? null,
      signal,
      { ...execution, sourcePaths: files.map((f) => f.path) },
    );
  let graph: ObservedGraph;
  try {
    graph = await observe(files);
  } catch (error) {
    signal.throwIfAborted();
    const partitions = partitionSources(files, execution.partitionBytes);
    if (!(error instanceof ObservationFallbackError) || partitions.length < 2)
      throw error;
    const parts: ObservedGraph[] = [];
    for (const selected of partitions) {
      signal.throwIfAborted();
      parts.push(await observe(selected));
    }
    graph = combinePartitions(parts);
    graph.limitations.unshift(
      error.message +
        " A bounded partition fallback was used; only explicit static imports can be recovered across partitions, and other relationships remain unknown.",
    );
  }
  if (omittedFiles.length) {
    graph.omittedFiles = omittedFiles;
    graph.scope.files = [
      ...graph.scope.files,
      ...omittedFiles.map((f) => f.path),
    ].sort();
    graph.coverage = { declarations: "partial", relationships: "partial" };
    graph.completeness = "partial";
    graph.snapshotId = hash(
      graph.snapshotId + "\0" + JSON.stringify(omittedFiles),
    );
    graph.limitations.unshift(
      `${omittedFiles.length} of ${known.size} selected files were not captured because they exceed 2 MiB each: ${omittedFiles
        .slice(0, 10)
        .map((f) => f.path + " (" + f.bytes + " bytes)")
        .join(
          ", ",
        )}${omittedFiles.length > 10 ? "; additional paths are recorded in omittedFiles" : ""}. Omitted code remains unknown; exclude generated/vendor bundles or split the files.`,
    );
  }
  const stale = await staleSourcesAsync(
    files.map((file) => ({ file: resolve(root, file.path), hash: file.hash })),
    signal,
  );
  graph.staleFiles = stale.map((file) =>
    relative(root, file).replaceAll("\\", "/"),
  );
  if (stale.length) {
    graph.completeness = "partial";
    graph.coverage = { declarations: "partial", relationships: "partial" };
  }
  return graph;
}
