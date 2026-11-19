// SPDX-License-Identifier: MIT
// Regenerate the TypeScript section using the last full TypeScript overlay.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

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
const scratch = process.env.PYM_SCRATCH;
const [source = "candidate-coverage.json", destination] = process.argv.slice(2);
if (destination) {
  const heading =
    /^### TypeScript \/ JS\n[\s\S]*?(?=^<!-- sweep:coverage:end -->)/m;
  const generated = readFileSync(source, "utf8").match(heading)?.[0];
  const current = readFileSync(destination, "utf8");
  if (!generated || !heading.test(current))
    throw Error("Expected the generated TypeScript / JS section");
  writeFileSync(
    destination,
    current.replace(heading, () => generated),
  );
  process.exit(0);
}
const baseline = overlay(
  load("evidence/sw-3/breakdown.json.gz"),
  load("evidence/c-4/coverage-plan-input.json.gz"),
);
const main = load("evidence/c-7/review-2/coverage-plan-input.json.gz");
const typescript = load(join(scratch, source));
const result = overlay(main, typescript);
writeFileSync(
  join(scratch, "c11-plan-base.json.gz"),
  gzipSync(JSON.stringify(baseline)),
);
writeFileSync(
  join(scratch, "c11-plan-input.json.gz"),
  gzipSync(JSON.stringify(result)),
);
writeFileSync(
  join(scratch, "coverage-plan-input.json.gz"),
  gzipSync(JSON.stringify(typescript)),
);
