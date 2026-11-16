// SPDX-License-Identifier: MIT
import { partitionSelection } from "../reporting/selection.js";
import { loadProject, type SourceOptions } from "../language/project.js";
import { typecheck } from "../semantic/core.js";
import { analyseContracts } from "./contracts.js";
import { analyseCosts } from "./cost.js";
import { compareRules } from "./rules.js";
import { repeatedWork } from "./repeated.js";
import { analyseOwnership } from "./ownership.js";
import { localReport } from "../reporting/report.js";
import type { AnalysisProgress } from "../shared/protocol.js";
export function analyseFile(
  file: string,
  notify: (message: AnalysisProgress) => void = () => {},
  options: SourceOptions = {},
): {
  ir: ReturnType<typeof typecheck>;
  report: ReturnType<typeof localReport>;
} {
  const start = performance.now();
  const snapshot = loadProject(file, options);
  notify({ kind: "snapshot", value: snapshot });
  const parsed = performance.now();
  const ir = typecheck(snapshot);
  const report = localReport(ir);
  notify({
    kind: "partial",
    value: partitionSelection(ir, {
      ...report,
      diagnostics: [...report.diagnostics],
      results: [...report.results],
    }),
  });
  const typed = performance.now();
  const contracts = analyseContracts(ir),
    costs = analyseCosts(ir),
    copies = compareRules(ir),
    ownership = analyseOwnership(ir),
    repeated = repeatedWork(ir);
  report.results.push(
    ...contracts,
    ...costs,
    ...copies,
    ...ownership,
    ...repeated,
  );
  report.diagnostics = [
    ...ir.diagnostics,
    ...report.diagnostics.filter((d) => !ir.diagnostics.includes(d)),
    ...contracts.flatMap((x) => x.diagnostics),
    ...costs.flatMap((x) => x.diagnostics),
    ...copies.flatMap((x) => x.diagnostics),
    ...ownership.flatMap((x) => x.diagnostics),
    ...repeated.flatMap((x) => x.diagnostics),
  ];
  Object.assign(report.measurements, ir.measurements, {
    loadParseMs: parsed - start,
    typecheckMs: typed - parsed,
    localAnalysisMs: performance.now() - typed,
    totalLocalMs: performance.now() - start,
  });
  return { ir, report: partitionSelection(ir, report) };
}
