// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";

const [scratch, baseline, candidate] = process.argv.slice(2);
const read = (receipt) =>
  new Map(
    JSON.parse(readFileSync(receipt, "utf8")).repos.map((row) => [row.id, row]),
  );
const main = read(baseline);
const next = read(candidate);
const old = JSON.parse(
  gunzipSync(readFileSync("evidence/c-20/definite-changes.json.gz")),
);
const level2 = (link) =>
  link?.resolution === "resolved" ||
  (link?.resolution === "library" &&
    link.libraries.some(({ symbol }) => typeof symbol === "string"));
const withdraw = old.changes.filter(
  ([, , , , , , bare, installed]) => level2(bare) && !level2(installed),
);
function connect(repo) {
  if (repo?.outcome !== "finished" || repo.install?.status !== "installed")
    return undefined;
  return new DatabaseSync(
    join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );
}
const checks = (db) =>
  db?.prepare(`SELECT l.resolution, t.file AS targetFile,
    json_extract(t.body, '$.key') AS targetKey,
    json_extract(l.body, '$.data.reason') AS reason,
    (SELECT json_group_array(json_array(ecosystem,unit,symbol))
      FROM graph_library_targets WHERE link=l.id) AS libraries
    FROM graph_links AS l INDEXED BY graph_link_file
    LEFT JOIN graph_symbols AS t ON t.id=l.target
    WHERE l.module='typescript' AND l.file=? AND
      json_extract(l.body,'$.range.start')=? AND
      json_extract(l.body,'$.range.end')=? AND
      json_extract(l.body,'$.targetName')=?`);
const definite = (row) =>
  row?.resolution === "resolved" ||
  (row?.resolution === "library" &&
    JSON.parse(row.libraries).some(
      ([, , symbol]) => typeof symbol === "string",
    ));
const restored = [];
const pins = [];
for (const [pin, rows] of Map.groupBy(withdraw, ([id]) => id)) {
  const a = connect(main.get(pin));
  const b = connect(next.get(pin));
  const before = checks(a);
  const after = checks(b);
  const counts = {
    pin,
    archived: rows.length,
    restoredOnMain: 0,
    restoredByC23: 0,
    withdrawnAgain: 0,
    stillWithdrawn: 0,
    unavailable: 0,
    ambiguousSite: 0,
  };
  for (const [id, file, start, end, name, previousClass, bare] of rows) {
    const x = before?.all(file, start, end, name);
    const y = after?.all(file, start, end, name);
    if (!x?.length || !y?.length) {
      counts.unavailable++;
    } else if (x.length !== 1 || y.length !== 1) {
      counts.ambiguousSite++;
    } else if (definite(y[0])) {
      counts[definite(x[0]) ? "restoredOnMain" : "restoredByC23"]++;
      restored.push({
        id,
        file,
        start,
        end,
        name,
        previousClass,
        bare,
        main: x[0],
        candidate: y[0],
      });
    } else {
      counts[definite(x[0]) ? "withdrawnAgain" : "stillWithdrawn"]++;
    }
  }
  a?.close();
  b?.close();
  pins.push(counts);
}
console.log(JSON.stringify({ pins, restored }));
