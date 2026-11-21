// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  createReadStream,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { gzipSync } from "node:zlib";

const root = process.env.PYM_SCRATCH;
const output = join(root, "publish");
mkdirSync(output, { recursive: true });
const file = (name) => join(root, name);
const read = (name) => JSON.parse(readFileSync(file(name), "utf8"));
const run = (...args) =>
  execFileSync(process.execPath, args, { stdio: "inherit" });
const pins = read("final.json").repos;
assert.equal(pins.length, 10);
assert.ok(pins.every((p) => p.outcome === "finished"));
run("evidence/c-31/compare.mjs");
run(
  "scripts/sweep/coverage-export.mjs",
  "--refresh",
  "--results",
  file("final.json"),
  "--scratch",
  file("final"),
  "--output",
  file("final-export.json"),
);

const comparison = read("comparison.json");
const before = read("main-export.json");
const after = read("final-export.json");
const fields = (counts) => [counts.links, counts.level2, counts.assumed];
for (const pin of comparison.pins) {
  assert.deepEqual(
    fields(before.repos.find((p) => p.id === pin.id).counts.rust),
    fields(pin.before),
  );
  assert.deepEqual(
    fields(after.repos.find((p) => p.id === pin.id).counts.rust),
    fields(pin.after),
  );
  assert.equal(pin.lost, 0);
  assert.equal(pin.symbolLoss + pin.symbolGain, 0);
}
for (const repo of after.repos) {
  delete repo.shortlist;
  // Pinned locations are sufficient to reproduce the examples.
  for (const sites of Object.values(repo.examples))
    for (const example of sites) {
      delete example.code;
      delete example.target;
    }
}
writeFileSync(
  join(output, "coverage-plan-input.json.gz"),
  gzipSync(JSON.stringify(after) + "\n", { level: 9 }),
);
writeFileSync(
  join(output, "comparison.json"),
  JSON.stringify(comparison, null, 2) + "\n",
);

const gains = readFileSync(file("new-links.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map(JSON.parse);
assert.equal(
  gains.length,
  comparison.totals.after.level2 - comparison.totals.before.level2,
);
const key = (r) => JSON.stringify([r.id, r.file, r.line, r.column, r.spelling]);
const bySite = new Map(gains.map((row) => [key(row), row]));
const counts = {};
for (const pin of pins) {
  const name = "diagnosis-" + pin.id.split("/")[1] + ".jsonl";
  const input = createInterface({
    input: createReadStream(file(name)),
    crlfDelay: Infinity,
  });
  for await (const line of input) {
    const r = JSON.parse(line);
    const next = bySite.get(key(r));
    if (!next) continue;
    const {
      source,
      excerpt,
      receiver,
      gap,
      recipe,
      owners,
      producer,
      details,
      category,
    } = r;
    next.diagnosis = {
      source,
      excerpt,
      receiver,
      gap,
      recipe,
      owners,
      producer,
      details,
      category,
    };
    counts[category] = (counts[category] ?? 0) + 1;
  }
}
const unmapped = gains.filter((r) => !r.diagnosis).length;
writeFileSync(
  file("gain-diagnosis.json"),
  JSON.stringify({ counts, unmapped }, null, 2) + "\n",
);
const review = gains.slice(0, 30).map((row) => {
  const pin = pins.find((p) => p.id === row.id);
  const lines = readFileSync(
    join(root, "final", pin.attempt, "checkout", row.file),
    "utf8",
  ).split("\n");
  const nearby = lines.slice(Math.max(0, row.line - 4), row.line + 2);
  return { ...row, nearby };
});
writeFileSync(file("gain-review.json"), JSON.stringify(review, null, 2) + "\n");
console.log(JSON.stringify({ gainClasses: counts, unmapped }));
