import { scopeIssueResult } from "../reporting/scope-issues.js";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { hash, finding, json, identity } from "../shared/identity.js";
import type { ProjectIR } from "../semantic/core.js";
import { result, type AnalysisResult } from "../reporting/report.js";
import {
  displayTrace,
  replay,
  sourceMappingValid,
  type GeneratedModel,
  type TraceState,
} from "../behaviour/model.js";
import { lowerInWorker } from "../behaviour/runner.js";
import { runProcess, type ProcessResult } from "./process.js";
export const quintVersion = "0.33.1";
export const tlcHash =
  "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88";
export interface BackendOptions {
  entry: string;
  backend: "quint" | "tlc";
  seed: string;
  maxSteps: number;
  maxSamples: number;
  timeoutMs: number;
  quint: string;
  tlcJar: string | null;
  scopeFile: string | null;
  scope?: unknown;
}
export function locateQuint(moduleUrl: string = import.meta.url): string {
  try {
    // Resolve through Node's package lookup: installed packages may be hoisted.
    return createRequire(moduleUrl).resolve(
      "@informalsystems/quint/dist/src/cli.js",
    );
  } catch {
    // Keep a concrete missing path so a requested optional backend fails explicitly.
    return fileURLToPath(new URL("../../node_modules/.bin/quint", moduleUrl));
  }
}
export const defaultQuint = locateQuint();
const object = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
async function readJson(file: string): Promise<unknown> {
  if ((await stat(file)).size > 16 * 1024 * 1024)
    throw Error("Backend artifact exceeds 16 MiB limit");
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}
export function parseItf(x: unknown, m: GeneratedModel): TraceState[] {
  if (!object(x) || !Array.isArray(x.states) || !Array.isArray(x.vars))
    throw Error("Malformed ITF envelope");
  const vars = [...m.variables.map((v) => v.generated), "eventId"];
  if (
    x.vars.length !== vars.length ||
    !vars.every((v) => (x.vars as unknown[]).includes(v))
  )
    throw Error("ITF variable set mismatch");
  if (x.states.length > 10001) throw Error("ITF trace length exceeds limit");
  const integer = (v: unknown): bigint => {
    if (
      !object(v) ||
      typeof v["#bigint"] !== "string" ||
      !/^[-]?\d+$/.test(v["#bigint"])
    )
      throw Error("ITF integer must be a decimal #bigint");
    return BigInt(v["#bigint"]);
  };
  return x.states.map((s: unknown) => {
    if (!object(s)) throw Error("Malformed ITF state");
    const id = integer(s.eventId);
    if (id < -2n || id >= BigInt(m.events.length))
      throw Error("ITF event ID out of range");
    const values: TraceState["values"] = Object.create(
      null,
    ) as TraceState["values"];
    for (const v of m.variables) {
      const raw = s[v.generated];
      values[v.source] = typeof raw === "boolean" ? raw : integer(raw);
    }
    return { values, event: Number(id) };
  });
}
export function parseTlcTrace(output: string, m: GeneratedModel): TraceState[] {
  const traces: TraceState[] = [];
  for (const part of output.split(/^State \d+:.*$/m).slice(1)) {
    const values: TraceState["values"] = Object.create(
      null,
    ) as TraceState["values"];
    let event: number | null = null;
    for (const line of part.split("\n")) {
      const match = /^\s*\/\\ (v\d+|eventId) = (-?\d+|TRUE|FALSE)\s*$/.exec(
        line,
      );
      if (!match) continue;
      const [, name, raw] = match;
      if (name === "eventId") {
        const n = BigInt(raw!);
        if (n < -2n || n >= BigInt(m.events.length))
          throw Error("TLC event out of range");
        event = Number(n);
      } else {
        const variable = m.variables.find((v) => v.generated === name);
        if (variable)
          values[variable.source] =
            raw === "TRUE" ? true : raw === "FALSE" ? false : BigInt(raw!);
      }
    }
    if (event === null || Object.keys(values).length !== m.variables.length)
      throw Error("Malformed TLC state");
    traces.push({ values, event });
  }
  if (!traces.length) throw Error("Missing TLC counterexample states");
  return traces;
}
async function runBackendInner(
  ir: ProjectIR,
  options: BackendOptions,
  signal: AbortSignal,
  cleanupErrors: string[],
  runner: typeof runProcess,
): Promise<AnalysisResult[]> {
  const d = ir.declarations.find((d) => d.name === options.entry),
    id = d?.id ?? options.entry,
    span = d?.span ?? { file: ir.snapshot.sources[0]!.file, start: 0, end: 0 };
  const failed = (
    category: string,
    message: string,
    completion: AnalysisResult["completion"] = "failed",
  ): AnalysisResult[] => [
    result(ir, id + "/backend", "behaviour", {
      outcome: "inconclusive",
      completion,
      method: options.backend === "quint" ? "simulation" : "finite_model_check",
      outstandingObligations: [message],
      diagnostics: [
        finding(
          category,
          message,
          span,
          completion === "failed" ? "error" : "warning",
        ),
      ],
      witnessValidation: "unvalidated",
      scope: { configurationHash: hash(json(options)) },
    }),
  ];
  if (signal.aborted) return failed("B130", "User cancelled", "cancelled");
  let scopeData: unknown = options.scope;
  try {
    if (options.scopeFile) scopeData = await readJson(options.scopeFile);
  } catch (e) {
    return failed("B101", String(e));
  }
  const plan = await lowerInWorker(ir, options.entry, scopeData ?? {}, signal);
  if (signal.aborted) return failed("B130", "User cancelled", "cancelled");
  if (plan.kind !== "supported")
    return failed(
      "B001",
      plan.reasons.join("; "),
      plan.kind === "unsupported" ? "unsupported" : "incomplete",
    );
  const model = plan.model;
  if (!sourceMappingValid(model, ir))
    return failed("B106", "Snapshot/model/source-map identity mismatch");
  let directory: string | null = null;
  try {
    directory = await mkdtemp(join(tmpdir(), "pymtheg-"));
    const cwd = directory;
    const effective: { [key: string]: string } = {
      ...model.bounds,
      ...(options.backend === "quint"
        ? {
            maxSteps: String(options.maxSteps),
            maxSamples: String(options.maxSamples),
          }
        : {}),
    };
    const common = {
      scope: {
        snapshotHash: ir.snapshot.id,
        modelHash: model.hash,
        configurationHash: hash(json({ options, scope: scopeData })),
        bounds: effective,
        ...(options.backend === "quint" ? { seed: options.seed } : {}),
      },
      assumptions: model.assumptions,
      toolVersions: {
        pymtheg: identity.version,
        ...(options.backend === "quint"
          ? { quint: quintVersion, engine: "quint-typescript" }
          : { tlc: "2.19", engine: "TLC breadth-first", jarSha256: tlcHash }),
      },
    };
    const classify = (p: ProcessResult): AnalysisResult[] | null =>
      p.kind === "exited"
        ? null
        : failed(
            p.kind === "cancelled"
              ? "B130"
              : p.kind === "timed_out"
                ? "B124"
                : "B102",
            p.kind === "timed_out"
              ? "The checker exhausted its requested time budget. This property remains unresolved."
              : p.kind === "cancelled"
                ? "Checking was cancelled. This property remains unresolved."
                : `${p.kind}: ${p.stderr || p.cleanup}`,
            p.kind === "cancelled"
              ? "cancelled"
              : p.kind === "timed_out"
                ? "timed_out"
                : "failed",
          ).map((r) => ({
            ...r,
            ...common,
            measurements: { backendMs: p.elapsedMs },
            witnessOrDerivation: {
              processKind: p.kind,
              cleanup: p.cleanup,
              stderr: p.stderr,
            },
          }));
    let p: ProcessResult,
      status: "violation" | "ok",
      trace: TraceState[] = [];
    if (options.backend === "quint") {
      const version = await runner(options.quint, ["--version"], {
        cwd,
        timeoutMs: Math.min(options.timeoutMs, 5000),
        signal,
      });
      const err = classify(version);
      if (err) return err;
      if (version.code !== 0 || version.stdout.trim() !== quintVersion)
        return failed(
          "B103",
          `Requested Quint ${quintVersion} unavailable or wrong version: ${version.stderr || version.stdout}`,
        );
      const input = join(cwd, "generated.qnt"),
        out = join(cwd, "result.json"),
        itf = join(cwd, "trace.itf.json");
      await writeFile(input, model.quint);
      p = await runner(
        options.quint,
        [
          "run",
          input,
          "--backend=typescript",
          "--main=generated",
          "--invariant=safety",
          `--seed=${options.seed}`,
          `--max-steps=${options.maxSteps}`,
          `--max-samples=${options.maxSamples}`,
          `--out=${out}`,
          `--out-itf=${itf}`,
        ],
        { cwd, timeoutMs: options.timeoutMs, signal },
      );
      const err2 = classify(p);
      if (err2) return err2;
      if (p.code !== 0 && p.code !== 1 && !p.signal)
        return failed(
          "B104",
          `Quint unexpected nonzero exit ${p.code}: ${p.stderr}`,
        );
      if (p.signal)
        return failed("B104", `Quint crashed: ${p.signal}; ${p.stderr}`);
      const raw = await readJson(out);
      if (
        !object(raw) ||
        !["ok", "violation"].includes(String(raw.status)) ||
        !Array.isArray(raw.errors) ||
        raw.errors.length ||
        !Array.isArray(raw.warnings) ||
        raw.stage !== "running"
      )
        return failed(
          "B105",
          `Invalid Quint result envelope: ${json(raw).slice(0, 1000)}`,
        );
      status = raw.status as "violation" | "ok";
      if (p.code !== (status === "violation" ? 1 : 0))
        return failed(
          "B104",
          `Quint exit/status disagreement: ${p.code}/${status}`,
        );
      if (status === "violation") trace = parseItf(await readJson(itf), model);
    } else {
      if (!options.tlcJar)
        return failed(
          "B103",
          "Requested TLC requires --tlc-jar PATH (official v1.7.4 JAR); Quint-to-TLC Apalache bridge is not invoked",
        );
      const jar = await readFile(options.tlcJar);
      const { createHash } = await import("node:crypto");
      if (createHash("sha256").update(jar).digest("hex") !== tlcHash)
        return failed("B103", "TLC JAR SHA-256 does not match pinned v1.7.4");
      await writeFile(join(cwd, "Generated.tla"), model.tla);
      await writeFile(join(cwd, "Generated.cfg"), model.config);
      p = await runner(
        "java",
        [
          "-Xmx512m",
          "-XX:ActiveProcessorCount=1",
          "-XX:+UseParallelGC",
          "-cp",
          options.tlcJar,
          "tlc2.TLC",
          "-workers",
          "1",
          "-seed",
          options.seed,
          "-metadir",
          join(cwd, "states"),
          "-config",
          join(cwd, "Generated.cfg"),
          join(cwd, "Generated.tla"),
        ],
        { cwd, timeoutMs: options.timeoutMs, signal },
      );
      const err = classify(p);
      if (err) return err;
      if (p.code === 12 && p.stdout.includes("Invariant Safety is violated")) {
        status = "violation";
        trace = parseTlcTrace(p.stdout, model);
      } else if (
        p.code === 0 &&
        p.stdout.includes("Model checking completed. No error has been found.")
      )
        status = "ok";
      else
        return failed(
          "B104",
          `TLC did not complete a recognised check (exit ${p.code}): ${(p.stderr + p.stdout).slice(-5000)}`,
        );
      if (!p.stdout.includes("TLC2 Version 2.19"))
        return failed("B103", "TLC executable version mismatch");
      delete effective.maxSteps;
      delete effective.maxSamples;
    }
    const validated = status === "violation" ? replay(model, trace, ir) : null;
    if (validated && !validated.valid)
      return failed(
        "B106",
        `Backend witness failed source replay: ${validated.reason}`,
      ).map((r) => ({
        ...r,
        ...common,
        witnessOrDerivation: { trace, validation: validated },
      }));
    const counts = /(\d+) states generated, (\d+) distinct states found/.exec(
      p.stdout,
    );
    const properties = model.properties.map((property) => ({
      ...property,
      domain: false,
    }));
    if (!model.flow && validated?.domainViolations.length)
      properties.push({
        source: "state-domains",
        generated: "domain",
        span: model.machine.span,
        domain: true,
      });
    const scopeIssue = scopeIssueResult(ir, model);
    const propertyResults = properties.map((property) => {
      const domains = validated?.domainViolations ?? [];
      const violation = property.domain
          ? domains.length > 0
          : (validated?.violated.includes(property.source) ?? false),
        stopped = status === "violation" && !violation,
        scopeIncomplete = !!scopeIssue && !violation;
      return result(
        ir,
        id + (property.domain ? "/" : "/invariant/") + property.source,
        "behaviour",
        {
          ...common,
          propertyHash: hash(
            json(
              property.domain
                ? model.machine.states
                : model.machine.invariants.find(
                    (i) => i.name === property.source,
                  ),
            ),
          ),
          outcome: violation
            ? "counterexample"
            : stopped || scopeIncomplete
              ? "inconclusive"
              : "no_counterexample",
          completion: stopped || scopeIncomplete ? "incomplete" : "complete",
          method:
            options.backend === "quint" ? "simulation" : "finite_model_check",
          outstandingObligations: stopped
            ? ["Run stopped at another safety violation"]
            : scopeIncomplete
              ? [
                  "Resolve the unused scope entries before treating this property as checked",
                ]
              : [],
          witnessValidation: violation ? "source_replayed" : "not_applicable",
          witnessOrDerivation: violation
            ? {
                events: validated!.events,
                states: displayTrace(model, trace),
                sourceReplay: true,
                ...(property.domain ? { domainViolations: domains } : {}),
              }
            : {
                engine:
                  options.backend === "quint"
                    ? "Quint TypeScript simulator"
                    : "TLC finite exhaustive search",
                configuredMaxSamples:
                  options.backend === "quint" ? options.maxSamples : null,
                configuredMaxSteps:
                  options.backend === "quint" ? options.maxSteps : null,
                distinctStates: counts?.[2] ?? null,
              },
          diagnostics: violation
            ? property.domain
              ? domains.map((domain) =>
                  finding(
                    "B011",
                    `Event ${domain.event} assigns ${domain.value} to ${domain.state}, outside its declared range ${domain.minimum}..${domain.maximum}. Guard the event or revise the declared range.`,
                    domain.span,
                    "error",
                    [domain.declarationSpan],
                    validated!.events.map((e) => e.operation),
                  ),
                )
              : [
                  finding(
                    "B010",
                    `Invariant ${property.source} violated${domains.length ? " in a state outside its declared range. Fix the event's range violation first; do not weaken the invariant to hide it." : ""}`,
                    property.span,
                    "error",
                    validated!.events.map((e) => e.span),
                    validated!.events.map((e) => e.operation),
                  ),
                ]
            : [],
          measurements: {
            backendMs: p.elapsedMs,
            ...(counts
              ? {
                  statesGenerated: Number(counts[1]),
                  distinctStates: Number(counts[2]),
                }
              : {}),
          },
        },
      );
    });
    return scopeIssue ? [...propertyResults, scopeIssue] : propertyResults;
  } catch (e) {
    return failed("B105", `Backend integration/invalid output: ${String(e)}`);
  } finally {
    if (directory)
      await rm(directory, { recursive: true, force: true }).catch((e) => {
        cleanupErrors.push(String(e));
      });
  }
}

export async function runBackend(
  ir: ProjectIR,
  options: BackendOptions,
  signal: AbortSignal,
  runner: typeof runProcess = runProcess,
): Promise<AnalysisResult[]> {
  const cleanupErrors: string[] = [];
  const records = await runBackendInner(
    ir,
    options,
    signal,
    cleanupErrors,
    runner,
  );
  if (cleanupErrors.length) {
    const span = ir.snapshot.sources[0]!;
    records.push(
      result(ir, "backend/cleanup", "cleanup", {
        completion: "failed",
        outstandingObligations: cleanupErrors,
        diagnostics: [
          finding(
            "B107",
            "Temporary workspace cleanup failed: " + cleanupErrors.join("; "),
            { file: span.file, start: 0, end: 0 },
          ),
        ],
      }),
    );
  }
  return records;
}
