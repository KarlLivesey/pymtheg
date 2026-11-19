// SPDX-License-Identifier: MIT
// Draw an equal number of proofs and assumed links from six eligible pins.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const { seed, results } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const rankPin = ({ id, commit }) =>
  createHash("sha256")
    .update(JSON.stringify([seed, id, commit]))
    .digest("hex");
const pins = results
  .filter(
    (row) => row.provenSample?.length >= 5 && row.assumedSample?.length >= 5,
  )
  .map((row) => ({ ...row, rank: rankPin(row) }))
  .sort((a, b) => a.rank.localeCompare(b.rank))
  .slice(0, 6);
if (pins.length !== 6)
  throw Error(`Expected six eligible pins; found ${pins.length}`);
console.log(
  JSON.stringify(
    pins.map(({ id, commit, provenSample, assumedSample }) => ({
      id,
      commit,
      proven: provenSample.slice(0, 5),
      assumed: assumedSample.slice(0, 5),
    })),
    null,
    2,
  ),
);
