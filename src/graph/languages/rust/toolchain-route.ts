// SPDX-License-Identifier: MIT
/**
 * C-43: the Rust toolchain route for one analysis. Runs rust-analyzer (or
 * reads its cached index), joins the index to the snapshot's parsed links
 * and returns each link's checkout answer, with a report note saying what
 * happened. Source-only links stand wherever there is no answer.
 */
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ContextFile,
  GraphFile,
  Json,
  ToolchainRequest,
} from "../../types.js";
import { fileFacts } from "../../identity.js";
import { joinScip, type JoinOutcome } from "./toolchain-join.js";
import {
  installation,
  prepareRun,
  routeKey,
  runAnalyzer,
  sweepStaleRuns,
  type RunControls,
} from "./toolchain.js";

export interface RouteAnswers {
  /** Per file, per parsed link index: the checkout symbol id. */
  answers: Map<string, Map<number, string>>;
  /** Design B: each answered link's trace, and each function's. */
  traces: JoinOutcome["traces"];
  functionTraces: JoinOutcome["functionTraces"];
  rustAnalyzer: string;
  configuration: string;
}

/** Test hooks for the run (controlled clock and limit). */
let controls: RunControls = {};
export const setRunControls = (next: RunControls) => {
  controls = next;
};

/**
 * The route never makes the source-only result worse (C-43 review): any
 * failure other than cancellation is reported as `unavailable` with its
 * reason, and the source-only rows stand. A failure after the route's key
 * is known records that key (fifth review), so a warm query on an unchanged
 * checkout finds the index current instead of running the route again; any
 * change to an input of the key runs it again.
 */
export async function rustRoute(
  request: ToolchainRequest,
  projectId: string,
  files: readonly GraphFile[],
  contextFiles: readonly ContextFile[],
): Promise<RouteAnswers | undefined> {
  const known: { key?: string } = {};
  try {
    return await route(request, projectId, files, contextFiles, known);
  } catch (error) {
    if (request.signal?.aborted) throw error;
    request.note({
      status: "unavailable",
      reason: `the toolchain route failed: ${error instanceof Error ? error.message : String(error)}`,
      ...(known.key === undefined ? {} : { key: known.key }),
    });
    return undefined;
  }
}

async function route(
  request: ToolchainRequest,
  projectId: string,
  files: readonly GraphFile[],
  contextFiles: readonly ContextFile[],
  /** The route's key once it is known, for a failure after that point. */
  known: { key?: string },
): Promise<RouteAnswers | undefined> {
  const unavailable = (reason: string) => {
    request.note({
      status: "unavailable",
      reason,
      ...(known.key === undefined ? {} : { key: known.key }),
    });
    return undefined;
  };
  if (!contextFiles.some((file) => file.path === "Cargo.toml"))
    return unavailable("no Cargo.toml at the project root");
  const workDir = resolve(request.workDir, "rust");
  // Folders of runs that are no longer live (killed, or not cleaned up).
  await sweepStaleRuns(workDir);
  const install = await installation(
    request.setting,
    request.environment,
    workDir,
    request.signal,
  );
  if ("unavailable" in install) return unavailable(install.unavailable);
  let root: string;
  try {
    root = await realpath(resolve(request.root));
  } catch {
    return unavailable(`the project root ${request.root} cannot be read`);
  }
  const rust = files.filter(
    (file) => file.module === "rust" && file.path.endsWith(".rs"),
  );
  const contexts = contextFiles.map((file) => ({
    path: file.path,
    text: file.status === "clean" ? file.text : undefined,
  }));
  // The cheap checks, as the warm query's key makes them.
  const prepared = prepareRun(root, install, contexts, workDir);
  if ("unavailable" in prepared) return unavailable(prepared.unavailable);
  known.key = await routeKey(
    root,
    install,
    rust.map((file) => ({ path: file.path, hash: file.hash })),
    contexts,
    prepared,
    request.signal,
  );
  const run = await runAnalyzer(
    root,
    install,
    rust.map((file) => ({ path: file.path, text: file.text, hash: file.hash })),
    contexts,
    workDir,
    prepared,
    known.key,
    request.signal,
    controls,
  );
  if ("unavailable" in run) return unavailable(run.unavailable);
  // Decoded by the run, before it was cached (sixth review D).
  const documents = run.documents;
  // A library root rust-analyzer did not index: its files have no answers.
  const indexed = new Set(documents.map((doc) => doc.path));
  // The run checks roots before caching; a cached index is complete.
  const partial = [
    ...new Set([
      ...run.partial,
      ...run.facts.libraryRoots
        .filter((path) => !indexed.has(path))
        .map((path) => `crate root ${path} is not in the index`),
    ]),
  ];
  // Files where a proc macro failed to expand give no answers.
  const withheld = run.withheld;
  const joined = joinScip(
    documents,
    rust
      .filter(
        (file) => file.result.status !== "failed" && !(file.path in withheld),
      )
      .map((file) => ({
        path: file.path,
        text: file.text,
        result: file.result,
        symbolIds: fileFacts(projectId, file).symbols.map((s) => s.id),
      })),
    run.facts,
  );
  request.note({
    status: "available",
    rustAnalyzer: install.analyzer,
    version: install.analyzerVersion,
    rustc: install.rustcVersion,
    ...(install.rustupToolchain ? { toolchain: install.rustupToolchain } : {}),
    configuration: configurationFor(install, run.target),
    target: run.target,
    cached: run.cached,
    key: run.key,
    // An observation only; nothing depends on it.
    analyzerMs: Math.round(run.elapsedMs),
    documents: joined.documents,
    partial,
    withheld: withheld as unknown as Json,
    join: joined.counts as unknown as Json,
  });
  // A partial index answers no link: a missing build script output or
  // dependency can make rust-analyzer name another item of the same name.
  if (partial.length) return undefined;
  return {
    answers: joined.answers,
    traces: joined.traces,
    functionTraces: joined.functionTraces,
    rustAnalyzer: install.analyzerVersion,
    configuration: configurationFor(install, run.target),
  };
}

/** The configuration as it ran: the host, or the configured build target. */
const configurationFor = (
  install: { configuration: string; host: string },
  target: string,
) =>
  target === install.host
    ? install.configuration
    : install.configuration.replace(
        `${install.host} (host)`,
        `${target} ([build] target)`,
      );
