// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import {
  indexArchitecture,
  architectureDetail,
} from "../dist/architecture/model.js";
const catalogue = {
  path: "catalogue.json",
  text: JSON.stringify({
    types: { Row: { fields: { id: "String" } } },
    functions: [
      {
        id: "list",
        name: "list",
        owner: "storage",
        returns: "Page<Row>",
        args: { start: "Opt<Row>" },
      },
    ],
  }),
};
test("explicit documented generic declarations provide source-linked references without inventing declarations from uses", () => {
  const definitions = {
    path: "README.md",
    text: "Generics are closed: `Opt<T>` has None/Some(T); `Page<T>` contains items.\n",
  };
  const index = indexArchitecture([catalogue, definitions]);
  assert.ok(
    index.edges
      .filter((e) => ["Opt", "Page"].includes(e.targetName))
      .every((e) => !e.unresolved),
  );
  const generic = index.entities.find((e) => e.key === "Page");
  assert.equal(generic.status, "declared-unverified");
  assert.match(
    architectureDetail(definitions, generic.pointer),
    /Generics are closed/,
  );
  const missing = indexArchitecture([
    catalogue,
    {
      path: "usage.md",
      text: "For example use `Page<Row>` and `Opt<Row>` here.",
    },
  ]);
  assert.ok(missing.edges.some((e) => e.targetName === "Page" && e.unresolved));
});
test("generic examples inside fenced code never become declarations", () => {
  const index = indexArchitecture([
    catalogue,
    {
      path: "example.md",
      text: "```\nGenerics are closed: `Opt<T>` and `Page<T>`.\n```",
    },
  ]);
  assert.ok(index.edges.some((e) => e.targetName === "Page" && e.unresolved));
});
