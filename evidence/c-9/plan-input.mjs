// SPDX-License-Identifier: MIT
// Layer the same reviewed inputs as main's plan, then replace the Rust pins.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const scratch = process.env.PYM_SCRATCH;
const archived = (path) => JSON.parse(gunzipSync(readFileSync(path)));
const overlay = (base, next) => ({
  ...next,
  repos: [
    ...new Map(
      [...base.repos, ...next.repos].map((repo) => [repo.id, repo]),
    ).values(),
  ],
});
const base = overlay(
  archived("evidence/sw-3/breakdown.json.gz"),
  archived("evidence/c-4/coverage-plan-input.json.gz"),
);
const candidate = JSON.parse(
  readFileSync(join(scratch, "candidate-coverage.json"), "utf8"),
);
const rust = overlay(
  archived("evidence/c-7/review-2/coverage-plan-input.json.gz"),
  candidate,
);
writeFileSync(join(scratch, "plan-base.json"), JSON.stringify(base));
writeFileSync(join(scratch, "plan-candidate.json"), JSON.stringify(rust));
