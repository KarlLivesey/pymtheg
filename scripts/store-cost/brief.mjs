// SPDX-License-Identifier: MIT
// C-37: one line per measure.mjs result: wall, CPU, SQL, commits and their
// time, the final checkpoint on close, the longest write-lock hold, bytes
// written and peak RSS.
//   node scripts/store-cost/brief.mjs <result.json>...
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const s = (ms) => (ms / 1000).toFixed(1);
const gib = (bytes) => (bytes / 1073741824).toFixed(2);
for (const path of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(path, "utf8"));
  const sql = r.statements.reduce((sum, x) => sum + x.wallMs, 0);
  const commit = r.statements
    .filter((x) => x.sql === "COMMIT")
    .reduce((sum, x) => ({ ms: sum.ms + x.wallMs, n: sum.n + x.calls }), {
      ms: 0,
      n: 0,
    });
  console.log(
    [
      basename(path, ".json"),
      `wall ${s(r.wallMs)}`,
      `cpu ${s(r.cpuMs)}`,
      `sql ${s(sql)}`,
      `commits ${commit.n} (${s(commit.ms)} s)`,
      `close ${s(r.closeMs ?? 0)}`,
      `longest hold ${s(r.longestHoldMs ?? 0)}`,
      `budget ${r.writeBatchRows ?? "-"}`,
      `written ${gib(r.io.write_bytes)} GiB (wchar ${gib(r.io.wchar)})`,
      `peak ${(r.maxRssKiB / 1024).toFixed(0)} MiB`,
    ].join(", "),
  );
}
