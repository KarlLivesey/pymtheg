// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyseFile } from "../dist/analysis/index.js";
import {
  describeOperationContract,
  rewriteOperationContract,
} from "../dist/studio/operation-contract.js";
const file = "/tmp/operation-edit.pym";
const source = `// Keep the boundary notes.
op reserve(n: Nat) -> Nat bound n <= 10 stable
  requires n >= 0 // caller responsibility
  ensures result >= n
  cost calls exact n + 1 atomic;
flow caller() -> Unit { call reserve(0) as value; return unit; }
flow independent() -> Unit { return unit; }
`;
function model(text = source) {
  const checked = analyseFile(file, () => {}, { buffers: { [file]: text } });
  const symbol = [...checked.ir.symbols.values()].find((s) => s.kind === "op");
  return { ...checked, id: symbol.id };
}
function description(m) {
  return describeOperationContract(m.ir, m.id);
}
function edit(m, next) {
  return rewriteOperationContract(m.ir, m.id, next, description(m).sourceHash);
}
const cost = (r) =>
  r.report.results.find((x) => x.propertyId.includes("#caller/cost/calls"))
    .witnessOrDerivation;
test("editing an existing contract reaches callers without rewriting their source", () => {
  const m = model(),
    d = description(m);
  assert.deepEqual(
    m.report.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  assert.equal(cost(m).maximum, "1");
  assert.deepEqual(d.definition.costs, [
    { metric: "calls", quality: "exact", expression: "n + 1" },
  ]);
  const result = edit(m, {
    ...d.definition,
    requires: ["n > 0"],
    costs: [{ metric: "calls", quality: "exact", expression: "n + 3" }],
  });
  assert.equal(
    result.text,
    source
      .replace("requires n >= 0", "requires (n > 0)")
      .replace("cost calls exact n + 1", "cost calls exact n + 3"),
  );
  const changed = model(result.text);
  assert.ok(changed.report.diagnostics.some((d) => d.code === "C004"));
  assert.equal(cost(changed).maximum, "3");
  assert.deepEqual(
    result.affected.map((x) => x.name),
    ["caller"],
  );
  assert.equal(result.affectedComplete, true);
  assert.ok(result.notices.some((x) => /assumptions/.test(x)));
  assert.equal(m.ir.snapshot.measurements.parses, 1);
});
test("add/remove clauses use owned spans; blank fields remain explicitly unknown", () => {
  const m = model(),
    d = description(m);
  const result = edit(m, {
    requires: [],
    ensures: [...d.definition.ensures, ""],
    costs: [],
  });
  assert.ok(result.text.includes("// caller responsibility"));
  assert.ok(
    result.text.includes('ensures (unknown "Guarantee 2 is not decided")'),
  );
  assert.ok(!result.text.includes("cost calls"));
  assert.ok(result.text.includes("bound n <= 10 stable"));
  assert.equal(
    model(result.text).ir.symbols.get(model(result.text).id).meta.atomic,
    true,
  );
  const unknownCost = edit(m, {
    ...d.definition,
    costs: [{ metric: "calls", quality: "upper", expression: "" }],
  });
  assert.ok(
    unknownCost.text.includes(
      'cost calls upper unknown "Work count for calls is not decided"',
    ),
  );
  assert.ok(
    model(unknownCost.text).report.results.some(
      (r) => r.completion === "incomplete",
    ),
  );
  const checked = model(result.text);
  assert.ok(checked.report.results.some((r) => r.completion === "incomplete"));
  assert.deepEqual(edit(m, d.definition).edits, []);
  const zero = model(
    "op ping() -> Unit; flow caller() -> Unit { call ping(); return unit; }",
  );
  const added = edit(zero, {
    requires: ["true"],
    ensures: ["true"],
    costs: [{ metric: "calls", quality: "upper", expression: "2" }],
  });
  assert.deepEqual(model(added.text).report.diagnostics, []);
});
test("protocol, resource creation and settlement metadata remain unchanged", async () => {
  const protocol = await readFile("examples/mvp/task-protocol.pym", "utf8");
  const m = model(protocol),
    d = description(m);
  const result = edit(m, {
    ...d.definition,
    costs: [{ metric: "calls", quality: "exact", expression: "2" }],
  });
  assert.equal(
    result.text,
    protocol.replace("cost calls exact 1", "cost calls exact 2"),
  );
  assert.deepEqual(
    model(result.text).report.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  const resources = `resource File { states Open, Closed; initial Open; terminal Closed; Open -> Closed; } type Failure = Failed;
op receiver(take file: File) -> Result<Unit, Failure> effects(state.File) settles file on (Ok) cost calls exact 1;`;
  const r = model(resources),
    rd = description(r);
  const updated = edit(r, { ...rd.definition, requires: ["true"] });
  assert.ok(
    updated.text.includes(
      "effects(state.File) settles file on (Ok) cost calls exact 1",
    ),
  );
  const creation = model(
    resources
      .replace(
        "receiver(take file: File) -> Result<Unit, Failure>",
        "receiver() -> Result<File, Failure>",
      )
      .replace("settles file on (Ok)", "creates result"),
  );
  const added = edit(creation, {
    ...description(creation).definition,
    ensures: ["true"],
  });
  assert.ok(added.text.includes("creates result cost calls exact 1"));
});
test("embedded notes cannot be erased, while slash-containing strings stay editable", () => {
  const m = model(
    source.replace(
      "requires n >= 0",
      "requires (n // Keep this relationship\n >= 0)",
    ),
  );
  const d = description(m);
  assert.throws(
    () => edit(m, { ...d.definition, requires: ["n > 0"] }),
    /embedded comment.*Text/,
  );
  assert.throws(
    () => edit(m, { ...d.definition, requires: [] }),
    /embedded comment.*Text/,
  );
  assert.equal(edit(m, d.definition).text, m.ir.snapshot.sources[0].text);
  const url = model(
    'op url(value: String) -> String requires value != "http://host";',
  );
  const changed = edit(url, {
    ...description(url).definition,
    requires: ['value != "https://host"'],
  });
  assert.ok(changed.text.includes('"https://host"'));
});
test("stale, injected, oversized and wrong-kind requests cannot produce an edit", () => {
  const m = model(),
    d = description(m);
  assert.throws(
    () => rewriteOperationContract(m.ir, m.id, d.definition, "old"),
    /source changed/,
  );
  assert.throws(
    () => describeOperationContract(m.ir, "missing#Type"),
    /external operation/,
  );
  assert.throws(
    () =>
      edit(m, { ...d.definition, requires: ["true; op injected() -> Unit;"] }),
    /one expression/,
  );
  assert.throws(() =>
    edit(m, { ...d.definition, ensures: Array(21).fill("true") }),
  );
  assert.throws(
    () =>
      edit(m, {
        ...d.definition,
        costs: [
          { metric: "calls", quality: "exact", expression: "1" },
          { metric: "calls", quality: "upper", expression: "2" },
        ],
      }),
    /each work metric once/,
  );
  assert.throws(
    () =>
      edit(m, {
        ...d.definition,
        costs: [
          {
            metric: "calls",
            quality: "exact",
            expression: "1; op injected() -> Unit;",
          },
        ],
      }),
    /one expression/,
  );
  assert.equal(m.ir.snapshot.sources[0].text, source);
});

test("removing an earlier rule or cost keeps surviving clauses with their own notes", () => {
  const text = `op reserve(n: Nat) -> Nat
  requires n >= 0 // first caller rule
  requires n <= 10 // bounded caller rule
  ensures result >= n // returned lower bound
  ensures result <= 10 // returned upper bound
  cost calls exact 1 // call budget
  cost bytes exact n // byte budget
  atomic;
`;
  const m = model(text),
    d = description(m);
  const next = {
    requires: ["n < 10"],
    ensures: ["result <= 10"],
    costs: [{ metric: "bytes", quality: "exact", expression: "n + 1" }],
    origins: { requires: [1], ensures: [1], costs: [1] },
  };
  const rewritten = edit(m, next);
  assert.ok(
    rewritten.text.includes("requires (n < 10) // bounded caller rule"),
  );
  assert.ok(
    rewritten.text.includes("ensures result <= 10 // returned upper bound"),
  );
  assert.ok(rewritten.text.includes("cost bytes exact n + 1 // byte budget"));
  assert.ok(
    rewritten.text.includes(
      "Removed requires rule 1; retained original note: // first caller rule",
    ),
  );
  assert.ok(
    rewritten.text.includes(
      "Removed Cost calls; retained original note: // call budget",
    ),
  );
  assert.deepEqual(
    model(rewritten.text).report.diagnostics.filter(
      (d) => d.severity === "error",
    ),
    [],
  );
  const noIdentity = edit(m, {
    requires: ["n <= 10"],
    ensures: d.definition.ensures,
    costs: [d.definition.costs[1]],
  });
  assert.ok(
    noIdentity.text.includes("requires n <= 10 // bounded caller rule"),
  );
  assert.ok(noIdentity.text.includes("cost bytes exact n // byte budget"));
  assert.throws(
    () => edit(m, { ...next, origins: { ...next.origins, requires: [19] } }),
    /clause identities/,
  );
  assert.throws(
    () =>
      edit(m, {
        ...next,
        requires: ["n>0", "n<10"],
        origins: { ...next.origins, requires: [1, 1] },
      }),
    /clause identities/,
  );
});
