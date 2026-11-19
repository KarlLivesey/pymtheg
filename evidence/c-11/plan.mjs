// SPDX-License-Identifier: MIT
// Preserve the completed overlays already incorporated into main's plan.
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
const baseline = overlay(
  load("evidence/sw-3/breakdown.json.gz"),
  load("evidence/c-4/coverage-plan-input.json.gz"),
);
const main = load("evidence/c-7/review-2/coverage-plan-input.json.gz");
const source = process.argv[2] ?? "candidate-coverage.json";
const result =
  source === "main" ? main : overlay(main, load(join(scratch, source)));
writeFileSync(
  join(scratch, "c11-plan-base.json.gz"),
  gzipSync(JSON.stringify(baseline)),
);
writeFileSync(
  join(scratch, "c11-plan-input.json.gz"),
  gzipSync(JSON.stringify(result)),
);
