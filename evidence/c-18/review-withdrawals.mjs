// SPDX-License-Identifier: MIT
// Attribute the review withdrawals on the same graph project IDs.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
if (args[0] === "--relax-provenance") {
  // Use only in a disposable copy of the corrected build. Keep the release,
  // namespace and feature checks when toggling provenance for measurement.
  const path = join(args[1], "dist/graph/languages/rust/library.js");
  const text = readFileSync(path, "utf8");
  const check =
    /registry\.some\(\(\{ macroRegistry \}\) => !macroRegistry \|\|\s*\(spec\?\.implementation && !macroRegistry\.includes\(spec\.implementation\)\)\)/g;
  const sourceCheck =
    /export function cargoMacroSourceKnown\(path\) \{[\s\S]*?^\}/gm;
  if ([...text.matchAll(sourceCheck)].length === 1)
    writeFileSync(
      path,
      text.replace(
        sourceCheck,
        "export function cargoMacroSourceKnown() { return true; }",
      ),
    );
  else if ([...text.matchAll(check)].length === 1)
    writeFileSync(path, text.replace(check, "false"));
  else throw Error("Cannot isolate the registry macro provenance check");
} else {
  const affectedOnly = args[0] === "--affected";
  if (affectedOnly) args.shift();
  const runs = [];
  for (let i = 0; i < args.length; i += 2) {
    const { repos } = JSON.parse(readFileSync(args[i], "utf8"));
    runs.push({
      repos: new Map(repos.map((repo) => [repo.id, repo])),
      work: args[i + 1],
    });
  }
  if (runs.length !== (affectedOnly ? 3 : 4))
    throw Error(
      "Pass the C-12, original C-18, corrected C-18 and provenance-relaxed run/work pairs",
    );
  function links(run, id, commit) {
    const repo = run.repos.get(id);
    if (repo?.outcome !== "finished" || repo.commit !== commit)
      throw Error(`No matching completed graph for ${id}`);
    const db = new DatabaseSync(
      join(
        run.work,
        repo.attempt,
        "checkout/.pymtheg/rebuildable/graph.sqlite",
      ),
      { readOnly: true },
    );
    try {
      return new Map(
        db
          .prepare(
            `
        SELECT l.id, EXISTS (SELECT 1 FROM json_each(l.body, '$.data.assumes')) AS assumed
        FROM graph_links l
        LEFT JOIN graph_library_targets t ON t.link=l.id AND t.role='target'
        WHERE l.module='rust' AND
            (l.resolution='resolved' OR (l.resolution='library' AND t.symbol IS NOT NULL))
      `,
          )
          .all()
          .map(({ id, assumed }) => [id, assumed]),
      );
    } finally {
      db.close();
    }
  }
  const [base, original, fixed, control] = runs;
  const results = [];
  for (const [id, { commit }] of base.repos) {
    if (affectedOnly && fixed.repos.get(id)?.outcome !== "finished") continue;
    const before = links(base, id, commit);
    const previous = links(original, id, commit);
    const after = links(fixed, id, commit);
    const withdrawn = [...previous].filter(([link]) => !after.has(link));
    if (affectedOnly) {
      if (withdrawn.length) results.push(id);
      continue;
    }
    const relaxed = withdrawn.length ? links(control, id, commit) : new Map();
    const counts = {
      newProofLostToProvenance: 0,
      newAssumedLostToProvenance: 0,
      newProofLostToExport: 0,
      newAssumedLostToExport: 0,
      c12LostToProvenance: 0,
      c12LostToExport: 0,
      gainsAfterReview: 0,
    };
    for (const [link, assumed] of withdrawn) {
      const group = before.has(link)
        ? "c12"
        : assumed
          ? "newAssumed"
          : "newProof";
      const cause = relaxed.has(link) ? "Provenance" : "Export";
      counts[`${group}LostTo${cause}`]++;
    }
    for (const link of after.keys())
      if (!previous.has(link)) counts.gainsAfterReview++;
    results.push({ id, ...counts });
  }
  console.log(JSON.stringify(results, null, 2));
}
