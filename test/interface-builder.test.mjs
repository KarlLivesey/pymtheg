import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildInterface,
  validateInterfaceType,
} from "../dist/studio/interface-builder.js";
import { analyseFile } from "../dist/analysis/index.js";
import { scaffold } from "../dist/contracts/scaffold.js";
test("a record/list/outcome interface becomes ordinary typed source with an explicit unfinished body", async () => {
  const source = buildInterface(
    "quote",
    [
      {
        name: "order",
        type: {
          kind: "record",
          name: "Order",
          fields: [
            { name: "sku", type: "String" },
            { name: "quantity", type: "Nat" },
          ],
        },
      },
      { name: "tags", type: { kind: "list", element: "String" } },
    ],
    {
      kind: "result",
      ok: {
        kind: "record",
        name: "Quote",
        fields: [{ name: "approved", type: "Bool" }],
      },
      error: {
        kind: "choice",
        name: "QuoteErrors",
        variants: [
          { name: "Declined", payload: "String" },
          { name: "Unavailable" },
        ],
      },
    },
    [{ kind: "remote", target: "Payments" }],
  );
  const root = await mkdtemp(join(tmpdir(), "pym-interface-"));
  try {
    const file = join(root, "quote.pym");
    await writeFile(file, source);
    const { report, ir } = analyseFile(file);
    assert.ok(report.diagnostics.some((d) => d.code === "U001"));
    assert.deepEqual(
      report.diagnostics.filter((d) => d.severity === "error"),
      [],
    );
    assert.match(
      scaffold(ir).source,
      /order: Order, tags: ReadonlyArray<string>/,
    );
    assert.match(scaffold(ir).source, /Result<Quote, QuoteErrors>/);
    assert.match(source, /effects\(remote.Payments\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("builder rejects duplicate fields, unresolved types and excessive depth rather than writing malformed source", () => {
  assert.throws(
    () =>
      buildInterface(
        "bad",
        [
          {
            name: "input",
            type: {
              kind: "record",
              name: "Input",
              fields: [
                { name: "x", type: "Bool" },
                { name: "x", type: "String" },
              ],
            },
          },
        ],
        "Unit",
      ),
    /distinct/,
  );
  assert.throws(
    () =>
      buildInterface(
        "bad",
        [{ name: "input", type: { kind: "named", name: "Missing" } }],
        "Unit",
      ),
    /Declare/,
  );
  let type = "String";
  for (let i = 0; i < 10; i++) type = { kind: "list", element: type };
  assert.throws(() => validateInterfaceType(type), /nested/);
});

test("effect authoring has a deterministic count limit", () => {
  assert.throws(
    () =>
      buildInterface(
        "main",
        [],
        "Unit",
        Array.from({ length: 21 }, () => ({
          kind: "remote",
          target: "Service",
        })),
      ),
    /at most 20 effects/,
  );
});

test("adding an input after removal cannot reuse an existing default name", async () => {
  const { appendInterfaceInput } = await import(
    "../dist/studio/interface-builder.js"
  );
  const inputs = [
    { name: "input1", type: "String" },
    { name: "input3", type: "Nat", mode: "value" },
  ];
  const next = appendInterfaceInput(inputs);
  assert.equal(next[2].name, "input4");
  assert.deepEqual(next.slice(0, 2), inputs);
  assert.deepEqual(next[2].type, { kind: "unselected" });
  assert.throws(
    () => buildInterface("created", next, "Unit"),
    /input4.*choose what/,
  );
  next[2].type = "String";
  const ir = analyseFile("/tmp/input-allocator.pym", () => {}, {
    buffers: {
      "/tmp/input-allocator.pym": buildInterface("created", next, "Unit"),
    },
  });
  assert.equal(
    ir.report.diagnostics.some((d) => d.code === "T002"),
    false,
  );
});
