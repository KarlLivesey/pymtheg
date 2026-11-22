// SPDX-License-Identifier: MIT
// SW-6 plan post-step. After `coverage.mjs` regenerates the plan from
// evidence/sw-6/coverage-plan-input.json.gz, this inserts the TypeScript
// remaining-work list, marks the Go and Rust sections as measured at SW-5 and
// points the evidence links at SW-6. Run from the repository root:
//   node evidence/sw-6/plan-sw6.mjs docs/coverage-plan.md
// With --print it writes only the remaining-work section to stdout.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const dir = "evidence/sw-6";
const read = (name) => JSON.parse(readFileSync(`${dir}/${name}`, "utf8"));
const archive = JSON.parse(gunzipSync(readFileSync(`${dir}/coverage-plan-input.json.gz`)));
const sites = read("remaining-sites.json");
const candidates = read("candidate-split.json").total;
const failed = read("failed-program-split.json");
const { groups: verdicts } = read("verdicts.json");

// Installed TypeScript totals over the 20 TypeScript pins (D19 headline).
const pins = JSON.parse(readFileSync("sweep/repos.json", "utf8")).filter((p) => p.language === "typescript");
const total = { links: 0, level2: 0, assumed: 0 };
for (const { id } of pins) {
  const installed = archive.modes.installed.repos.find((r) => r.id === id);
  const repo = installed?.counts && installed.install?.status === "installed"
    ? installed : archive.modes.bare.repos.find((r) => r.id === id);
  for (const k of Object.keys(total)) total[k] += repo?.counts?.typescript?.[k] ?? 0;
}
const below = total.links - total.level2;
const counted = sites.groups.reduce((n, g) => n + g.links, 0);
if (counted !== below) throw Error(`Remaining groups (${counted}) do not reconcile with the archive (${below})`);
const gap = Math.ceil(0.9 * total.links - total.level2);
const fmt = (n) => Math.round(n).toLocaleString("en-GB");
const pp = (n) => (100 * n / total.links).toFixed(2);
const short = (id) => id.split("/")[1];

const partCount = (group, part) => {
  if (part.share !== undefined) return group.links * part.share;
  if (part.kind) return group.kinds[part.kind] ?? 0;
  if (part.kindNot) return group.links - (group.kinds[part.kindNot] ?? 0);
  if (part.pin) return group.pins[part.pin] ?? 0;
  if (part.pinNot) return group.links - (group.pins[part.pinNot] ?? 0);
  if (part.pinsNot) return group.links - part.pinsNot.reduce((n, id) => n + (group.pins[id] ?? 0), 0);
  if (part.failed !== undefined)
    return failed[`${group.reason} | ${part.failed ? "program has a failed file" : "no failed file in program"}`]?.links ?? 0;
  if (part.shape) return candidates[part.shape] ?? 0;
  if (part.shapes) return part.shapes.reduce((n, s) => n + (candidates[s] ?? 0), 0);
  throw Error(`Unknown split for ${group.reason}`);
};

const rows = [];
const tail = { links: 0, reasons: [] };
for (const group of sites.groups) {
  const verdict = verdicts.find((v) => v.reason === group.reason);
  if (!verdict) { tail.links += group.links; tail.reasons.push(`${group.reason} ${fmt(group.links)}`); continue; }
  const example = group.sites[0];
  const top = Object.entries(group.pins).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([id, n]) => `${short(id)} ${fmt(n)}`).join(", ");
  const parts = (verdict.split ?? []).map((part) => `${part.part}: ${fmt(partCount(group, part))} (${pp(partCount(group, part))} pp)`);
  rows.push(`| \`${group.reason}\` | ${fmt(group.links)} | ${pp(group.links)} | ${Object.keys(group.pins).length} (${top}) | ${example.pin} \`${example.file}:${example.line}\` | ${verdict.shape}${parts.length ? "<br>" + parts.join("<br>") : ""} | ${verdict.provable} |`);
}
rows.push(`| Remaining reasons | ${fmt(tail.links)} | ${pp(tail.links)} | | | ${tail.reasons.join(", ")} | Mixed; together under 0.2 points. |`);

// The route to 90%: the provable parts, then the assumption-marked route.
const local = sites.groups.find((g) => g.reason === "local");
const unit = sites.groups.find((g) => g.reason === "(unit only)");
const external = failed["external | program has a failed file"].links;
const unitCalls = unit.links - (unit.kinds.imports ?? 0);
const localMembers = local.links * 0.5;
const config = sites.groups.find((g) => g.reason === "incomplete-config");
const configs = (config.pins["vercel/turborepo"] ?? 0) + (config.pins["withastro/astro"] ?? 0);
const provable = external + unitCalls + localMembers + configs;
const entry = ["workspace-entry-unavailable", "workspace-build-output-missing"]
  .reduce((n, r) => n + (sites.groups.find((g) => g.reason === r)?.links ?? 0), 0);
const puppeteer = sites.groups.find((g) => g.reason === "no-symbol").pins["puppeteer/puppeteer"] ?? 0;
const global = candidates["one name declared by several library typings"];
const rate = (extra) => (100 * (total.level2 + extra) / total.links).toFixed(2);

const section = [
  "<!-- SW-6 remaining work start -->",
  "#### What is left on the installed sweep (SW-6)",
  "",
  `Installed Level 2 on the 20 TypeScript pins is **${(100 * total.level2 / total.links).toFixed(2)}%** (${fmt(total.level2)} of ${fmt(total.links)} links; ${(100 * (total.level2 - total.assumed) / total.links).toFixed(2)}% proven, ${(100 * total.assumed / total.links).toFixed(2)}% assumption-marked). Reaching 90% needs ${fmt(gap)} more Level 2 links, ${pp(gap)} points. One point is ${fmt(total.links / 100)} links. The bare figure is SW-4's, not re-run.`,
  "",
  "Each group is the first stored blocker, counted exactly over the 19 pins that finished. Shapes come from 10 sites per group at seed `pymtheg-sw6-2026`, read in the pinned source, and from mechanical splits where the stored facts allow. Splits marked estimate rest on those 10 sites only. [Sites](../evidence/sw-6/remaining-sites.json) · [Verdicts](../evidence/sw-6/verdicts.json)",
  "",
  "| First stored reason | Links | Points | Pins (largest) | Example | Shape and split | Provable from source and installed declarations? |",
  "| --- | ---: | ---: | --- | --- | --- | --- |",
  ...rows,
  "",
  "**Route to 90%.** Each figure is a group's full size, an upper bound: when a cause is fixed, some of its links will fall into another group instead of reaching Level 2.",
  "",
  `1. Provable without new assumptions, about ${pp(provable)} points (${rate(provable)}% if all are recovered):`,
  `   - library targets withheld in programs that contain a failed file (${fmt(external)}, ${pp(external)} points);`,
  `   - library member calls that name only the package (${fmt(unitCalls)}, ${pp(unitCalls)} points);`,
  `   - members of checkout object and type literals that lack a graph symbol (an estimated ${fmt(localMembers)}, ${pp(localMembers)} points);`,
  `   - configs extended by package name whose base is in the checkout: Turborepo's example workspaces and Astro's installed workspace link (${fmt(configs)}, ${pp(configs)} points).`,
  "",
  `   Even fully recovered, these only just reach 90%, and that rests on the estimated half of \`local\`. They are not enough on their own. (Turborepo's figure includes 48 links whose configs fail for other reasons.)`,
  `2. Add the assumption-marked build-output route: workspace entries and build output (${fmt(entry)}, ${pp(entry)} points), and Puppeteer's links downstream of it (${fmt(puppeteer)}, ${pp(puppeteer)} points). That makes about ${pp(provable + entry + puppeteer)} points, or ${rate(provable + entry + puppeteer)}%, which clears 90% with margin.`,
  `3. As an alternative to part of step 2: a ruling that a global declared by several environment typings is one target (${fmt(global)}, ${pp(global)} points).`,
  "",
  "**Honest ceilings.** These should not become definite under the current definition:",
  "",
  `- module links of imports (${fmt(unit.kinds.imports)}, ${pp(unit.kinds.imports)} points), which name a module, never a symbol;`,
  "- receivers typed `any`, most of the no-symbol group (returned callables, undeclared globals, values downstream of other failures), and real candidate sets;",
  "- missing material under the scripts-disabled install: `external-package`, `missing-module` and the configs that extend uninstalled packages.",
  "",
  "microsoft/TypeScript contributes no installed figure: it reached the 60-minute limit again.",
  "<!-- SW-6 remaining work end -->",
  "",
].join("\n");

if (process.argv.includes("--print")) {
  process.stdout.write(section);
} else {
  const path = process.argv[2];
  let plan = readFileSync(path, "utf8");
  const heading = "### TypeScript / JavaScript\n\n";
  if (plan.split(heading).length !== 2) throw Error("Expected one TypeScript section");
  plan = plan.replace(heading, heading + section + "\n");
  for (const heading of ["### Go\n\n", "### Rust\n\n"]) {
    if (plan.split(heading).length !== 2) throw Error(`Expected one ${heading.trim()} section`);
    plan = plan.replace(heading, heading + "Unchanged since SW-5 (the figures come from SW-4's graphs); SW-6 refreshed only the installed TypeScript sweep.\n\n");
  }
  plan = plan
    .replace("[Current sweep and source audit](../evidence/sw-5/coverage-plan-input.json.gz)", "[Current sweep and source audit](../evidence/sw-6/coverage-plan-input.json.gz)")
    .replace("[Per-pin outcomes, fallback details, time and memory](../evidence/sw-5/README.md)", "[Per-pin outcomes, fallback details, time and memory](../evidence/sw-6/README.md)");
  writeFileSync(path, plan);
}
