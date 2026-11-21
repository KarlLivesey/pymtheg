// SPDX-License-Identifier: MIT
// The whole tracked TypeScript/JS input is an upper bound for any program,
// including sources pulled in through workspace links. UTF-8 bytes also
// bound the TypeScript host's UTF-16 character count.
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [scratch, receipt] = process.argv.slice(2);
const { repos } = JSON.parse(readFileSync(receipt, "utf8"));
const rows = [];
for (const repo of repos) {
  if (repo.outcome !== "finished") continue;
  const attempt = join(scratch, repo.sourceAttempt ?? repo.attempt);
  const files = readFileSync(join(attempt, "tree.out"), "utf8").split("\0");
  let bytes = 0;
  for (const item of files) {
    if (!/^100(?:644|755) blob /.test(item)) continue;
    const path = item.slice(item.indexOf("\t") + 1);
    if (!/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(path)) continue;
    const stat = lstatSync(join(attempt, "checkout", path));
    if (stat.isFile()) bytes += stat.size;
  }
  rows.push({ pin: repo.id, checkoutBytesUpperBound: bytes });
}
console.log(JSON.stringify(rows, null, 2));
