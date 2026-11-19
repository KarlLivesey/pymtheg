// SPDX-License-Identifier: MIT
// C-19: 18-pin sums from the per-pin joins (strict join): what the toolchain
// answers, why it gives no usable answer, what the strict filters removed
// from the loose gain, incompatible kinds, library shapes and verification,
// candidate-set checks. Usage: node aggregate.mjs WORK
import { readFileSync } from "node:fs";
import { join } from "node:path";

const work = process.argv[2];
const pins = readFileSync(join(work, "pins.txt"), "utf8").trim().split("\n").map((l) => l.split(" ")[0]);
const add = (acc, o, keyFn = (k) => k) => {
  for (const [k, n] of Object.entries(o ?? {})) acc[keyFn(k)] = (acc[keyFn(k)] ?? 0) + n;
};
const sorted = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
const acc = { answerByLink: {}, noAnswer: {}, removed: {}, kindIncompatible: {}, identity: {}, verification: {}, candidates: {}, notIndexed: {}, verdicts: {} };
let links = 0;
let collidingSymbols = 0;
for (const pin of pins) {
  const r = JSON.parse(readFileSync(join(work, "out", `${pin}.default.join.json`), "utf8"));
  links += r.links;
  collidingSymbols += r.scip.symbolsDefinedMoreThanOnce;
  add(acc.answerByLink, r.cross, (k) => k.split(" | ")[1]);
  add(acc.noAnswer, r.toolchainNoAnswer, (k) => (k.startsWith("file-not-indexed") || k.startsWith("filter:") ? k : k.split(":")[0]));
  add(acc.removed, r.strictRemovedFromLooseGain);
  add(acc.kindIncompatible, r.kindIncompatible);
  add(acc.identity, r.libraryIdentityShapes);
  add(acc.verification, r.libraryVerification);
  add(acc.candidates, r.candidateSets);
  add(acc.notIndexed, r.notIndexedLinksByDirectory, (k) => `${pin}/${k}`);
  add(acc.verdicts, r.agreement, (k) => k.split(" | ").filter((_, i) => i !== 1).join(" | "));
}
console.log(
  JSON.stringify(
    {
      links,
      symbolsDefinedMoreThanOnce: collidingSymbols,
      strictAnswerByLink: sorted(acc.answerByLink),
      strictNoAnswer: sorted(acc.noAnswer),
      strictRemovedFromLooseGain: sorted(acc.removed),
      kindIncompatible: sorted(acc.kindIncompatible),
      notIndexedTopDirectories: Object.fromEntries(Object.entries(sorted(acc.notIndexed)).slice(0, 15)),
      definiteLinkVerdicts: sorted(acc.verdicts),
      libraryVerification: sorted(acc.verification),
      libraryAnswerShapes: sorted(acc.identity),
      candidateSets: sorted(acc.candidates),
    },
    null,
    1,
  ),
);
