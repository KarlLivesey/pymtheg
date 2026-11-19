// SPDX-License-Identifier: MIT
// Which stored file results an edit changed, and in what (C-22 diagnosis):
// compares graph_files bodies of two stores and, for each changed file other
// than the edited one, the first differing JSON paths of its result.
//   node scripts/reindex/changed-results.mjs <before.sqlite> <after.sqlite> [limit]
import { DatabaseSync } from "node:sqlite";

const [left, right, limitArg] = process.argv.slice(2);
const limit = Number(limitArg ?? 5);
const read = (path) => {
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = new Map(
    db
      .prepare("SELECT path, body FROM graph_files")
      .all()
      .map((row) => [row.path, JSON.parse(row.body)]),
  );
  db.close();
  return rows;
};
const a = read(left);
const b = read(right);
const differences = (x, y, path, out) => {
  if (out.length >= limit) return;
  if (JSON.stringify(x) === JSON.stringify(y)) return;
  if (x && y && typeof x === "object" && typeof y === "object") {
    for (const key of new Set([...Object.keys(x), ...Object.keys(y)]))
      differences(x[key], y[key], `${path}.${key}`, out);
  } else
    out.push(
      `${path}: ${JSON.stringify(x)?.slice(0, 120)} → ${JSON.stringify(y)?.slice(0, 120)}`,
    );
};
const changed = [...a.keys()].filter(
  (path) => JSON.stringify(a.get(path)) !== JSON.stringify(b.get(path)),
);
console.log(`${changed.length} file results changed`);
for (const path of changed.slice(0, 8)) {
  const out = [];
  differences(a.get(path)?.result, b.get(path)?.result, "result", out);
  console.log(`\n${path}\n  ${out.join("\n  ")}`);
}
