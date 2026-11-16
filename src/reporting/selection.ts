// SPDX-License-Identifier: MIT
import type { ProjectIR } from "../semantic/core.js";
import { diagnosticsBySymbol } from "../semantic/core.js";
import type { Report, AnalysisResult } from "./report.js";
import type { Span, Finding } from "../shared/identity.js";
/** Partition one analysis of one IR; consumers never change the selected-file verdict. */
export function partitionSelection(ir: ProjectIR, report: Report): Report {
  const files = ir.snapshot.selectedFiles;
  if (!files) return report;
  const selectedFiles = new Set(files);
  const selected = new Set(
    ir.declarations
      .filter((d) => selectedFiles.has(d.span.file))
      .map((d) => d.id),
  );
  const reverse = new Map<string, string[]>();
  for (const edge of ir.edges) {
    const users = reverse.get(edge.to) ?? [];
    users.push(edge.from);
    reverse.set(edge.to, users);
  }
  const relevant = new Set(selected),
    queue = [...selected];
  // Failed name resolution has no resolved edge. Keep these potential consumers
  // explicit rather than losing evidence of a renamed/removed declaration.
  const diagnosticOwners = diagnosticsBySymbol(ir);
  for (const [id, findings] of diagnosticOwners)
    if (!selected.has(id) && findings.some((f) => f.code === "N002")) {
      relevant.add(id);
      queue.push(id);
    }
  for (let i = 0; i < queue.length; i++)
    for (const id of reverse.get(queue[i]!) ?? [])
      if (!relevant.has(id)) {
        relevant.add(id);
        queue.push(id);
      }
  const consumerIds = new Set([...relevant].filter((id) => !selected.has(id)));
  const spansByFile = new Map<string, Span[]>();
  for (const d of ir.declarations)
    if (consumerIds.has(d.id)) {
      const spans = spansByFile.get(d.span.file) ?? [];
      spans.push(d.span);
      spansByFile.set(d.span.file, spans);
    }
  for (const spans of spansByFile.values())
    spans.sort((a, b) => a.start - b.start);
  const owns = (f: Finding) => {
    const spans = spansByFile.get(f.span.file) ?? [];
    let lo = 0,
      hi = spans.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (spans[mid]!.start <= f.span.start) lo = mid + 1;
      else hi = mid;
    }
    return lo > 0 && spans[lo - 1]!.end > f.span.start;
  };
  const selectedFinding = (f: Finding) =>
    selectedFiles.has(f.span.file) || f.code === "L003";
  const propertyOwners = new Map<string, Set<string>>();
  for (const r of report.results) {
    const marker = r.propertyId.lastIndexOf("#"),
      slash = r.propertyId.indexOf("/", marker);
    const id = slash < 0 ? r.propertyId : r.propertyId.slice(0, slash);
    const owners = new Set([id]);
    if (r.analysisKind === "rule-copies") {
      const evidence = r.witnessOrDerivation as {
        definitions?: string[];
      } | null;
      for (const definition of evidence?.definitions ?? [])
        owners.add(definition);
    }
    propertyOwners.set(r.propertyId, owners);
  }
  const belongs = (r: AnalysisResult, ids: Set<string>) =>
    [...(propertyOwners.get(r.propertyId) ?? [])].some((id) => ids.has(id));
  const incompleteFiles = ir.snapshot.sources
    .filter((source) => source.recovered && !selectedFiles.has(source.file))
    .map((source) => source.file);
  const moduleFailure = (f: Finding) =>
    !selectedFinding(f) && /^(P|L00[12])/.test(f.code);
  report.consumers = {
    selectedFiles: files,
    incompleteFiles,
    symbolIds: [...consumerIds].sort(),
    diagnostics: report.diagnostics.filter(
      (f) => !selectedFinding(f) && (owns(f) || moduleFailure(f)),
    ),
    results: report.results.filter(
      (r) => !belongs(r, selected) && belongs(r, consumerIds),
    ),
  };
  report.diagnostics = report.diagnostics.filter(selectedFinding);
  report.results = report.results.filter((r) => belongs(r, selected));
  return report;
}
