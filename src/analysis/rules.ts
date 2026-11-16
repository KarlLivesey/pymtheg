// SPDX-License-Identifier: MIT
import type { Expr } from "../language/ast.js";
import { nodeKey } from "../language/ast.js";
import { type ProjectIR, blockedSymbols, typeKey } from "../semantic/core.js";
import { result, type AnalysisResult } from "../reporting/report.js";
import { hash, json, finding } from "../shared/identity.js";
export function compareRules(ir: ProjectIR): AnalysisResult[] {
  const buckets = new Map<
      string,
      { id: string; name: string; canonical: string; span: Expr["span"] }[]
    >(),
    blocked = blockedSymbols(ir);
  let nodes = 0,
    rules = 0;
  for (const d of ir.declarations) {
    if (d.kind !== "rule" || !d.expr || blocked.has(d.id)) continue;
    rules++;
    const params = new Map(d.params.map((p, i) => [p.name, i]));
    function canon(e: Expr): unknown {
      nodes++;
      switch (e.kind) {
        case "literal":
          return ["literal", typeof e.value, String(e.value)];
        case "name":
          return ["param", params.get(e.name) ?? `unresolved:${e.name}`];
        case "field":
          return ["field", canon(e.base), e.name];
        case "call":
          return [
            "call",
            ir.info.get(nodeKey(e.span))?.target ?? e.name,
            e.args.map((a) => [a.mode, canon(a.expr)]),
          ];
        case "record":
          return [
            "record",
            ir.info.get(nodeKey(e.span))?.type,
            e.fields.map((f) => [f.name, canon(f.value)]),
          ];
        case "list":
          return ["list", e.items.map(canon)];
        case "binary":
          return [e.op, canon(e.left), canon(e.right)];
        case "unary":
          return [e.op, canon(e.expr)];
        case "unknown":
          return ["unknown", d.id, e.span.start];
      }
    }
    const canonical = json([
        d.params.map((p) => [
          p.mode,
          typeKey(ir.types.get(nodeKey(p.type.span))!),
        ]),
        typeKey(ir.types.get(nodeKey(d.result.span))!),
        canon(d.expr),
      ]),
      key = hash(canonical),
      bucket = buckets.get(key) ?? [];
    bucket.push({ id: d.id, name: d.name, canonical, span: d.span });
    buckets.set(key, bucket);
  }
  const results: AnalysisResult[] = [];
  for (const [key, bucket] of buckets) {
    if (bucket.length < 2) continue;
    const first = bucket[0]!,
      copies = bucket.filter((d) => d.canonical === first.canonical);
    if (copies.length > 1)
      results.push(
        result(ir, "rules/" + key, "rule-copies", {
          outcome: "established",
          method: "structural",
          diagnostics: [
            finding(
              "D001",
              `Independent alpha-equivalent rules: ${
                copies
                  .slice(0, 8)
                  .map((d) => d.name)
                  .join(", ") +
                (copies.length > 8 ? ` and ${copies.length - 8} more` : "")
              }`,
              first.span,
              "warning",
              copies.slice(1).map((d) => d.span),
            ),
          ],
          witnessOrDerivation: {
            definitions: copies.map((d) => d.id),
            normalisation:
              "parameter renaming only; resolved types/callees; evaluation order retained",
          },
        }),
      );
  }
  ir.measurements.ruleNodes = nodes;
  ir.measurements.ruleDefinitions = rules;
  ir.measurements.ruleHashBuckets = buckets.size;
  ir.measurements.rulePairComparisons = 0;
  return results;
}
