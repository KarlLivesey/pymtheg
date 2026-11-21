// SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { installedCoverage } from "../../scripts/sweep/coverage.mjs";

const [input, baseline, output = baseline] = process.argv.slice(2);
const plan = readFileSync(baseline, "utf8");
const data = JSON.parse(gunzipSync(readFileSync(input)));
const coverage = installedCoverage(data.repos, data.installedCoverage);
const start = "<!-- C-25 TypeScript replay start -->";
const end = "<!-- C-25 TypeScript replay end -->";
const heading = "### TypeScript / JavaScript\n\n";
const { workspace, unbuilt } = coverage;
if (!workspace || !unbuilt || plan.split(heading).length !== 2)
  throw Error("Expected a paired C-25 replay and one TypeScript plan section");

const format = new Intl.NumberFormat("en-US");
const supplement = [
  start,
  "#### C-25 workspace entry replay",
  "",
  "This repeat covers the 18 primary TypeScript pins. The inventory and ceiling below come from the full SW-4 baseline and its fixed review sample.",
  "",
  `Through an unbuilt workspace entry, plain tsc build · ${format.format(unbuilt.bare)} bare · ${format.format(unbuilt.installed)} installed.`,
  "",
  `The unbuilt workspace entry assumption accounts for ${format.format(workspace.bareAssumed)} bare and ${format.format(workspace.installedAssumed)} installed Level 2 links. Pins without a completed installed graph contribute their bare score. See the [C-25 change note](changes/C-25.md) for the exclusions and per-pin comparison.`,
  coverage.table.replace("\n## TypeScript installed coverage\n\n", "\n"),
  end,
  "",
  "",
].join("\n");
const clean = plan.replace(new RegExp(`${start}[\\s\\S]*?${end}\\n\\n`), "");
writeFileSync(output, clean.replace(heading, heading + supplement));
