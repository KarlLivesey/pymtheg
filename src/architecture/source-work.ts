// SPDX-License-Identifier: MIT
import type { ArchitectureEntity, PlanItem } from "./schema.js";
import type { SourceCatalogue } from "../shared/source-contracts.js";
import { sourceExpectationHash } from "./source-contracts.js";
import type { z } from "zod";
import type { workIssueSchema } from "./schema.js";

/** Compare recorded expectations with current source without acknowledging changes. */
export function sourcePlanningIssues(
  plans: {
    entity: ArchitectureEntity;
    record: PlanItem;
    origin: "authored" | "imported";
  }[],
  current: SourceCatalogue | { unavailable: string },
  options: { inspectedFiles?: ReadonlySet<string>; maxIssues?: number } = {},
): z.infer<typeof workIssueSchema>[] {
  const issues: z.infer<typeof workIssueSchema>[] = [];
  const entries =
    "unavailable" in current
      ? new Map()
      : new Map(current.entries.map((entry) => [entry.id, entry]));
  const seenIssues = new Set<string>();
  const within = (id: string) =>
    !options.inspectedFiles ||
    options.inspectedFiles.has(id.slice("source:".length, id.lastIndexOf("#")));
  function* comparisons() {
    for (const plan of plans) {
      const links = plan.record.links.filter((link) =>
        link.target.startsWith("source:"),
      );
      if (
        plan.record.sourceRoots &&
        links.every((link) => plan.record.sourceRoots?.[link.target])
      ) {
        for (const link of links) {
          const root = plan.record.sourceRoots[link.target]!;
          const expectations = Object.fromEntries(
            Object.entries(root.expectations).filter(([id]) => within(id)),
          );
          if (!Object.keys(expectations).length && !within(link.target))
            continue;
          yield {
            ...plan,
            record: {
              ...plan.record,
              links: [link],
              sourceExpectations: expectations,
            },
            precise: root.precise,
          };
        }
      } else yield { ...plan, precise: !plan.record.sourceRoots };
    }
  }
  for (const { entity, record, origin, precise } of comparisons()) {
    if (issues.length >= (options.maxIssues ?? Infinity)) break;
    const links = record.links.filter((link) =>
      link.target.startsWith("source:"),
    );
    if (!links.length) continue;
    const add = (
      kind: z.infer<typeof workIssueSchema>["kind"],
      message: string,
      target = links[0]!.target,
    ) => {
      const key = [entity.id, kind, target, message].join("\0");
      if (
        !seenIssues.has(key) &&
        issues.length < (options.maxIssues ?? Infinity)
      ) {
        seenIssues.add(key);
        issues.push({ id: entity.id, kind, origin, message, target });
      }
    };
    if (!precise)
      add(
        "unknown-link-review",
        "This older plan has conservative dependency attribution. Its recorded expectations are retained; review the remaining source components to establish precise ownership.",
      );
    if ("unavailable" in current) {
      add(
        "unknown-link-review",
        `Current source could not be checked: ${current.unavailable.replace(/[.]+$/, "")}. The captured contract remains available.`,
      );
      continue;
    }
    const expectations = record.sourceExpectations ?? {};
    const directTargets = new Set(links.map((link) => link.target));
    const unavailableRoot = links.some((link) => !entries.has(link.target));
    if (!Object.keys(expectations).length) {
      add(
        "unknown-link-review",
        "This source link has no captured expectation. Review the current source and save the plan.",
      );
      continue;
    }
    for (const [id, expected] of Object.entries(expectations)) {
      const entry = entries.get(id),
        file = id.slice("source:".length, id.lastIndexOf("#"));
      if (!entry) {
        if (
          unavailableRoot &&
          !directTargets.has(id) &&
          !current.missingFiles?.includes(file) &&
          !options.inspectedFiles?.has(file)
        )
          continue;
        const incomplete =
          !current.missingFiles?.includes(file) &&
          (current.incompleteFiles.includes(file) ||
            current.diagnostics.some((d) => d.file === file));
        add(
          incomplete ? "unknown-link-review" : "broken-link",
          incomplete
            ? `Source ${id.slice("source:".length)} could not be resolved because source checking is incomplete.`
            : `Source ${id.slice("source:".length)} is no longer present in the checked project. Its saved snapshot is retained.`,
          id,
        );
      } else if (entry.modelStatus !== "checked") {
        add(
          "unknown-link-review",
          `Source ${entry.symbolId} is ${entry.modelStatus}; resolve its design errors or open decisions before relying on it.`,
          id,
        );
      } else if (sourceExpectationHash(entry) !== expected) {
        add(
          "changed-target",
          `Source contract ${entry.symbolId} changed since this plan's recorded expectation. Review the current source before accepting the change.`,
          id,
        );
      }
    }
  }
  return issues;
}
