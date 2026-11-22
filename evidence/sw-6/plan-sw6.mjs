// SPDX-License-Identifier: MIT
// SW-6 plan post-step. After `coverage.mjs` regenerates the plan from
// evidence/sw-6/coverage-plan-input.json.gz, this inserts the TypeScript
// remaining-work list and marks the Go and Rust sections as measured at SW-5. Run from the repository root:
//   node evidence/sw-6/plan-sw6.mjs docs/coverage-plan.md
// With --print it writes only the remaining-work section to stdout.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { libraryModuleLinks } from "../../scripts/sweep/coverage-rules.mjs";

const dir = "evidence/sw-6";
const read = (name) => JSON.parse(readFileSync(`${dir}/${name}`, "utf8"));
const archive = JSON.parse(
  gunzipSync(readFileSync(`${dir}/coverage-plan-input.json.gz`)),
);
const sites = read("remaining-sites.json");
const candidates = read("candidate-split.json").total;
const unseen = read("unseen-split.json");
const configSplit = read("config-split.json");
const constants = read("const-count.json");
const moduleCheck = read("module-links.json");
const { groups: verdicts } = read("verdicts.json");

// Installed TypeScript totals over the 20 TypeScript pins (D19 headline).
const pins = JSON.parse(readFileSync("sweep/repos.json", "utf8")).filter(
  (p) => p.language === "typescript",
);
const total = { links: 0, level2: 0, assumed: 0 };
const counted = [];
for (const { id } of pins) {
  const installed = archive.modes.installed.repos.find((r) => r.id === id);
  const repo =
    installed?.counts && installed.install?.status === "installed"
      ? installed
      : archive.modes.bare.repos.find((r) => r.id === id);
  if (repo) counted.push(repo);
  for (const k of Object.keys(total))
    total[k] += repo?.counts?.typescript?.[k] ?? 0;
}
const below = total.links - total.level2;
const listed = sites.groups.reduce((n, g) => n + g.links, 0);
if (listed !== below)
  throw Error(
    `Remaining groups (${listed}) do not reconcile with the archive (${below})`,
  );
// D20: the module links of imports are Level 2, as their own part.
const unit = sites.groups.find((g) => g.reason === "(unit only)");
const modules = libraryModuleLinks(counted, "typescript");
if (modules !== (unit.kinds.imports ?? 0))
  throw Error(
    `Library module links (${modules}) do not match the unit-only imports (${unit.kinds.imports})`,
  );
if (moduleCheck.links !== modules)
  throw Error(
    `The module-link check (${moduleCheck.links}) does not cover the library module links (${modules})`,
  );
const overcount = moduleCheck.names["something else"] ?? 0;
const withModules = total.level2 + modules;
const gap = Math.ceil(0.9 * total.links - total.level2);
const gapModules = Math.ceil(0.9 * total.links - withModules);
const fmt = (n) => Math.round(n).toLocaleString("en-GB");
const pp = (n) => ((100 * n) / total.links).toFixed(2);
const short = (id) => id.split("/")[1];
const sumPrefix = (map, prefixes) =>
  Object.entries(map).reduce(
    (n, [key, links]) =>
      n + (prefixes.some((p) => key.startsWith(p)) ? links : 0),
    0,
  );
const marked = (reason, yes) =>
  unseen[
    `${reason} | ${yes ? "computed beside an unread file (C-13 marker)" : "no unread file in the program"}`
  ]?.links ?? 0;

// `as const` assertions among a group's links, marked or not (they are a
// defect whichever program computed them, so they form their own part).
const constAssertions = (reason, yes) =>
  yes === undefined
    ? constAssertions(reason, true) + constAssertions(reason, false)
    : (constants.reasons[
        `${reason} | ${yes ? "computed beside an unread file (C-13 marker)" : "no unread file in the program"}`
      ] ?? 0);

const partCount = (group, part) => {
  if (part.share !== undefined) return group.links * part.share;
  if (part.kind) return group.kinds[part.kind] ?? 0;
  if (part.kindNot) return group.links - (group.kinds[part.kindNot] ?? 0);
  if (part.pin) return group.pins[part.pin] ?? 0;
  if (part.pinNot) return group.links - (group.pins[part.pinNot] ?? 0);
  if (part.pinsNot)
    return (
      group.links - part.pinsNot.reduce((n, id) => n + (group.pins[id] ?? 0), 0)
    );
  if (part.marked !== undefined)
    return (
      marked(group.reason, part.marked) -
      constAssertions(group.reason, part.marked)
    );
  if (part.constants) return constAssertions(group.reason);
  if (part.config) return sumPrefix(configSplit.byBase, part.config);
  if (part.configNot)
    return group.links - sumPrefix(configSplit.byBase, part.configNot);
  if (part.shape) return candidates[part.shape] ?? 0;
  if (part.shapes)
    return part.shapes.reduce((n, s) => n + (candidates[s] ?? 0), 0);
  throw Error(`Unknown split for ${group.reason}`);
};
// For a config part, the three largest reasons the links would have without the config gap.
const behind = (part) => {
  if (!part.config) return "";
  const reasons = {};
  for (const [key, links] of Object.entries(configSplit.reasonWithoutConfig))
    if (part.config.some((p) => key.startsWith(p))) {
      const reason = key.split(" | ")[2];
      reasons[reason] = (reasons[reason] ?? 0) + links;
    }
  const top = Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  return top.length
    ? `; next blockers ${top.map(([r, n]) => `\`${r}\` ${fmt(n)}`).join(", ")}`
    : "";
};

// Rows: every group below Level 2 without library module links; the unit-only
// group keeps only its member links (its imports are Level 2 under D20).
// Its pins are recounted from the archive inventory without the imports.
const memberPins = {};
for (const repo of counted)
  for (const [module, kind, outcome, reasons, links] of repo.inventory ?? [])
    if (
      module === "typescript" &&
      outcome === "library" &&
      !reasons.length &&
      kind !== "imports"
    )
      memberPins[repo.id] = (memberPins[repo.id] ?? 0) + links;
const groups = sites.groups
  .map((g) =>
    g === unit
      ? {
          ...g,
          links: g.links - modules,
          kinds: { ...g.kinds, imports: 0 },
          pins: memberPins,
        }
      : g,
  )
  .sort((a, b) => b.links - a.links);
const unitMembers = groups.find((g) => g.reason === "(unit only)");
if (
  Object.values(unitMembers.pins).reduce((n, v) => n + v, 0) !==
  unitMembers.links
)
  throw Error(
    "Unit-only member links do not reconcile with the archive inventory",
  );
const rows = [];
const tail = { links: 0, reasons: [] };
for (const group of groups) {
  const verdict = verdicts.find((v) => v.reason === group.reason);
  if (!verdict) {
    tail.links += group.links;
    tail.reasons.push(`${group.reason} ${fmt(group.links)}`);
    continue;
  }
  const example = group.sites.find(
    (site) => group.reason !== "(unit only)" || site.kind !== "imports",
  );
  const top = Object.entries(group.pins)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, n]) => `${short(id)} ${fmt(n)}`)
    .join(", ");
  const parts = (verdict.split ?? []).map(
    (part) =>
      `${part.part}: ${fmt(partCount(group, part))} (${pp(partCount(group, part))} pp)${behind(part)}`,
  );
  rows.push(
    `| \`${group.reason}\` | ${fmt(group.links)} | ${pp(group.links)} | ${Object.keys(group.pins).length} (${top}) | ${example.pin} \`${example.file}:${example.line}\` | ${verdict.shape}${parts.length ? "<br>" + parts.join("<br>") : ""} | ${verdict.provable} |`,
  );
}
rows.push(
  `| Remaining reasons | ${fmt(tail.links)} | ${pp(tail.links)} | | | ${tail.reasons.join(", ")} | Mixed; together under 0.2 points. |`,
);

// The route to 90%: the provable parts, then the assumption-marked route.
const local = sites.groups.find((g) => g.reason === "local");
const external = marked("external", true) - constAssertions("external", true);
const unitCalls = unit.links - modules;
const localMembers = local.links * 0.5;
const astro = sumPrefix(configSplit.byBase, ["withastro/astro | "]);
const turboPackages = sumPrefix(configSplit.byBase, [
  "vercel/turborepo | packages/ | ",
]);
const configs = astro + turboPackages;
const provable = external + unitCalls + localMembers + configs;
const entry = [
  "workspace-entry-unavailable",
  "workspace-build-output-missing",
].reduce(
  (n, r) => n + (sites.groups.find((g) => g.reason === r)?.links ?? 0),
  0,
);
const puppeteer =
  sites.groups.find((g) => g.reason === "no-symbol").pins[
    "puppeteer/puppeteer"
  ] ?? 0;
const global = candidates["one name declared by several library typings"];
const rate = (level2) => ((100 * level2) / total.links).toFixed(2);
const both = (extra) =>
  `${rate(total.level2 + extra)}% without library module links, ${rate(withModules + extra)}% with them`;

const section = [
  "<!-- SW-6 remaining work start -->",
  "#### What is left on the installed sweep (SW-6)",
  "",
  `Installed Level 2 on the 20 TypeScript pins is **${rate(total.level2)}%** without library module links (${fmt(total.level2)} of ${fmt(total.links)} links; ${rate(total.level2 - total.assumed)}% proven, ${rate(total.assumed)}% assumption-marked). With the ${fmt(modules)} library module links (${pp(modules)} points) that D20 counts, it is **${rate(withModules)}%**. Reaching 90% needs ${fmt(gap)} more Level 2 links (${pp(gap)} points) without them, or ${fmt(gapModules)} (${pp(gapModules)} points) with them. One point is ${fmt(total.links / 100)} links. The bare figure is SW-4's, not re-run.`,
  "",
  `The graphs show what the library module links name: ${fmt(moduleCheck.names["the module specifier"] ?? 0)} name the module specifier and ${fmt(moduleCheck.names["a whole-module binding (*)"] ?? 0)} are whole-module bindings (\`import * as\`, \`require\`, \`export * from\`). The other ${fmt(overcount)} (${pp(overcount)} points) name an imported member or \`default\` with only the package, or a \`/// <reference lib>\`. D20 does not credit these, but the archive inventory cannot tell them apart, so the figure with library module links includes them. [Check](../evidence/sw-6/module-links.json)`,
  "",
  "Each group is the first stored blocker, counted exactly over the 19 pins that finished. The table leaves out the library module links, which are Level 2 under D20. Shapes come from 10 sites per group at seed `pymtheg-sw6-2026`, read in the pinned source, and from mechanical splits where the stored facts allow. Splits marked estimate rest on those 10 sites only. [Sites](../evidence/sw-6/remaining-sites.json) · [Verdicts](../evidence/sw-6/verdicts.json)",
  "",
  "| First stored reason | Links | Points | Pins (largest) | Example | Shape and split | Provable from source and installed declarations? |",
  "| --- | ---: | ---: | --- | --- | --- | --- |",
  ...rows,
  "",
  "**Route to 90%.** Each figure is a group's full size, an upper bound: when a cause is fixed, some of its links will fall into another group instead of reaching Level 2.",
  "",
  `1. Provable without new assumptions, about ${pp(provable)} points (${both(provable)}, if all are recovered):`,
  `   - library targets withheld beside an unread file, the links that carry C-13's per-link marker (${fmt(external)}, ${pp(external)} points);`,
  `   - library member calls that name only the package (${fmt(unitCalls)}, ${pp(unitCalls)} points);`,
  `   - members of checkout object and type literals that lack a graph symbol (an estimated ${fmt(localMembers)}, ${pp(localMembers)} points);`,
  `   - configs extended by package name whose base is installed as a workspace link: Astro's \`astro/tsconfigs/*\` and Turborepo's \`packages/\` extending \`@turbo/tsconfig/*\` (${fmt(configs)}, ${pp(configs)} points).`,
  "",
  `   Without library module links, even full recovery, including the estimated half of \`local\`, comes to ${rate(total.level2 + provable)}%. With them, the three exactly counted items (${fmt(provable - localMembers)} links) come to ${rate(withModules + provable - localMembers)}%, so reaching 90% also needs about ${fmt(Math.max(0, gapModules - (provable - localMembers)))} of the estimated \`local\` members.`,
  `2. Add the assumption-marked build-output route: workspace entries and build output (${fmt(entry)}, ${pp(entry)} points), and Puppeteer's links downstream of it (${fmt(puppeteer)}, ${pp(puppeteer)} points). That makes about ${pp(provable + entry + puppeteer)} points (${both(provable + entry + puppeteer)}).`,
  `3. As an alternative to part of step 2: a ruling that a global declared by several environment typings is one target (${fmt(global)}, ${pp(global)} points).`,
  "",
  "**Honest ceilings.** These should not become definite under the current definition:",
  "",
  "- receivers typed `any`, most of the no-symbol group (returned callables, undeclared globals, values downstream of other failures), and real candidate sets;",
  "- missing material under the scripts-disabled install: `external-package`, `missing-module`, and the configs that extend packages that are not installed (Turborepo's `examples/` workspaces, Redux Toolkit's Expo examples).",
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
  if (plan.split(heading).length !== 2)
    throw Error("Expected one TypeScript section");
  plan = plan.replace(heading, heading + section + "\n");
  for (const heading of ["### Go\n\n", "### Rust\n\n"]) {
    if (plan.split(heading).length !== 2)
      throw Error(`Expected one ${heading.trim()} section`);
    plan = plan.replace(
      heading,
      heading +
        "Unchanged since SW-5 (the figures come from SW-4's graphs); SW-6 refreshed only the installed TypeScript sweep.\n\n",
    );
  }
  writeFileSync(path, plan);
}
