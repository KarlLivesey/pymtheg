import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { identity } from "../shared/identity.js";
import { analyseFile } from "../analysis/index.js";
import { runBackend, type BackendOptions } from "../backends/adapter.js";
import { openDatabase } from "../storage/local.js";
type Check = {
  name: string;
  status: "ready" | "missing" | "incompatible" | "failed";
  detail: string;
};
const require = createRequire(import.meta.url);
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
/** The Tree-sitter grammars the code graph loads (TypeScript uses its compiler). */
async function grammars(): Promise<Check[]> {
  const files: [string, () => string][] = [
    [
      "Go grammar",
      () =>
        fileURLToPath(
          new URL("../../grammars/go/tree-sitter-go.wasm", import.meta.url),
        ),
    ],
    [
      "Rust grammar",
      () => require.resolve("tree-sitter-rust/tree-sitter-rust.wasm"),
    ],
  ];
  let Language: typeof import("web-tree-sitter").Language;
  try {
    const sitter = await import("web-tree-sitter");
    await sitter.Parser.init({
      locateFile: () => require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
    });
    Language = sitter.Language;
  } catch (e) {
    return files.map(([name]) => ({
      name,
      status: "missing",
      detail: "Tree-sitter runtime unavailable: " + String(e),
    }));
  }
  const checks: Check[] = [];
  for (const [name, locate] of files) {
    try {
      const path = locate();
      await Language.load(path);
      checks.push({ name, status: "ready", detail: path });
    } catch (e) {
      checks.push({ name, status: "missing", detail: String(e) });
    }
  }
  return checks;
}
export async function doctor(signal: AbortSignal) {
  const checks: Check[] = [];
  checks.push({
    name: "Node",
    status:
      Number(process.versions.node.split(".")[0]) === 24
        ? "ready"
        : "incompatible",
    detail: process.version + " (supported: 24 LTS)",
  });
  checks.push(...(await engines(signal)));
  checks.push(await storage());
  checks.push(...(await grammars()));
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
    checks.push({
      name: "Studio",
      status: "missing",
      detail: "Run npm run build",
    });
  }
  return { schema: "pymtheg.doctor/v1", version: identity.version, checks };
}
