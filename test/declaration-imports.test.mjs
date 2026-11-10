import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
import { createDeclaration } from "../dist/studio/declaration-authoring.js";
import { typeAuthoring } from "../dist/studio/type-authoring.js";
const home = "/tmp/pym-import-tests/main.pym";
const library = "/tmp/pym-import-tests/types/order.pym";
const other = "/tmp/pym-import-tests/types/other.pym";
const original =
  "// Keep this design exactly.\nflow keep() -> Unit { return unit; }\n";
const check = (files) =>
  analyseFile(home, () => {}, {
    buffers: { [home]: original, ...files },
    additionalEntries: Object.keys(files).filter((f) => f !== home),
  });
function request(id = library + "#Order", name = "consume") {
  return {
    kind: "component",
    signature: {
      name,
      inputs: [
        { name: "order", type: { kind: "named", name: "Order", symbolId: id } },
      ],
      output: "Unit",
      effects: [],
    },
  };
}
test("new declaration imports a selected type and preserves the existing design and canonical IR", () => {
  const files = { [library]: "type Order = { id: Nat };" };
  const { ir } = check(files);
  const visibility = [...ir.visibleSymbols.get(home)];
  const result = createDeclaration(
    ir,
    home,
    request(),
    ir.snapshot.sources.find((s) => s.file === home).hash,
  );
  assert.match(result.text, /^import "\.\/types\/order.pym";/);
  assert.ok(result.text.includes(original));
  assert.match(result.text, /flow consume\(order: Order\)/);
  assert.deepEqual(
    check({ ...files, [home]: result.text }).report.diagnostics.map((d) => [
      d.code,
      d.severity,
    ]),
    [["U001", "warning"]],
  );
  assert.deepEqual([...ir.visibleSymbols.get(home)], visibility);
  assert.equal(ir.visibleSymbols.get(home).has("Order"), false);
  assert.match(result.notices.join("\n"), /whole-file imports/);
  const strict = typeAuthoring(ir, home);
  assert.throws(
    () =>
      strict.type({
        kind: "named",
        name: "Order",
        symbolId: library + "#Order",
      }),
    /not uniquely available/,
  );
});
test("same-named types require exact identity and select only that module", () => {
  const { ir } = check({
    [library]: "type Order = { id: Nat };",
    [other]: "type Order = { ready: Bool };",
  });
  const hash = ir.snapshot.sources.find((s) => s.file === home).hash;
  const result = createDeclaration(ir, home, request(other + "#Order"), hash);
  assert.match(result.text, /import "\.\/types\/other.pym"/);
  assert.doesNotMatch(result.text, /import "\.\/types\/order.pym"/);
  const byName = request();
  delete byName.signature.inputs[0].type.symbolId;
  assert.throws(
    () => createDeclaration(ir, home, byName, hash),
    /not uniquely available/,
  );
  assert.throws(
    () => createDeclaration(ir, home, request(other + "#NotOrder"), hash),
    /identity/,
  );
});
test("whole-file imports refuse namespace collisions and newly created import cycles", () => {
  for (const [text, pattern] of [
    [
      "type Order = { id: Nat }; flow keep() -> Unit { return unit; }",
      /keep.*ambiguous/,
    ],
    [
      "type Order = { id: Nat }; flow consume() -> Unit { return unit; }",
      /consume.*conflicts/,
    ],
    ['import "../main.pym"; type Order = { id: Nat };', /cycle/],
    ["type Order = { id: Missing };", /incomplete/],
  ]) {
    const { ir } = check({ [library]: text });
    assert.throws(
      () =>
        createDeclaration(
          ir,
          home,
          request(),
          ir.snapshot.sources.find((s) => s.file === home).hash,
        ),
      pattern,
    );
  }
});
test("reusing an already visible type adds no duplicate import", () => {
  const source = 'import "./types/order.pym";\n' + original;
  const { ir } = check({
    [home]: source,
    [library]: "type Order = { id: Nat };",
  });
  const result = createDeclaration(
    ir,
    home,
    request(),
    ir.snapshot.sources.find((s) => s.file === home).hash,
  );
  assert.equal(result.text.match(/import/g).length, 1);
  assert.ok(result.text.startsWith(source));
});

test("adding imports retains a source BOM at the start", () => {
  const source = "\uFEFF" + original;
  const { ir } = check({
    [home]: source,
    [library]: "type Order = { id: Nat };",
  });
  const result = createDeclaration(
    ir,
    home,
    request(),
    ir.snapshot.sources.find((s) => s.file === home).hash,
  );
  assert.ok(result.text.startsWith('\uFEFFimport "./types/order.pym";'));
  assert.ok(result.text.includes(original));
});
