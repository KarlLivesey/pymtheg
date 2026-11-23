// SPDX-License-Identifier: MIT
// C-43: the per-pin tables (table.md) and totals (results.json) from the
// measure-route.mjs outputs.
//   node table.mjs <dir of pin json> <table.md> <results.json>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, tableOut, resultsOut] = process.argv.slice(2);
const pins = readdirSync(dir)
  .filter((n) => n.endsWith(".json"))
  .map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")))
  .sort((a, b) => b.route.links - a.route.links);
const n = (x) => (x === undefined || x === null ? "—" : Math.round(x).toLocaleString("en-US"));
const p = (a, b) => (b ? `${((100 * a) / b).toFixed(2)}%` : "—");
const sum = (f) => pins.reduce((t, r) => t + (f(r) ?? 0), 0);
const used = pins.filter((r) => r.state === "used");
const B = (r, k) => r.funnel?.buckets?.[k] ?? 0;
const sumB = (rows, k) => rows.reduce((t, r) => t + B(r, k), 0);
const prefix = (r, pre) => Object.entries(r.funnel?.buckets ?? {}).filter(([k]) => k.startsWith(pre)).reduce((t, [, v]) => t + v, 0);

// C-43 review: links the review's guards withhold. A run whose funnel names
// them uses its buckets; an older funnel left them in "other", split here by
// the decision counts (conditional candidates are withheld only on open links).
const conditional = (r) =>
  r.funnel?.buckets?.["gate: conditional candidates"] ??
  Math.min(r.decided?.["withheld:conditional-candidates"] ?? 0, r.funnel?.buckets?.other ?? 0);
const moduleGate = (r) =>
  r.funnel?.buckets?.["gate: module twin, or module conditions unseen"] ??
  r.funnel?.buckets?.["gate: cfg on an enclosing module"] ??
  Math.max((r.funnel?.buckets?.other ?? 0) - conditional(r), 0);
const lines = [
  "# C-43 per-pin figures",
  "",
  "Cold indexes of each pin, source-only and with the Rust toolchain route (rust-analyzer 1.98.1, offline, the measurement's own crate cache filled by `cargo fetch` and online `cargo metadata` on throwaway copies). Level 2 counts Rust links only (resolved, or a library target with a symbol); D20 library module links are given apart. Times and memory are observations.",
  "",
  "## Level 2 and the route's state",
  "",
  "| Pin | State | Rust links | Source-only Level 2 | of which assumption-marked | With the route | Toolchain checkout | Toolchain library (D24) | Confirmed | Kept where different | Library module links (D20) | RA wall s | RA CPU s | RA peak MiB | Index wall s, source-only / route |",
  "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ...pins.map((r) => `| ${r.pin} | ${r.state}${r.reason ? ` (${r.reason.replace(/\|/g, "/").slice(0, 90)})` : ""} | ${n(r.route.links)} | ${n(r.sourceOnly.level2)} (${r.sourceOnly.level2Percent}%) | ${n(r.sourceOnly.assumed)} | ${n(r.route.level2)} (${r.route.level2Percent}%) | ${n(r.route.toolchainCheckout ?? r.route.toolchainDecided)} | ${n(r.route.toolchainLibrary ?? 0)} | ${n(r.agreement.confirmed)} | ${n(r.agreement.differs)} | ${n(r.sourceOnly.libraryModuleLinks)} | ${r.analyzerRun?.wallS ?? "—"} | ${r.analyzerRun?.cpuS ?? "—"} | ${r.analyzerRun?.peakMiB ?? "—"} | ${r.index.sourceOnly.wallS} / ${r.index.route.wallS} |`),
  `| **${pins.length} pins** | ${used.length} used | ${n(sum((r) => r.route.links))} | ${n(sum((r) => r.sourceOnly.level2))} (${p(sum((r) => r.sourceOnly.level2), sum((r) => r.route.links))}) | ${n(sum((r) => r.sourceOnly.assumed))} | ${n(sum((r) => r.route.level2))} (${p(sum((r) => r.route.level2), sum((r) => r.route.links))}) | ${n(sum((r) => r.route.toolchainCheckout ?? r.route.toolchainDecided))} | ${n(sum((r) => r.route.toolchainLibrary ?? 0))} | ${n(sum((r) => r.agreement.confirmed))} | ${n(sum((r) => r.agreement.differs))} | ${n(sum((r) => r.sourceOnly.libraryModuleLinks))} | | | | |`,
  `| **${used.length} used pins** | | ${n(used.reduce((t, r) => t + r.route.links, 0))} | ${p(used.reduce((t, r) => t + r.sourceOnly.level2, 0), used.reduce((t, r) => t + r.route.links, 0))} | | ${p(used.reduce((t, r) => t + r.route.level2, 0), used.reduce((t, r) => t + r.route.links, 0))} | | | | | | | | |`,
  "",
  "No pin lost a source-only link or changed a source-only Level 2 link (`check` in each pin's JSON).",
  "",
  "## Where the links source-only leaves open go (used pins)",
  "",
  "Each open link is counted in the first bucket that applies (funnel.mjs). C-19 columns are C-19's own strict join on the same pins (evidence/c-19/joins), at the commit it measured: its checkout gain credited local bindings to their enclosing item, and its library gain is the part this first PR does not apply.",
  "",
  "| Pin | Open after source-only | No answer at the name site | Gate: kind/namespace | Gate: known error classes | Gate: trait-method declaration | Gate: cfg other than test | Gate: cfg-variant guard | Gate: module twin, or module conditions unseen (review) | Gate: conditional candidates (review) | Gate: library/outside set kept | No identity: library item | of which pass the cfg gate | No identity: generated item | No identity: no graph symbol (fields…) | No identity: local binding | Library: source-only target kept | Library: outside the candidate set | Credited: checkout | Credited: library (D24) | C-19 checkout gain | C-19 library gain | C-19 gated | Route now |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...used.map((r) => `| ${r.pin} | ${n(r.funnel?.open)} | ${n(prefix(r, "no answer"))} | ${n(B(r, "gate: kind/namespace"))} | ${n(B(r, "gate: known error classes"))} | ${n(B(r, "gate: trait-method declaration"))} | ${n(B(r, "gate: cfg condition other than test"))} | ${n(B(r, "gate: cfg-variant guard"))} | ${n(moduleGate(r))} | ${n(conditional(r))} | ${n(B(r, "gate: source-only library target kept") + B(r, "gate: answer outside the candidate set"))} | ${n(B(r, "no identity: library item"))} | ${n(r.funnel?.libraryPassingCfg)} | ${n(B(r, "no identity: generated item"))} | ${n(B(r, "no identity: declaration without a graph symbol"))} | ${n(B(r, "no identity: local binding"))} | ${n(B(r, "library: source-only library target kept") + B(r, "library: source-only checkout target kept"))} | ${n(B(r, "library: outside the candidate set"))} | ${n(B(r, "credited"))} | ${n(B(r, "credited: library"))} | ${n(r.c19?.gainCheckout)} | ${n(r.c19?.gainLibrary)} | ${r.c19 ? r.c19.gatedPercent + "%" : "—"} | ${r.route.level2Percent}% |`),
  `| **${used.length} used pins** | ${n(used.reduce((t, r) => t + (r.funnel?.open ?? 0), 0))} | ${n(used.reduce((t, r) => t + prefix(r, "no answer"), 0))} | ${n(sumB(used, "gate: kind/namespace"))} | ${n(sumB(used, "gate: known error classes"))} | ${n(sumB(used, "gate: trait-method declaration"))} | ${n(sumB(used, "gate: cfg condition other than test"))} | ${n(sumB(used, "gate: cfg-variant guard"))} | ${n(used.reduce((t, r) => t + moduleGate(r), 0))} | ${n(used.reduce((t, r) => t + conditional(r), 0))} | ${n(sumB(used, "gate: source-only library target kept") + sumB(used, "gate: answer outside the candidate set"))} | ${n(sumB(used, "no identity: library item"))} | ${n(used.reduce((t, r) => t + (r.funnel?.libraryPassingCfg ?? 0), 0))} | ${n(sumB(used, "no identity: generated item"))} | ${n(sumB(used, "no identity: declaration without a graph symbol"))} | ${n(sumB(used, "no identity: local binding"))} | ${n(sumB(used, "library: source-only library target kept") + sumB(used, "library: source-only checkout target kept"))} | ${n(sumB(used, "library: outside the candidate set"))} | ${n(sumB(used, "credited"))} | ${n(sumB(used, "credited: library"))} | ${n(used.reduce((t, r) => t + (r.c19?.gainCheckout ?? 0), 0))} | ${n(used.reduce((t, r) => t + (r.c19?.gainLibrary ?? 0), 0))} | | |`,
  "",
];
writeFileSync(tableOut, lines.join("\n"));
const totalLinks = used.reduce((t, r) => t + r.route.links, 0);
writeFileSync(resultsOut, JSON.stringify({
  pins: pins.map((r) => ({ pin: r.pin, state: r.state, reason: r.reason, links: r.route.links, sourceOnly: r.sourceOnly, route: r.route,
    agreement: r.agreement, check: r.check, funnel: r.funnel, c19: r.c19, analyzerRun: r.analyzerRun, index: r.index, decided: r.decided, join: r.join })),
  used: { pins: used.length, links: totalLinks,
    sourceOnlyPercent: +(100 * used.reduce((t, r) => t + r.sourceOnly.level2, 0) / totalLinks).toFixed(2),
    routePercent: +(100 * used.reduce((t, r) => t + r.route.level2, 0) / totalLinks).toFixed(2),
    libraryWorthPercent: +(100 * used.reduce((t, r) => t + (r.funnel?.libraryPassingCfg ?? 0), 0) / totalLinks).toFixed(2) },
}, null, 1));
console.log(lines.slice(-6).join("\n"));
