// SPDX-License-Identifier: MIT
// C-50: compare two stores row for row, with each context file's `stamp`
// (the copied directory's inode and modification time, which differ for
// every copy of a checkout) replaced by a placeholder.
// Usage: node compare-stores.mjs A.sqlite B.sqlite
import { compareRows, storeRows } from "../../scripts/reindex/dump.mjs";

const [a, b] = process.argv.slice(2);
const normalise = (rows) =>
  Object.fromEntries(
    Object.entries(rows).map(([table, records]) => [
      table,
      records.map((record) => {
        if (table !== "graph_contexts") return record;
        const row = JSON.parse(record);
        const body = JSON.parse(row.body);
        if (body.dependency?.stamp !== undefined) body.dependency.stamp = "*";
        return JSON.stringify({ ...row, body: JSON.stringify(body) });
      }),
    ]),
  );
const differences = compareRows(normalise(storeRows(a)), normalise(storeRows(b)));
console.log(
  JSON.stringify({
    equal: differences.length === 0,
    differences: differences.map((d) => ({ table: d.table, rows: d.onlyIncremental })),
  }),
);
