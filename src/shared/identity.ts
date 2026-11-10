import { createHash } from "node:crypto";
export { identity } from "./identity-values.js";
export const hash = (s: string): string =>
  createHash("sha256").update(s).digest("hex");
export const json = (v: unknown): string =>
  JSON.stringify(
    v,
    (_, x: unknown) => (typeof x === "bigint" ? x.toString() : x),
    2,
  ) + "\n";
export interface Span {
  file: string;
  start: number;
  end: number;
}
export interface Finding {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  span: Span;
  related: Span[];
  path: string[];
}
export function finding(
  code: string,
  message: string,
  span: Span,
  severity: Finding["severity"] = "error",
  related: Span[] = [],
  path: string[] = [],
): Finding {
  const seen = new Set<string>();
  return {
    code,
    message,
    span,
    severity,
    related: related.filter((location) => {
      const key = JSON.stringify([location.file, location.start, location.end]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    path,
  };
}
export function assertNever(x: never): never {
  throw new Error(`Unhandled variant ${String(x)}`);
}
