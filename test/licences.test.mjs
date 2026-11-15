// R1-H: the checked-in licence inventory and notices match what the package
// ships, and nothing shipped carries a licence outside the allow-list or lacks
// its licence text. Pymtheg's own licence is the owner's choice: no `license`
// field, LICENSE file or change to `private` is required here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  generate,
  classify,
  satisfiable,
  allowed,
  root,
} from "../scripts/licences/inventory.mjs";

const generated = generate();

test("docs/licences.md and THIRD-PARTY-NOTICES are up to date with the lockfile and bundle", async () => {
  const { markdown, notices } = await generated;
  for (const text of [markdown, notices])
    assert.ok(
      !text.includes(root),
      "generated text must not contain local paths",
    );
  assert.equal(
    readFileSync("docs/licences.md", "utf8"),
    markdown,
    "docs/licences.md is stale: run node scripts/licences/inventory.mjs --write",
  );
  assert.equal(
    readFileSync("THIRD-PARTY-NOTICES", "utf8"),
    notices,
    "THIRD-PARTY-NOTICES is stale: run node scripts/licences/inventory.mjs --write",
  );
});
test("every shipped component has an allowed licence and its licence text", async () => {
  const { data } = await generated;
  assert.ok(data.components.length > 0);
  const kinds = new Set(data.components.map((c) => c.shipped.split(" (")[0]));
  for (const kind of ["dependency", "bundled in dist-web", "vendored"])
    assert.ok(
      [...kinds].some((k) => k.startsWith(kind)),
      kind,
    );
  for (const c of data.components) {
    assert.ok(
      c.declared && satisfiable(c.declared),
      `${c.name}@${c.version}: licence ${c.declared ?? "not declared"} is outside the allow-list ${[...allowed].join(", ")}`,
    );
    assert.ok(
      !c.problems.includes("no licence text in the package"),
      `${c.name}@${c.version} ships no licence text`,
    );
  }
  assert.deepEqual(
    data.go.external,
    [],
    "golinks.go must use the Go standard library only",
  );
});
test("the tarball carries the notices and the inventory does not presume Pymtheg's own licence", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(pkg.files.includes("THIRD-PARTY-NOTICES"));
  assert.match(
    readFileSync("docs/licences.md", "utf8"),
    /Pymtheg's own licence is not yet chosen/,
  );
});
test("the allow-list check reads SPDX expressions and licence texts", () => {
  assert.equal(satisfiable("MIT"), true);
  assert.equal(satisfiable("(MIT OR GPL-3.0-only)"), true);
  assert.equal(satisfiable("MIT AND GPL-3.0-only"), false);
  assert.equal(satisfiable("MPL-2.0"), false);
  assert.equal(satisfiable("Apache-2.0 WITH LLVM-exception"), true);
  assert.equal(satisfiable(""), false);
  assert.deepEqual(
    classify(
      "Permission is hereby granted, free of charge, to any person obtaining a copy",
    ),
    ["MIT"],
  );
  assert.deepEqual(classify("GNU GENERAL PUBLIC LICENSE Version 3"), ["GPL"]);
  assert.deepEqual(
    classify(
      "Redistribution and use in source and binary forms ... The names of any contributors may not be used to endorse",
    ),
    ["BSD-3-Clause"],
  );
});
