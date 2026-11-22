// SPDX-License-Identifier: MIT
import { identity } from "./identity-values.js";
import { readSourcePolicy, type SourcePolicy } from "./source-policy.js";
export interface Scenario {
  file: string;
  entry: string;
  seed: string;
  maxSteps: number;
  maxSamples: number;
  timeoutMs: number;
  scope: Record<string, unknown>;
}
/**
 * D22: whether the project's owner trusts the repository. `trusted` lets each
 * language's official tooling run on the project, as building it would run
 * its build scripts and macros; `source-only` runs nothing of the project.
 * The answer is this machine's (.pymtheg/local/trust.json, LocalTrust);
 * nothing committed grants it. No answer is `unanswered` and runs nothing.
 */
export type ProjectTrust = "trusted" | "source-only";
/** The trust that applies: an answer, or none on this machine yet. */
export type TrustState = ProjectTrust | "unanswered";
/** This machine's answer for one checkout, and its local tool settings. */
export interface LocalTrust {
  trust: ProjectTrust;
  /** Local-only per-language settings: true, false or an absolute tool path. */
  toolchain?: Record<string, boolean | string>;
}
export const projectTrustValues: readonly ProjectTrust[] = [
  "trusted",
  "source-only",
];
/**
 * Code-graph settings. `trust`: the project-wide answer of D22, given at
 * `init`. `toolchain`: per-language overrides (D17), which win over `trust`
 * either way (`go`: true finds `go` on the user's PATH; an absolute path
 * names the trusted `go`; false keeps it off). Running a language's toolchain
 * on a project is as trusted as building it. Off when both are absent.
 */
export interface GraphConfig {
  trust?: ProjectTrust;
  toolchain?: { go?: boolean | string };
}
export interface ProjectConfig {
  version: 1;
  defaultFile?: string;
  sources?: SourcePolicy;
  graph?: GraphConfig;
  scenarios: Record<string, Scenario>;
}
export function graphConfig(value: unknown): GraphConfig {
  if (!object(value)) throw Error("graph must be an object");
  for (const key of Object.keys(value))
    if (key !== "toolchain" && key !== "trust")
      throw Error(`Unknown graph setting: ${key}`);
  const trust = value.trust;
  if (
    trust !== undefined &&
    !projectTrustValues.includes(trust as ProjectTrust)
  )
    throw Error('graph.trust must be "trusted" or "source-only"');
  const answered = trust === undefined ? {} : { trust: trust as ProjectTrust };
  if (value.toolchain === undefined) return answered;
  const toolchain = value.toolchain;
  if (!object(toolchain)) throw Error("graph.toolchain must be an object");
  for (const key of Object.keys(toolchain))
    if (key !== "go") throw Error(`Unknown graph.toolchain setting: ${key}`);
  const go = toolchain.go;
  if (
    go !== undefined &&
    typeof go !== "boolean" &&
    !(typeof go === "string" && go.startsWith("/"))
  )
    throw Error(
      "graph.toolchain.go must be true, false or an absolute path to go",
    );
  return { ...answered, toolchain: go === undefined ? {} : { go } };
}
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown, min: number, max: number): v is number =>
  Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
export function scenario(value: unknown): Scenario {
  if (!object(value)) throw Error("Scenario must be an object");
  const allowed = [
    "file",
    "entry",
    "seed",
    "maxSteps",
    "maxSamples",
    "timeoutMs",
    "scope",
  ];
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw Error(`Unknown scenario setting: ${key}`);
  if (
    typeof value.file !== "string" ||
    !value.file.endsWith(identity.extension) ||
    typeof value.entry !== "string" ||
    !value.entry
  )
    throw Error(`Scenario requires a ${identity.extension} file and entry`);
  const result = {
    seed: "42",
    maxSteps: 12,
    maxSamples: 1000,
    timeoutMs: 45000,
    scope: {},
    ...value,
  };
  if (
    typeof result.seed !== "string" ||
    !/^\d+$/.test(result.seed) ||
    BigInt(result.seed) > 9223372036854775807n
  )
    throw Error("Seed must be a nonnegative signed 64-bit integer string");
  if (
    !integer(result.maxSteps, 1, 10000) ||
    !integer(result.maxSamples, 1, 100000) ||
    !integer(result.timeoutMs, 1, 120000)
  )
    throw Error("Steps, samples or timeout outside supported limits");
  if (!object(result.scope)) throw Error("Scope must be an object");
  return result as unknown as Scenario;
}
export function projectConfig(value: unknown): ProjectConfig {
  if (!object(value) || value.version !== 1 || !object(value.scenarios))
    throw Error("Project configuration requires version: 1 and scenarios: {}");
  for (const key of Object.keys(value))
    if (
      !["version", "defaultFile", "scenarios", "sources", "graph"].includes(key)
    )
      throw Error(`Unknown project setting: ${key}`);
  if (value.defaultFile !== undefined && typeof value.defaultFile !== "string")
    throw Error("defaultFile must be a path");
  const scenarios: Record<string, Scenario> = Object.create(null) as Record<
    string,
    Scenario
  >;
  for (const [name, data] of Object.entries(value.scenarios))
    scenarios[name] = scenario(data);
  return {
    version: 1,
    ...(typeof value.defaultFile === "string"
      ? { defaultFile: value.defaultFile }
      : {}),
    scenarios,
    ...(value.sources === undefined
      ? {}
      : { sources: readSourcePolicy(value.sources) }),
    ...(value.graph === undefined ? {} : { graph: graphConfig(value.graph) }),
  };
}
export function machineScope(
  scope: unknown,
  bounds: Record<string, string>,
): string[] {
  if (scope === undefined || (object(scope) && Object.keys(scope).length === 0))
    return [];
  if (
    !object(scope) ||
    !object(scope.domains) ||
    !Array.isArray(scope.assumptions) ||
    !scope.assumptions.every((a) => typeof a === "string")
  )
    throw Error(
      'Scope requires {domains: {state: "min..max" or "Bool"}, assumptions: string[]}',
    );
  for (const key of Object.keys(scope))
    if (!["domains", "assumptions"].includes(key))
      throw Error("Unknown machine scope setting " + key);
  const domains = scope.domains;
  if (
    Object.keys(domains).length !== Object.keys(bounds).length ||
    !Object.entries(bounds).every(([k, v]) => domains[k] === v)
  )
    throw Error(
      "Scope domains must exactly match source domains; narrowing is never implicit",
    );
  return scope.assumptions as string[];
}
/** Languages with a toolchain route. */
export const toolchainRoutes = ["go"] as const;

/**
 * The trust that applies to a checkout (D22): a committed
 * `graph.trust: "source-only"` binds (the repository's author may forbid
 * build tools); otherwise this machine's answer, or `unanswered`.
 */
export function trustState(
  config: ProjectConfig,
  local: LocalTrust | undefined,
): TrustState {
  if (config.graph?.trust === "source-only") return "source-only";
  return local?.trust ?? "unanswered";
}

/**
 * The toolchain routes that may run, as IndexOptions.toolchains (empty when
 * off). The single place that decides it. Only this machine's trusted
 * answer turns routes on (D22); nothing committed can. A committed
 * per-language setting may only turn a route off (`false`): a committed
 * `true` adds nothing and a committed tool path is never used, since a path
 * into the repository would run its code. A tool path comes from the local
 * answer only; a local `false` turns a route off too.
 */
export function graphToolchains(
  config: ProjectConfig,
  local: LocalTrust | undefined,
): Record<string, boolean | string> {
  if (trustState(config, local) !== "trusted") return {};
  const routes: Record<string, boolean | string> = {};
  for (const key of toolchainRoutes) {
    if (config.graph?.toolchain?.[key] === false) continue;
    const own = local?.toolchain?.[key];
    if (own === false) continue;
    routes[key] = typeof own === "string" ? own : true;
  }
  return routes;
}

/** Committed tool paths, which graphToolchains never uses (reported as a warning). */
export function committedToolPaths(config: ProjectConfig): string[] {
  return toolchainRoutes.filter(
    (key) => typeof config.graph?.toolchain?.[key] === "string",
  );
}
