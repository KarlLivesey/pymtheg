// SPDX-License-Identifier: MIT
// Tally newly Level 2 links by pin, previous reason and new resolution.
import { readFileSync } from "node:fs";
const counts = new Map();
for (const line of readFileSync(process.argv[2], "utf8").split("\n")) {
  if (!line) continue;
  const r = JSON.parse(line);
  const k = `${r.pin} | ${r.before.reason ?? r.before.resolution} | ${r.resolution}`;
  counts.set(k, (counts.get(k) ?? 0) + 1);
}
for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1])) console.log(v + "\t" + k);
