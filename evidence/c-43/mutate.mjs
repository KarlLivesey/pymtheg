// SPDX-License-Identifier: MIT
// C-43 mutation table: each gate, label check and seventh-review fix is
// broken in turn, the core rebuilt, and the tests that should catch it run.
// A mutation is caught when at least one test fails. One that survives its
// named tests is run again against the whole toolchain test file.
//   node evidence/c-43/mutate.mjs [name…] > table.json
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const INDEX = "src/graph/languages/rust/index.ts";
const TOOLCHAIN = "src/graph/languages/rust/toolchain.ts";
const ANALYSIS = "src/graph/analysis.ts";
const TESTS = "test/graph-rust-toolchain.test.mjs";

/** [name, file, written text, replacement, test-name pattern]. */
const MUTATIONS = [
  // Gates that do not depend on the configuration.
  ["gate: import namespaces", INDEX, "importNamespaces(target, lastSegment(l.targetName))", "false", "glob twins of gated modules \\(no opaque"],
  ["gate: no symbol", INDEX, 'if (!identityOf.has(target)) return kept("withheld:no-symbol");', "if (!identityOf.has(target)) return l;", "^gates"],
  ["gate: source-only differs", INDEX, 'return kept("kept:source-only-differs");', 'from = "definite";', "^gates: a source-only definite target"],
  ["gate: source-only library", INDEX, 'else if (r?.library) return kept("kept:source-only-library");', "else if (false) {}", "^gates|library"],
  ["gate: source-only library, resolve phase", ANALYSIS, "if (link.targetId === record.target) {", "if (link.targetId === record.target || link.data !== undefined) {", "^gates: a source-only library"],
  ["gate: outside the candidate set", INDEX, "if (!r.candidateIds.includes(target))", "if (false)", "^gates|candidate"],
  ["gate: outside the listed cfg twins (seventh review)", INDEX, "!listed.includes(target)", "false", "^gates: an answer outside"],
  // The record.
  ["record: route-off data", INDEX, "...(from === \"definite\" ? {} : { routeOff: { ...rest } }),", "", "sixth review G"],
  // The label.
  ["label: cfg-link", INDEX, "beyondTest(rest.conditions as Json[] | undefined)", "false", "^gates: a checkout answer"],
  ["label: opaque-shadow", INDEX, 'reasons.includes("opaque-item-may-shadow-name")', "false", "second review B1|sixth review: selections"],
  ["label: selected item on the trace", INDEX, "if (selectedItem(entry.id, site)) return selected;", "", "fifth review: a cfg-selected|oracle"],
  ["label: generated entry", INDEX, '} else if (entry.k === "generated") return selected;', '} else if (entry.k === "generated") {}', "second review B1|sixth review: selections"],
  ["label: selected use of the first segment", INDEX, "(use.glob || use.name === first) &&", "false &&", "glob twins|fifth review: a cfg-selected"],
  ["label: selected use of a later segment", INDEX, "(selectedImportNames.get(segment) ?? []).some((cs) =>", "[].some((cs) =>", "oracle"],
  ["label: selected candidate", INDEX, "if (candidates.some((c) => c !== target && selectedItem(c, site)))", "if (false)", "oracle"],
  ["label: gated function", INDEX, "if (gatedFunctions.has(trace.enclosing!))", "if (false)", "oracle|sixth review: selections"],
  ["label: selected member", INDEX, "if ((members.get(name) ?? []).some((cs) => unmet(cs, site)))", "if (false)", "oracle"],
  ["label: selected import on a receiver", INDEX, "          !use.notTrait\n", "          false\n", "^gates|basic|oracle"],
  ["label: field under a cfg (review of 90c66e77, item 2)", INDEX, "(owner?.gatedFields ?? []).includes(entry.name) ||", "false ||", "oracle"],
  ["label: field whose type names a selection (review of 90c66e77)", INDEX, "typeNamesSelected(owner?.fieldTypes.get(entry.name) ?? \"\", site)", "false", "fifth review: a cfg-selected|oracle"],
  ["label: a later segment on a receiver trace (review of 90c66e77, item 5)", INDEX, "for (const traced of traceNames)", "for (const traced of [] as string[])", "oracle"],
  ["label: Deref/Index impl", INDEX, "if ((derefImpls.get(fact.name) ?? []).some((cs) => unmet(cs, site)))", "if (false)", "oracle"],
  // Seventh-review fixes outside the decider.
  ["fix 3: validate before caching", TOOLCHAIN, "partial.push(`crate root ${path} is not in the index`);", "{}", "library root"],
  ["fix 5: cargo config precedence", TOOLCHAIN, "plain ?? toml;", "toml ?? plain;", "seventh review 5"],
  ["review of 90c66e77, 7: outside dependencies’ files in the key", TOOLCHAIN, "${folder ? folderListing(at) : \"\"}", "", "item 7"],
  ["review of 90c66e77, 9: rustflags cfg flags recorded", TOOLCHAIN, "cfgFlags: rustflagsCfg(configs, target),", "cfgFlags: [],", "item 9"],
  ["fix 8: relative outside paths from the copy", TOOLCHAIN, "if (existsSync(original)) await symlink(original, placed);", "", "seventh review 8"],
];

const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28 });
const failed = (pattern) => {
  const args = ["--import", "./test/isolated-config.mjs", "--test", "--test-concurrency=4", "--test-reporter=tap"];
  if (pattern) args.push(`--test-name-pattern=${pattern}`);
  const out = run("node", [...args, TESTS]).stdout ?? "";
  const ran = out.match(/^ok \d+ - .*|^not ok \d+ - .*/gm) ?? [];
  return {
    ran: ran.length,
    failed: ran.filter((x) => x.startsWith("not ok")).map((x) => x.replace(/^not ok \d+ - /, "")),
  };
};

const only = process.argv.slice(2);
const rows = [];
for (const [name, file, from, to, pattern] of MUTATIONS) {
  if (only.length && !only.includes(name)) continue;
  const original = readFileSync(file, "utf8");
  const count = original.split(from).length - 1;
  if (count !== 1) {
    rows.push({ name, error: `text found ${count} times` });
    continue;
  }
  try {
    writeFileSync(file, original.replace(from, to));
    execFileSync("npx", ["tsc"], { stdio: "ignore" });
    let result = failed(pattern);
    let scope = pattern;
    if (!result.failed.length) {
      result = failed(undefined);
      scope = "whole file";
    }
    rows.push({ name, caught: result.failed.length > 0, scope, ran: result.ran, failed: result.failed });
  } finally {
    writeFileSync(file, original);
  }
  process.stderr.write(`${name}: ${rows.at(-1).caught ? "caught" : "SURVIVED"}\n`);
}
execFileSync("npx", ["tsc"], { stdio: "ignore" });
// The unmutated tree passes the same patterns.
const control = failed(undefined);
console.log(JSON.stringify({ control, rows }, null, 2));
