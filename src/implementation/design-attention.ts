// SPDX-License-Identifier: MIT
import { authoredDocuments } from "../architecture/work.js";
import { architectureDetail } from "../architecture/model.js";
import { planItemSchema } from "../architecture/schema.js";
import {
  sourceContractsPath,
  sourceCatalogueSchema,
} from "../shared/source-contracts.js";
import { sourceExpectationSets } from "../architecture/source-contracts.js";
import type { sourcePlanningIssues } from "../architecture/source-work.js";
import type { readImplementationDocuments } from "./workspace.js";
export type DesignAttention = {
  issues: ReturnType<typeof sourcePlanningIssues>;
  current: {
    id: string;
    source: string;
    sourceHash: string;
    fileHash?: string;
    declarationHash?: string;
    truncated: boolean;
  }[];
};
/** Retained native expectations and direct design bindings share the attention comparison. */
export function implementationDesignPlans(
  plan: NonNullable<Awaited<ReturnType<typeof readImplementationDocuments>>>,
) {
  const authored = authoredDocuments(plan.index, plan.documents);
  const documents = new Map(plan.documents.map((d) => [d.path, d]));
  const raw = documents.get(sourceContractsPath);
  const catalogue = raw
    ? sourceCatalogueSchema.parse(JSON.parse(raw.text))
    : null;
  const sourceIds = plan.index.entities
    .filter((e) => e.id.startsWith("source:"))
    .map((e) => e.id);
  const expectations = catalogue
    ? sourceExpectationSets(catalogue, sourceIds)
    : {};
  const plans: Parameters<typeof sourcePlanningIssues>[0] = [];
  for (const entity of plan.index.entities) {
    const document = documents.get(entity.document);
    if (entity.planning && document) {
      const record = planItemSchema.safeParse(
        architectureDetail(document, entity.pointer),
      );
      if (
        record.success &&
        record.data.links.some((l) => l.target.startsWith("source:"))
      )
        plans.push({
          entity,
          record: record.data,
          origin: authored.has(entity.document) ? "authored" : "imported",
        });
    } else if (entity.id.startsWith("source:")) {
      plans.push({
        entity,
        origin: "authored",
        record: {
          id: entity.id,
          kind: "decision",
          title: entity.name,
          owner: "",
          status: "accepted",
          detail: "",
          acceptance: "",
          evidence: "",
          evidenceRevision: "",
          sourceExpectations: expectations[entity.id] ?? {},
          links: [{ kind: "implements", target: entity.id }],
        },
      });
    }
  }
  return plans;
}
