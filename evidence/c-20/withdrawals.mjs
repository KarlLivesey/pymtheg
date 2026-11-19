// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const [scratch, batch, inventory] = process.argv.slice(2);
const seed = "pymtheg-c20-withdrawals-2026";
const { changes } = JSON.parse(gunzipSync(readFileSync(inventory)));
const repos = JSON.parse(readFileSync(batch, "utf8")).repos;
const roots = new Map(
  repos.map((repo) => [repo.id, join(scratch, repo.attempt, "checkout")]),
);
const level2 = (link) =>
  link?.resolution === "resolved" ||
  (link?.resolution === "library" &&
    link.libraries.some(({ symbol }) => symbol));
const groups = Map.groupBy(
  changes.filter((row) => level2(row[6]) && !level2(row[7])),
  (row) => row[5],
);
const pools = [...groups]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, rows]) =>
    rows
      .map((row) => ({
        row,
        rank: createHash("sha256")
          .update(seed)
          .update(JSON.stringify(row.slice(0, 5)))
          .digest("hex"),
      }))
      .sort((a, b) => a.rank.localeCompare(b.rank)),
  );
let drawn = 0;
for (let depth = 0; drawn < 40 && pools.some((pool) => pool[depth]); depth++) {
  for (const pool of pools) {
    const pick = pool[depth];
    if (!pick) continue;
    const [pin, file, start, end, name, kind, bare, installed] = pick.row;
    const source = readFileSync(join(roots.get(pin), file), "utf8");
    const line = source.slice(0, start).split("\n").length;
    const snippet = source
      .split("\n")
      .slice(line - 1, line + 1)
      .join("\n")
      .slice(0, 500);
    console.log(
      JSON.stringify({
        pin,
        file,
        line,
        start,
        end,
        name,
        kind,
        snippet,
        bare,
        installed,
      }),
    );
    if (++drawn === 40) break;
  }
}
