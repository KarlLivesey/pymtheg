// Exact releases whose expansion definitions were inspected. See W2-C3.md.
export const ecosystemMacros = new Map<
  string,
  { version: string; names: Set<string> }
>([
  [
    "tracing",
    {
      version: "0.1.44",
      names: new Set(["trace", "debug", "info", "warn", "error", "event"]),
    },
  ],
  [
    "log",
    {
      version: "0.4.35",
      names: new Set(["trace", "debug", "info", "warn", "error"]),
    },
  ],
  [
    "metrics",
    { version: "0.24.6", names: new Set(["counter", "gauge", "histogram"]) },
  ],
  [
    "anyhow",
    { version: "1.0.104", names: new Set(["ensure", "bail", "anyhow"]) },
  ],
  ["tokio", { version: "1.54.1", names: new Set(["select"]) }],
]);
export const ecosystemMacroNames = new Set(
  [...ecosystemMacros.values()].flatMap((c) => [...c.names]),
);
export function auditedMacro(
  packageName: string,
  version: string | undefined,
  name: string,
): boolean {
  const entry = ecosystemMacros.get(packageName);
  return !!entry && version === entry.version && entry.names.has(name);
}
/** A deliberately small Cargo requirement subset; unknown means no proof. */
export function matchesVersion(requirement: string, version: string): boolean {
  const req = /^(\^|~|=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(
    requirement.trim(),
  );
  const ver = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!req || !ver) return false;
  const low = req.slice(2).map((n) => Number(n ?? 0));
  const actual = ver.slice(1).map(Number);
  const compare = (a: number[], b: number[]) =>
    a.reduce((d, n, i) => d || n - b[i]!, 0);
  if (req[1] === "=") return req[4] !== undefined && compare(actual, low) === 0;
  const specified = req[4] !== undefined ? 3 : req[3] !== undefined ? 2 : 1;
  const bump =
    req[1] === "~"
      ? Math.min(specified - 1, 1)
      : Math.min(
          low.findIndex((n) => n !== 0) < 0
            ? specified - 1
            : low.findIndex((n) => n !== 0),
          specified - 1,
        );
  const high = low.map((n, i) => (i < bump ? n : i === bump ? n + 1 : 0));
  return compare(actual, low) >= 0 && compare(actual, high) < 0;
}
