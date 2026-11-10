import test from "node:test";
import assert from "node:assert/strict";
import { typeChoices } from "../dist/studio/type-choices.js";
test("same-name choices preserve nominal identity and file labels", () => {
  const types = [
    { name: "Order", kind: "record", symbolId: "a.pym#Order", file: "a.pym" },
    { name: "Order", kind: "record", symbolId: "b.pym#Order", file: "b.pym" },
  ];
  const choices = typeChoices(types, "", {
    name: "Order",
    symbolId: "b.pym#Order",
  });
  assert.equal(choices.selectedValue, "b.pym#Order");
  assert.deepEqual(
    choices.items.map((t) => t.label),
    ["Order · a.pym", "Order · b.pym"],
  );
  assert.equal(typeChoices(types, "", { name: "Order" }).selectedValue, "");
  assert.equal(
    typeChoices(types, "a.pym", { name: "" }).items[0].symbolId,
    "a.pym#Order",
  );
});
test("unique choices retain their names as values and selected identities remain outside the search page", () => {
  const types = Array.from({ length: 1000 }, (_, i) => ({
    name: "T" + i,
    kind: "record",
    symbolId: "types.pym#T" + i,
    file: "types.pym",
  }));
  const choices = typeChoices(types, "T1", {
    name: "T999",
    symbolId: "types.pym#T999",
  });
  assert.equal(choices.selectedValue, "T999");
  assert.ok(choices.items.some((t) => t.symbolId === "types.pym#T999"));
  assert.ok(choices.items.length <= 26);
  assert.equal(
    typeChoices([...types, types[0]], "", { name: "" }).all.length,
    1000,
  );
});

test("absolute project folder names do not become type-search matches", () => {
  const values = [
    {
      name: "Customer",
      kind: "record",
      symbolId: "/tmp/orders-proj/types.pym#Customer",
      file: "/tmp/orders-proj/types.pym",
    },
  ];
  assert.equal(typeChoices(values, "orders-proj", { name: "" }).total, 0);
  assert.equal(typeChoices(values, "types.pym", { name: "" }).total, 1);
});
