// SPDX-License-Identifier: MIT
// Print the first N rows of a compare.mjs JSONL file with source context for a
// hand check: the link's line (with 2 lines before) and the target's
// declaration line, read from the branch run's checkouts.
//   node audit-context.mjs <rows.jsonl> <N> <run.json>:<scratch>...
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [rowsPath, n, ...runs] = process.argv.slice(2);
const attempts = new Map();
for (const pair of runs) {
  const [runPath, scratch] = pair.split(":");
  for (const r of JSON.parse(readFileSync(runPath, "utf8")).repos)
    if (r.attempt) attempts.set(r.id, join(scratch, r.attempt));
}
const rows = readFileSync(rowsPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .slice(0, Number(n));
const lines = (repo, file) => {
  try {
    return readFileSync(
      join(attempts.get(repo), "checkout", file),
      "utf8",
    ).split("\n");
  } catch {
    return [];
  }
};
rows.forEach((r, i) => {
  const src = lines(r.repo, r.file);
  const t = r.after?.target;
  console.log(
    `#${i + 1} ${r.repo} ${r.file}:${r.line} ${r.kind} ${r.targetName} [${r.site ?? ""}] ${r.before?.resolution ?? "-"} -> ${r.after?.resolution}`,
  );
  for (let k = Math.max(1, r.line - 2); k <= r.line; k++)
    console.log(`   ${k}| ${src[k - 1]?.slice(0, 200)}`);
  if (t) {
    const tl = lines(r.repo, t.file);
    console.log(
      `   => ${t.kind} ${t.name} at ${t.file}:${t.line}| ${tl[t.line - 1]?.trim().slice(0, 200)}`,
    );
  } else console.log(`   => ${JSON.stringify(r.after?.libraries ?? null)}`);
  if (r.before?.target)
    console.log(
      `   (main: ${r.before.target.kind} ${r.before.target.name} at ${r.before.target.file}:${r.before.target.line})`,
    );
});
