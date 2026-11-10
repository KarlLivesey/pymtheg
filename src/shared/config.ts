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
export interface ProjectConfig {
  version: 1;
  defaultFile?: string;
  sources?: SourcePolicy;
  scenarios: Record<string, Scenario>;
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
    if (!["version", "defaultFile", "scenarios", "sources"].includes(key))
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
