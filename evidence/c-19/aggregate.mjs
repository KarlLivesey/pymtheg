// SPDX-License-Identifier: MIT
// C-19: 18-pin sums from the per-pin joins: why the toolchain gives no
// answer, collisions and generated items, gains by kind, library identity
// shapes, candidate-set checks. Usage: node aggregate.mjs WORK
import { readFileSync } from "node:fs";
import { join } from "node:path";

const work = process.argv[2];
const pins = readFileSync(join(work, "pins.txt"), "utf8").trim().split("\n").map((l) => l.split(" ")[0]);
const add = (acc, obj, keyFn = (k) => k) => {
  for (const [k, n] of Object.entries(obj ?? {})) acc[keyFn(k)] = (acc[keyFn(k)] ?? 0) + n;
};
const noAnswer = {};
const cross = {};
const identity = {};
const candidates = {};
const gainKinds = {};
const notIndexedDirs = {};
let links = 0, traitDecl = 0, nonTestCfg = 0, generatedNotCredited = 0;
for (const pin of pins) {
  const r = JSON.parse(readFileSync(join(work, "out", `${pin}.default.join.json`), "utf8"));
  links += r.links;
  add(noAnswer, r.toolchainNoAnswer, (k) => (k.startsWith("file-not-indexed") ? k : k.split(":")[0]));
  add(cross, r.cross, (k) => k.split(" | ")[1]);
  add(identity, r.libraryIdentityShapes, (k) => k.replace(/ descriptor:\w+/, ""));
  add(candidates, r.candidateSets);
  add(gainKinds, r.withToolchain.gainByKindAndFirstReason, (k) => k.split(" | ")[0] + " | " + k.split(" | ")[2]);
  add(notIndexedDirs, r.notIndexedLinksByDirectory, (k) => `${pin}/${k}`);
  traitDecl += r.withToolchain.gainThatIsTraitDeclaration;
  nonTestCfg += r.withToolchain.gainUnderNonTestCfg;
  generatedNotCredited += r.withToolchain.generatedNotCredited;
}
const sorted = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
console.log(
  JSON.stringify(
    {
      links,
      toolchainAnswerByLink: sorted(cross),
      toolchainNoAnswer: sorted(noAnswer),
      notIndexedTopDirectories: Object.fromEntries(Object.entries(sorted(notIndexedDirs)).slice(0, 15)),
      gainTraitDeclaration: traitDecl,
      gainUnderNonTestCfg: nonTestCfg,
      generatedNotCredited,
      gainByKind: sorted(gainKinds),
      libraryAnswerShapes: sorted(identity),
      candidateSets: sorted(candidates),
    },
    null,
    1,
  ),
);
