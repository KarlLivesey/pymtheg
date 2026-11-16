// SPDX-License-Identifier: MIT
import type { AnalysisResult, Report } from "./report.js";
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const stable = (v: unknown): string =>
  JSON.stringify(v, (_, value: unknown) =>
    typeof value === "bigint"
      ? String(value)
      : object(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
          )
        : value,
  );
export function compareCost(current: AnalysisResult, previous: AnalysisResult) {
  const a = object(current.witnessOrDerivation)
      ? current.witnessOrDerivation
      : {},
    b = object(previous.witnessOrDerivation)
      ? previous.witnessOrDerivation
      : {};
  const reasons: string[] = [];
  if (current.propertyId !== previous.propertyId)
    reasons.push("Different properties");
  if (current.completion !== "complete" || previous.completion !== "complete")
    reasons.push("One or both work estimates are incomplete");
  if (a.metric !== b.metric) reasons.push("Different work units");
  if (stable(a.bounds) !== stable(b.bounds))
    reasons.push("Different input bounds");
  if (
    stable([...current.assumptions].sort()) !==
    stable([...previous.assumptions].sort())
  )
    reasons.push("Different cost assumptions");
  const integer = (v: unknown) =>
    typeof v === "bigint"
      ? v
      : typeof v === "string" && /^\d+$/.test(v)
        ? BigInt(v)
        : null;
  const av = integer(a.maximum),
    bv = integer(b.maximum);
  if (av === null || bv === null)
    reasons.push("A numeric work bound is unavailable");
  return {
    comparable: reasons.length === 0,
    reasons,
    metric: String(a.metric ?? "work"),
    currentExpression: String(a.expression ?? "?"),
    previousExpression: String(b.expression ?? "?"),
    currentMaximum: av === null ? null : String(av),
    previousMaximum: bv === null ? null : String(bv),
    difference:
      reasons.length === 0 && av !== null && bv !== null
        ? String(av - bv)
        : null,
  };
}
export function compareReports(current: Report, previous: Report) {
  const key = (d: Report["diagnostics"][number]) =>
    JSON.stringify([d.span.file, d.code, d.message]);
  const difference = (
    left: Report["diagnostics"],
    right: Report["diagnostics"],
  ) => {
    const counts = new Map<string, number>();
    for (const d of right) counts.set(key(d), (counts.get(key(d)) ?? 0) + 1);
    return left.filter((d) => {
      const k = key(d),
        n = counts.get(k) ?? 0;
      if (n) {
        counts.set(k, n - 1);
        return false;
      }
      return true;
    });
  };
  const before = new Map(previous.snapshot.files.map((f) => [f.file, f.hash])),
    after = new Map(current.snapshot.files.map((f) => [f.file, f.hash]));
  const changedFiles = [...new Set([...before.keys(), ...after.keys()])].filter(
    (file) => before.get(file) !== after.get(file),
  );
  const previousIds = new Set(previous.results.map((r) => r.propertyId));
  const common = new Set(
    current.results
      .filter((r) => previousIds.has(r.propertyId))
      .map((r) => r.propertyId),
  );
  const scopes = (report: Report) =>
    report.results
      .filter((r) => common.has(r.propertyId))
      .map((r) => ({
        id: r.propertyId,
        bounds: r.scope.bounds,
        seed: r.scope.seed,
        assumptions: [...r.assumptions].sort(),
        versions: r.toolVersions,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  return {
    scopeChanged: stable(scopes(current)) !== stable(scopes(previous)),
    added: difference(current.diagnostics, previous.diagnostics),
    notReported: difference(previous.diagnostics, current.diagnostics),
    changedFiles,
    hasIncomplete:
      current.session.state !== "Completed" ||
      previous.session.state !== "Completed" ||
      current.results.some((r) => r.completion !== "complete") ||
      previous.results.some((r) => r.completion !== "complete"),
    requestChanged: current.session.requested !== previous.session.requested,
    coverageChanged:
      stable(current.snapshot.files.map((f) => f.file).sort()) !==
      stable(previous.snapshot.files.map((f) => f.file).sort()),
  };
}
