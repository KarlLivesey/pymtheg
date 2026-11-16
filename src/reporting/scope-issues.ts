// SPDX-License-Identifier: MIT
import type { ProjectIR } from "../semantic/core.js";
import type { GeneratedModel } from "../behaviour/model.js";
import { finding, hash, json } from "../shared/identity.js";
import { result } from "./report.js";

/** Configuration uncertainty is separate from a source-replayed violation. */
export function scopeIssueResult(ir: ProjectIR, model: GeneratedModel) {
  const issues = model.flow?.graph.scopeIssues;
  if (!issues?.length) return null;
  const owner = ir.symbols.get(model.flow!.sourceId)!;
  return result(ir, owner.id + "/scope-validation", "scope-validation", {
    outcome: "inconclusive",
    completion: "incomplete",
    method: "structural",
    outstandingObligations: [...issues],
    diagnostics: issues.map((issue) =>
      finding("B014", issue, owner.span, "warning"),
    ),
    scope: {
      modelHash: model.hash,
      configurationHash: hash(json(model.flow!.scope)),
      bounds: { inputScope: model.bounds.inputScope! },
    },
  });
}
