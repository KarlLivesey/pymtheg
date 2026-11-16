// SPDX-License-Identifier: MIT
import { printLegacyNotice } from "../storage/legacy.js";
import { findProjectRoot, openDatabase } from "../storage/local.js";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { identity } from "../shared/identity.js";
import { analyseFile } from "../analysis/index.js";
import { runBackend, type BackendOptions } from "../backends/adapter.js";
import { discoverLanguages } from "../graph/registry.js";
import { indexProject } from "../graph/indexer.js";
import { SqliteGraphStore } from "../graph/store.js";
export type Check = {
  name: string;
  status: "ready" | "missing" | "incompatible" | "failed";
  detail: string;
};
/** Node 24 or newer is supported; there is no upper bound. */
export function nodeCheck(version: string = process.version): Check {
  const major = Number(/^v?(\d+)\./.exec(version)?.[1]);
  return Number.isInteger(major) && major >= 24
    ? {
        name: "Node",
        status: "ready",
        detail: `${version} (supported: 24 or newer)`,
      }
    : {
        name: "Node",
        status: "incompatible",
        detail: `${version} is not supported: Pymtheg needs Node 24 or newer`,
      };
}
/** A machine with one failing and one holding invariant; never written to disk. */
const probe = `machine DoctorProbe {
  state n: Nat in 0..2 = 0;
  event advance when n < 2 { n = n + 1; }
  invariant small = n < 2;
  invariant bounded = n <= 2;
}
`;
/** Runs the real built-in engines (lowering and search workers) on the probe. */
async function engines(signal: AbortSignal): Promise<Check[]> {
  const file = join(tmpdir(), `pymtheg-doctor-probe${identity.extension}`);
  let ir;
  try {
    ir = analyseFile(file, () => {}, { buffers: { [file]: probe } }).ir;
  } catch (e) {
    const detail = "Probe analysis failed: " + String(e);
    return [
      { name: "Verifier", status: "failed", detail },
      { name: "Simulator", status: "failed", detail },
    ];
  }
  const options: BackendOptions = {
    entry: "DoctorProbe",
    seed: "42",
    maxSteps: 6,
    maxSamples: 20,
    timeoutMs: 30000,
    scopeFile: null,
  };
  const run = async (
    name: string,
    method: "exhaustive" | "sample",
  ): Promise<Check> => {
    try {
      const records = await runBackend(ir, { ...options, method }, signal);
      const outcome = (property: string) =>
        records.find((r) => r.propertyId.endsWith("/invariant/" + property))
          ?.outcome;
      const expected =
        outcome("small") === "counterexample" &&
        (method === "sample" || outcome("bounded") === "no_counterexample");
      return expected
        ? {
            name,
            status: "ready",
            detail:
              method === "sample"
                ? "Built-in seeded sampler found the probe's known counterexample"
                : "Built-in breadth-first search gave the probe's known verdicts",
          }
        : records.some((r) => r.completion === "failed")
          ? {
              name,
              status: "failed",
              detail:
                "The built-in engine worker failed: " +
                [
                  ...new Set(
                    records
                      .filter((r) => r.completion === "failed")
                      .flatMap((r) => r.diagnostics.map((d) => d.message)),
                  ),
                ].join("; "),
            }
          : {
              name,
              status: "failed",
              detail:
                "Probe verdicts were wrong: " +
                records
                  .map((r) => `${r.propertyId}=${r.outcome}/${r.completion}`)
                  .join(", "),
            };
    } catch (e) {
      return { name, status: "failed", detail: String(e) };
    }
  };
  return [
    await run("Verifier", "exhaustive"),
    await run("Simulator", "sample"),
  ];
}
async function storage(): Promise<Check> {
  try {
    const db = openDatabase(":memory:");
    try {
      db.exec("CREATE TABLE probe (x INTEGER); INSERT INTO probe VALUES (1);");
      const row = db.prepare("SELECT x FROM probe").get() as { x: number };
      if (row.x !== 1) throw Error("SQLite round trip returned wrong value");
    } finally {
      db.close();
    }
    return {
      name: "Storage",
      status: "ready",
      detail: "Built-in node:sqlite available",
    };
  } catch (e) {
    return { name: "Storage", status: "missing", detail: String(e) };
  }
}
/** One small source per production language module; each must index clean. */
const graphProbes: Record<
  string,
  { label: string; file: string; text: string }
> = {
  go: {
    label: "Go",
    file: "probe.go",
    text: "package probe\nfunc Probe() {}\n",
  },
  rust: { label: "Rust", file: "probe.rs", text: "pub fn probe() {}\n" },
  typescript: {
    label: "TypeScript",
    file: "probe.ts",
    text: "export function probe() {}\n",
  },
};
/**
 * Indexes the probe files through the production language registry, indexer
 * and graph store, so each module loads exactly the grammar (or compiler) the
 * code graph uses; nothing here names a grammar path.
 */
async function codeGraph(): Promise<Check[]> {
  const name = (id: string) => `${graphProbes[id]?.label ?? id} code graph`;
  let registry;
  try {
    registry = await discoverLanguages();
  } catch (e) {
    return [
      {
        name: "Code graph",
        status: "failed",
        detail: "Language modules unavailable: " + String(e),
      },
    ];
  }
  const ids = registry.modules.map((m) => m.id);
  const checks: Check[] = ids
    .filter((id) => !graphProbes[id])
    .map((id) => ({
      name: name(id),
      status: "failed",
      detail: "doctor has no probe for this language module",
    }));
  const probed = ids.filter((id) => graphProbes[id]);
  const root = await mkdtemp(join(tmpdir(), "pymtheg-doctor-graph-"));
  const store = new SqliteGraphStore(":memory:", "doctor-probe");
  try {
    for (const id of probed)
      await writeFile(join(root, graphProbes[id]!.file), graphProbes[id]!.text);
    let report;
    try {
      report = await indexProject(root, registry, store);
    } catch (e) {
      return [
        ...checks,
        ...probed.map((id) => ({
          name: name(id),
          status: "failed" as const,
          detail: "Indexing failed: " + String(e),
        })),
      ];
    }
    const failed = new Map(
      ((await store.failedFiles?.()) ?? []).map((f) => [f.path, f.reason]),
    );
    const symbols = await store.findSymbols();
    for (const id of probed) {
      const path = graphProbes[id]!.file;
      const file = await store.getFile(path);
      const count = symbols.filter((s) => s.file === path).length;
      const problem =
        failed.get(path) ??
        report.errors.find((e) => e.path === path)?.message ??
        report.analysisErrors.find((e) => e.module === id)?.message ??
        (!file
          ? "probe file was not indexed"
          : file.module !== id
            ? `probe file was claimed by ${file.module}`
            : file.result.status !== "clean"
              ? `probe parsed ${file.result.status}: ${file.result.diagnostics[0]?.message ?? ""}`
              : count === 0
                ? "probe produced no symbols"
                : null);
      checks.push(
        problem
          ? { name: name(id), status: "failed", detail: problem }
          : {
              name: name(id),
              status: "ready",
              detail: `Indexed a one-line ${path} (${count} symbol${count === 1 ? "" : "s"})`,
            },
      );
    }
    return checks;
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
}
export async function doctor(
  signal: AbortSignal,
  options: { nodeVersion?: string } = {},
) {
  printLegacyNotice(findProjectRoot(process.cwd()));
  const checks: Check[] = [nodeCheck(options.nodeVersion)];
  checks.push(...(await engines(signal)));
  checks.push(await storage());
  checks.push(...(await codeGraph()));
  try {
    await stat(
      fileURLToPath(new URL("../../dist-web/index.html", import.meta.url)),
    );
    checks.push({
      name: "Studio",
      status: "ready",
      detail: "Built GUI available",
    });
  } catch {
    // A source checkout has src/ and tsconfig.json beside dist/; an installed
    // package does not (package.json `files` ships neither).
    const checkout = ["../../tsconfig.json", "../../src/cli/main.ts"].every(
      (path) => existsSync(fileURLToPath(new URL(path, import.meta.url))),
    );
    checks.push({
      name: "Studio",
      status: "missing",
      detail: checkout
        ? "The Studio build (dist-web) is missing: run npm run build in this source checkout"
        : "The Studio build (dist-web) is missing from the installed package: reinstall Pymtheg",
    });
  }
  return {
    schema: "pymtheg.doctor/v1",
    version: identity.version,
    /**
     * Every required check ready; the CLI exits 3 otherwise. The Studio build is
     * reported but optional: check, verify, simulate, MCP and the graph work
     * without it, and a source checkout has it only after `npm run build`.
     */
    ready: checks.every((c) => c.status === "ready" || c.name === "Studio"),
    checks,
  };
}
