import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compatibleRelease,
  compatibleRequirement,
  matchesVersion,
} from "../dist/graph/languages/rust/macro-catalog.js";

for (const [audit, accepted, rejected] of [
  ["0.1.44", ["0.1.0", "0.1.30", "0.1.999"], ["0.0.99", "0.2.0"]],
  ["0.4.35", ["0.4.0", "0.4.17", "0.4.999"], ["0.3.99", "0.5.0"]],
  ["0.24.6", ["0.24.0", "0.24.999"], ["0.23.99", "0.25.0"]],
  ["1.0.104", ["1.0.0", "1.0.60", "1.999.0"], ["0.99.0", "2.0.0"]],
]) {
  test(`release family anchored by ${audit}`, () => {
    for (const v of accepted)
      assert.equal(compatibleRelease(audit, v), true, v);
    for (const v of [...rejected, "1.2.3-beta.1", undefined])
      assert.equal(compatibleRelease(audit, v), false, v);
  });
}
for (const [audit, accepted, rejected] of [
  [
    "0.1.44",
    ["0.1", "^0.1.30", "~0.1", "=0.1.30", "=0.1", "0.1.*", ">=0.1, <0.2"],
    ["0", "*", ">=0.1", "<0.2", "0.2", "0.1 || 0.2", ">=0.1, <=0.2"],
  ],
  [
    "1.54.1",
    ["1", "^1.2", "~1", "~1.20.0", "=1.20.0", "1.*", ">=1.2, <2"],
    ["*", ">=1", ">=1, <3", "0.9", "2", "1 || 2", "wat"],
  ],
]) {
  test(`unlocked requirement contained in ${audit} family`, () => {
    for (const req of accepted)
      assert.equal(compatibleRequirement(audit, req), true, req);
    for (const req of [...rejected, "", undefined])
      assert.equal(compatibleRequirement(audit, req), false, req);
  });
}
for (const [req, yes, no] of [
  ["^0.1", ["0.1.0", "0.1.99"], ["0.0.9", "0.2.0"]],
  ["~1.2", ["1.2.0", "1.2.99"], ["1.1.9", "1.3.0"]],
  ["=1.2", ["1.2.0", "1.2.99"], ["1.1.9", "1.3.0"]],
  [">1.2", ["1.3.0", "2.0.0"], ["1.2.99"]],
  ["<=1.2", ["1.2.99", "0.1.0"], ["1.3.0"]],
  [">=1.2, <2", ["1.2.0", "1.99.0"], ["1.1.99", "2.0.0"]],
  ["*", ["0.1.0", "2.0.0"], []],
]) {
  test(`locked release satisfies Cargo requirement ${req}`, () => {
    for (const v of yes) assert.equal(matchesVersion(req, v), true, v);
    for (const v of no) assert.equal(matchesVersion(req, v), false, v);
  });
}
