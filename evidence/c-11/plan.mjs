// SPDX-License-Identifier: MIT
// Preserve the completed overlays already incorporated into main's plan.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

const load = (path) =>
  JSON.parse(
    path.endsWith(".gz")
      ? gunzipSync(readFileSync(path))
      : readFileSync(path, "utf8"),
  );
const baseline = load("evidence/sw-3/breakdown.json.gz");
const inputs = new Map();
const chunks = new Set(readdirSync("evidence"));
function overlay(packet, keepFinished = false) {
  for (const row of packet.repos) {
    const previous = inputs.get(row.id);
    if (
      keepFinished &&
      previous?.outcome === "finished" &&
      row.outcome !== "finished"
    )
      continue;
    inputs.set(row.id, row);
  }
}
for (const [chunk, name] of [
  ["c-1", "coverage-plan-input"],
  ["c-4", "coverage-plan-input"],
  ["c-7", "coverage-plan-input"],
  ["c-8", "coverage-plan-input"],
  ["c-9", "coverage-plan-input"],
]) {
  if (
    !chunks.has(chunk) ||
    !readdirSync(`evidence/${chunk}`).includes(`${name}.json.gz`)
  )
    continue;
  overlay(load(`evidence/${chunk}/${name}.json.gz`), true);
}
const packet = load(join(process.env.PYM_SCRATCH, "candidate-coverage.json"));
overlay(packet);
writeFileSync(
  join(process.env.PYM_SCRATCH, "c11-plan-input.json.gz"),
  gzipSync(
    JSON.stringify({
      ...baseline,
      release: packet.release,
      repos: [...inputs.values()],
    }),
  ),
);
