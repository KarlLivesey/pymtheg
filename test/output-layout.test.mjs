// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { recursiveLayout } from "../dist/contracts/layout.js";
test("a ten-thousand-type inline cycle gets indirection on every edge without overflowing the stack", () => {
  const count = 10000;
  const document = {
    schema: "pymtheg.contracts/v1",
    snapshotId: "test",
    omitted: [],
    declarations: Array.from({ length: count }, (_, i) => ({
      symbolId: `T${i}`,
      name: `T${i}`,
      kind: "record",
      notes: [],
      span: { file: "test.pym", start: 0, end: 0 },
      fields: [
        {
          name: "next",
          type: { kind: "named", symbolId: `T${(i + 1) % count}` },
        },
      ],
    })),
  };
  for (const target of ["rust", "go"]) {
    const result = recursiveLayout(document, target);
    assert.equal(result.recursive, true);
    for (let i = 0; i < count; i++)
      assert.equal(
        result.needsIndirection(`T${i}`, `T${(i + 1) % count}`),
        true,
      );
  }
});
