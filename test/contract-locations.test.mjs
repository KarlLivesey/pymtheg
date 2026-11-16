// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
const file = "/tmp/contract-locations.pym";
test("pending preconditions identify real lines and columns after Unicode and CRLF", () => {
  for (const newline of ["\n", "\r\n"]) {
    const source = [
      "// A deliberately long first line so byte offsets cannot look like line numbers.",
      "// Welsh: pymtheg; symbol: 🔎",
      "op use(n: Nat) -> Unit requires n > 0 effects(remote.Net);",
      "",
      "flow caller(n: Nat) -> Unit effects(remote.Net) {",
      "  call use(n);",
      "  return unit;",
      "}",
    ].join(newline);
    const { report } = analyseFile(file, () => {}, {
      buffers: { [file]: source },
    });
    const result = report.results.find(
      (r) => r.analysisKind === "call-contract",
    );
    assert.equal(
      result.outstandingObligations[0],
      `Establish use precondition at ${file}:6:3`,
    );
    assert.equal(result.outcome, "inconclusive");
  }
});
