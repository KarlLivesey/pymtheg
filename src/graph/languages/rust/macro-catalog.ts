// SPDX-License-Identifier: MIT
// Inspected releases anchor the semver-family assumption. See W2-C3.md.
export const ecosystemMacros = new Map<
  string,
  { version: string; minimum: string; names: Set<string> }
>([
  [
    "tracing",
    {
      version: "0.1.44",
      minimum: "0.1.0",
      names: new Set(["trace", "debug", "info", "warn", "error", "event"]),
    },
  ],
  [
    "log",
    {
      version: "0.4.35",
      minimum: "0.4.4",
      names: new Set(["trace", "debug", "info", "warn", "error"]),
    },
  ],
  [
    "metrics",
    {
      version: "0.24.6",
      minimum: "0.24.0",
      names: new Set(["counter", "gauge", "histogram"]),
    },
  ],
  [
    "anyhow",
    {
      version: "1.0.104",
      minimum: "1.0.0",
      names: new Set(["ensure", "bail", "anyhow"]),
    },
  ],
  [
    "tokio",
    { version: "1.54.1", minimum: "1.0.0", names: new Set(["select"]) },
  ],
]);
export const ecosystemMacroNames = new Set(
  [...ecosystemMacros.values()].flatMap((c) => [...c.names]),
);
type Version = [number, number, number];
const compare = (a: Version, b: Version) =>
  a.reduce((d, n, i) => d || n - b[i]!, 0);
const versionTuple = (s: string): Version | undefined => {
  if (!/^\d+\.\d+\.\d+$/.test(s)) return undefined;
  const ns = s.split(".").map(Number);
  return ns.every(Number.isSafeInteger) ? (ns as Version) : undefined;
};
function family(
  audited: string,
  minimum: string,
): { low: Version; high: Version } {
  const [major, minor] = versionTuple(audited)!;
  const low = versionTuple(minimum)!;
  return { low, high: major ? [major + 1, 0, 0] : [0, minor + 1, 0] };
}
export function compatibleRelease(
  audited: string,
  version: string | undefined,
  minimum: string,
): boolean {
  const v = version && versionTuple(version);
  const { low, high } = family(audited, minimum);
  return !!v && compare(v, low) >= 0 && compare(v, high) < 0;
}
/** Stable-release intervals for ordinary Cargo requirements. Unknown stays unproved. */
function requirementRange(
  requirement: string,
): { low: Version; high: Version } | undefined {
  let low: Version = [0, 0, 0],
    high: Version = [Infinity, 0, 0];
  const bump = (v: Version, at: number): Version =>
    v.map((n, i) => (i < at ? n : i === at ? n + 1 : 0)) as Version;
  for (const part of requirement.split(",")) {
    const text = part.trim();
    if (text === "*" || text === "x" || text === "X") continue;
    const m =
      /^(\^|~|=|>=|<=|>|<)?\s*(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/.exec(
        text,
      );
    if (!m) return undefined;
    const raw = m.slice(2),
      nums = raw.filter((n) => n !== undefined && /^\d+$/.test(n));
    const specified = nums.length;
    if (
      raw.slice(0, specified).some((n) => !n || !/^\d+$/.test(n)) ||
      raw.slice(specified).some((n) => n !== undefined && /^\d+$/.test(n))
    )
      return undefined;
    const v = raw.map((n) => (n && /^\d+$/.test(n) ? Number(n) : 0)) as Version;
    if (!v.every(Number.isSafeInteger)) return undefined;
    const op = m[1] ?? "^",
      wildcard = raw.some((n) => n !== undefined && !/^\d+$/.test(n));
    if (wildcard && !["^", "="].includes(op)) return undefined;
    let a: Version = [0, 0, 0],
      b: Version = [Infinity, 0, 0];
    if (op === ">=") a = v;
    else if (op === ">") a = bump(v, specified - 1);
    else if (op === "<") b = v;
    else if (op === "<=") b = bump(v, specified - 1);
    else {
      a = v;
      const at =
        wildcard || op === "="
          ? specified - 1
          : op === "~"
            ? Math.min(specified - 1, 1)
            : Math.min(
                v.findIndex((n) => n !== 0) < 0
                  ? specified - 1
                  : v.findIndex((n) => n !== 0),
                specified - 1,
              );
      b = bump(v, at);
    }
    if (compare(a, low) > 0) low = a;
    if (compare(b, high) < 0) high = b;
  }
  return compare(low, high) < 0 ? { low, high } : undefined;
}
export function compatibleRequirement(
  audited: string,
  requirement: string | undefined,
  minimum: string,
): boolean {
  const r =
    requirement === undefined ? undefined : requirementRange(requirement);
  const { low, high } = family(audited, minimum);
  return !!r && compare(r.low, low) >= 0 && compare(r.high, high) <= 0;
}
export function auditedMacro(
  packageName: string,
  version: string | undefined,
  name: string,
  requirement?: string,
): boolean {
  const entry = ecosystemMacros.get(packageName);
  return (
    !!entry &&
    (version === undefined
      ? compatibleRequirement(entry.version, requirement, entry.minimum)
      : compatibleRelease(entry.version, version, entry.minimum)) &&
    entry.names.has(name)
  );
}
export function matchesVersion(requirement: string, version: string): boolean {
  const r = requirementRange(requirement),
    v = versionTuple(version);
  return !!r && !!v && compare(v, r.low) >= 0 && compare(v, r.high) < 0;
}
