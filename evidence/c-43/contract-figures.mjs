// SPDX-License-Identifier: MIT
// C-43, D17 clarified: the three figures per pin from measure-route.mjs's
// records (source-only, with the route, with the route counting only
// `none-seen` links) and the data checks, as a Markdown table.
//   node evidence/c-43/contract-figures.mjs evidence/c-43/pins/*.json
import { readFileSync } from "node:fs";

const rows = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, "utf8")));
const n = (x) => (x ?? 0).toLocaleString("en-GB");
const p = (a, b) => (b ? `${((100 * a) / b).toFixed(2)}%` : "—");
const used = rows.filter((r) => r.state === "used").sort((a, b) => b.route.links - a.route.links);
const other = rows.filter((r) => r.state !== "used");
const out = [
  "| Pin | Rust links | Source-only | With the route | Route, none-seen only | Decided | of which seen | Route-off data differs | Source-only Level 2 lost or changed |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
];
const t = { links: 0, so: 0, route: 0, none: 0, decided: 0, seen: 0, off: 0, lost: 0 };
for (const r of used) {
  const R = r.route, S = r.sourceOnly, c = r.check;
  out.push(
    `| ${r.pin} | ${n(R.links)} | ${p(S.level2, R.links)} | ${p(R.level2, R.links)} | ${p(R.level2NoneSeen, R.links)} | ${n(R.toolchainDecided)} | ${n(R.toolchainSeen)} | ${n(c.routeOffDiffers)} | ${n(c.lost + c.changedLevel2)} |`,
  );
  t.links += R.links; t.so += S.level2; t.route += R.level2; t.none += R.level2NoneSeen;
  t.decided += R.toolchainDecided; t.seen += R.toolchainSeen; t.off += c.routeOffDiffers; t.lost += c.lost + c.changedLevel2;
}
out.push(
  `| **${used.length} used** | ${n(t.links)} | ${p(t.so, t.links)} | ${p(t.route, t.links)} | ${p(t.none, t.links)} | ${n(t.decided)} | ${n(t.seen)} | ${n(t.off)} | ${n(t.lost)} |`,
);
for (const r of other) out.push(`| ${r.pin} | ${r.state}: ${String(r.reason ?? "").slice(0, 80)} | | | | | | | |`);
console.log(out.join("\n"));
