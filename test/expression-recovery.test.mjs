// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../dist/language/parser.js";
import { analyseFile } from "../dist/analysis/index.js";
import { describeBlocks } from "../dist/studio/block-model.js";
test("an empty repeat expression keeps an editable source hole and never establishes the broken flow", () => {
  const file = "/tmp/pym-expression-recovery/main.pym";
  const text =
    'import "independent.pym"; flow main() -> Unit { for i in { return unit; } }';
  const parsed = parse(file, text);
  assert.ok(parsed.diagnostics.some((d) => d.code === "P002"));
  const flow = parsed.declarations.find((d) => d.name === "main");
  assert.ok(flow, "The enclosing flow must remain in the recovered AST");
  assert.equal(flow.body[0].count.kind, "unknown");
  assert.equal(flow.body[0].count.span.start, flow.body[0].count.span.end);
  const { ir, report } = analyseFile(file, () => {}, {
    buffers: {
      [file]: text,
      "/tmp/pym-expression-recovery/independent.pym":
        "op tick() -> Unit cost calls exact 1; flow clean() -> Unit { call tick(); }",
    },
  });
  const blocks = describeBlocks(ir, file);
  assert.equal(blocks.parsed, false);
  const field = blocks.blocks[0].sections[0].blocks[0].fields[0];
  assert.equal(text.slice(field.span.start, field.span.end), "");
  assert.ok(
    report.results
      .filter((r) => r.propertyId.includes("#main/"))
      .every((r) => r.outcome !== "established"),
  );
  assert.ok(
    report.results.some(
      (r) =>
        r.propertyId.includes("#clean/cost/") && r.outcome === "established",
    ),
  );
});
