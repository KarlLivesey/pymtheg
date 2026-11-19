// SPDX-License-Identifier: MIT
// Regenerate the Rust section of the coverage plan from a C-15 export.
//   node plan.mjs EXPORT.json            writes $PYM_SCRATCH/c15-plan-base.json
//                                        and c15-plan-input.json
//   node plan.mjs GENERATED.md PLAN.md   copies the generated Rust section
//                                        into PLAN.md, leaving the rest as is
// The Rust input layers the export (the 20 Rust pins and vercel/turborepo,
// whose Rust workspace the Rust section counts) over C-10's Rust input; the
// base is the one main's plan uses (SW-3 overlaid by C-4).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const load = (path) =>
  JSON.parse(
    path.endsWith(".gz")
      ? gunzipSync(readFileSync(path))
      : readFileSync(path, "utf8"),
  );
const overlay = (earlier, later) => ({
  ...later,
  repos: [
    ...new Map(
      [...earlier.repos, ...later.repos].map((row) => [row.id, row]),
    ).values(),
  ],
});
const [source, destination] = process.argv.slice(2);
if (destination) {
  const heading = /^### Rust\n[\s\S]*?(?=^### |^<!-- sweep:coverage:end -->)/m;
  const generated = readFileSync(source, "utf8").match(heading)?.[0];
  const current = readFileSync(destination, "utf8");
  if (!generated || !heading.test(current))
    throw Error("Expected the generated Rust section");
  writeFileSync(destination, current.replace(heading, () => generated));
  process.exit(0);
}
const scratch = process.env.PYM_SCRATCH;
const base = overlay(
  load("evidence/sw-3/breakdown.json.gz"),
  load("evidence/c-4/coverage-plan-input.json.gz"),
);
const rust = overlay(
  load("evidence/c-10/coverage-plan-input.json.gz"),
  load(source),
);
writeFileSync(join(scratch, "c15-plan-base.json"), JSON.stringify(base));
writeFileSync(join(scratch, "c15-plan-input.json"), JSON.stringify(rust));
