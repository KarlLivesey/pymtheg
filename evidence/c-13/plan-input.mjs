// SPDX-License-Identifier: MIT
// plan-input.mjs OUT_DIR [CANDIDATE_EXPORT] : the layered inputs of the
// coverage plan. plan-base.json is sw-3 overlaid with C-4's input (the base
// main's plan uses); plan-main.json is C-10's committed input (main's plan);
// with a candidate export, plan-candidate.json is plan-main.json with this
// chunk's pins replaced by the candidate's.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const [out, candidatePath] = process.argv.slice(2);
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
const main = archived("evidence/c-10/coverage-plan-input.json.gz");
writeFileSync(join(out, "plan-base.json"), JSON.stringify(base));
writeFileSync(join(out, "plan-main.json"), JSON.stringify(main));
if (candidatePath) {
  const read = candidatePath.endsWith(".gz")
    ? archived(candidatePath)
    : JSON.parse(readFileSync(candidatePath, "utf8"));
  writeFileSync(join(out, "plan-candidate.json"), JSON.stringify(overlay(main, read)));
}
