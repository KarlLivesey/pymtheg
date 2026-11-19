// SPDX-License-Identifier: MIT
// Draw eight distinct stored symbol targets per named corpus repository.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const scratch = process.env.PYM_SCRATCH;
const [build, ...repos] = process.argv.slice(2);
const attempts = JSON.parse(
  readFileSync(join(scratch, `${build}-run.json`), "utf8"),
).repos;
const seed = "c11-4b6932d0";
const compare = (a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);

for (const id of repos) {
  const repo = attempts.find((attempt) => attempt.id === id);
  if (repo?.outcome !== "finished") throw Error(`No finished graph for ${id}`);
  const root = join(scratch, repo.attempt, "checkout");
  const db = new DatabaseSync(join(root, ".pymtheg/rebuildable/graph.sqlite"), {
    readOnly: true,
  });
  const smallest = { runtime: [], package: [] };
  try {
    const rows =
      db.prepare(`SELECT l.file,l.body,t.ecosystem,t.unit,t.symbol,t.evidence
      FROM graph_library_targets t JOIN graph_links l ON l.id=t.link
      WHERE l.module='typescript' AND t.role='target' AND t.symbol IS NOT NULL`);
    for (const { file, body, ...target } of rows.iterate()) {
      const { kind, targetName, range } = JSON.parse(body);
      const runtime = ["typescript-lib", "dom"].includes(target.ecosystem);
      const group = runtime ? smallest.runtime : smallest.package;
      const limit = runtime ? 6 : 2;
      const rank = createHash("sha256")
        .update(
          JSON.stringify([
            seed,
            id,
            repo.commit,
            file,
            range,
            kind,
            targetName,
          ]),
        )
        .digest("hex");
      if (
        (group.length === limit && rank >= group.at(-1).rank) ||
        group.some((item) => item.rank === rank)
      )
        continue;
      group.push({ rank, file, range, kind, targetName, ...target });
      group.sort(compare);
      if (group.length > limit) group.pop();
    }
  } finally {
    db.close();
  }
  if (smallest.runtime.length + smallest.package.length !== 8)
    throw Error(`Draw has too few library sites in ${id}`);
  for (const { file, range, ...target } of [
    ...smallest.runtime,
    ...smallest.package,
  ]) {
    const source = readFileSync(join(root, file), "utf8");
    const line = source.slice(0, range.start).split("\n").length;
    console.log(
      JSON.stringify({
        repo: id,
        file,
        line,
        ...target,
        source: source.split("\n")[line - 1]?.trim().slice(0, 160),
      }),
    );
  }
}
