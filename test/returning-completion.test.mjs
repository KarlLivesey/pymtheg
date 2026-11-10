import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { callableSnippet } from "../dist/studio/completion.js";
import { analyseFile } from "../dist/analysis/index.js";
test("completion in a returning flow leaves explicit result holes rather than accidental missing returns", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-return-snippet-"));
  try {
    const result = {
      kind: "tagged",
      label: "Result",
      variants: [
        { tag: "Ok", payload: { kind: "nat", label: "Nat" } },
        { tag: "Unavailable", payload: null },
      ],
    };
    const operation = {
      name: "fetch",
      kind: "op",
      callable: { parameters: [], result },
    };
    const caller = { callable: { result: { kind: "nat", label: "Nat" } } };
    const snippet = callableSnippet(operation, caller).replace(
      /\$\{([^}]+)\}/g,
      "$1",
    );
    assert.equal((snippet.match(/return unknown/g) || []).length, 2);
    const file = join(root, "test.pym");
    await writeFile(
      file,
      "type Errors = Unavailable;\nop fetch() -> Result<Nat, Errors>;\nflow run() -> Nat {\n" +
        snippet +
        "\n}",
    );
    const { report } = analyseFile(file);
    assert.deepEqual(
      report.diagnostics.filter((d) => d.severity === "error"),
      [],
    );
    assert.ok(report.results.some((r) => r.completion === "incomplete"));
    const unit = callableSnippet(operation, {
      callable: { result: { kind: "unit", label: "Unit" } },
    });
    assert.doesNotMatch(unit, /return unknown/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("call completions suggest only unambiguous in-scope values and leave ownership moves explicit", () => {
  const nat = { kind: "nat", label: "Nat" };
  const source = {
    name: "save",
    kind: "op",
    callable: {
      parameters: [{ name: "quantity", shape: nat }],
      result: { kind: "unit", label: "Unit" },
    },
  };
  assert.match(
    callableSnippet(source, {
      callable: { parameters: [{ name: "count", shape: nat }] },
    }),
    /save\(\$\{count\}\)/,
  );
  assert.match(
    callableSnippet(source, {
      callable: {
        parameters: [
          { name: "count", shape: nat },
          { name: "other", shape: nat },
        ],
      },
    }),
    /unknown "Value for quantity"/,
  );
  assert.match(
    callableSnippet(
      {
        ...source,
        callable: {
          ...source.callable,
          parameters: [{ name: "quantity", shape: nat, mode: "take" }],
        },
      },
      { callable: { parameters: [{ name: "quantity", shape: nat }] } },
    ),
    /take \$\{unknown/,
  );
});

test("unsupported or identical-looking nominal forms cannot erase resolved type identity", () => {
  const shape = {
    kind: "unsupported",
    label: "Guided input size limit reached; use the source editor",
  };
  const callee = {
    name: "save",
    kind: "op",
    callable: {
      parameters: [{ name: "value", shape, typeKey: "file#Left" }],
      result: { kind: "unit", label: "Unit" },
    },
  };
  const caller = {
    callable: { parameters: [{ name: "input", shape, typeKey: "file#Right" }] },
  };
  assert.match(callableSnippet(callee, caller), /unknown "Value for value"/);
  caller.callable.parameters[0].typeKey = "file#Left";
  assert.match(callableSnippet(callee, caller), /\$\{input\}/);
  delete callee.callable.parameters[0].typeKey;
  delete caller.callable.parameters[0].typeKey;
  assert.match(callableSnippet(callee, caller), /unknown "Value for value"/);
});
