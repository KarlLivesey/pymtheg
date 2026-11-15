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
import {
  bundleOrigins,
  explainUnmapped,
} from "../scripts/licences/bundle-origins.mjs";

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

test("every origin of code in the built bundle is in the inventory, judged from source maps", async () => {
  const { data } = await generated;
  const { origins, unmapped } = await bundleOrigins();
  const listed = new Set(
    data.components
      .filter((c) => /^(bundled|build-tool)/.test(c.shipped))
      .map((c) => c.name),
  );
  assert.deepEqual(
    data.components.filter((c) => c.unattributed).map((c) => c.name),
    [],
    "build-tool code with no known origin",
  );
  assert.deepEqual(
    [...origins.keys()].filter((o) => o.startsWith("other:")),
    [],
    "mapped code from a source that is neither ours nor an npm package",
  );
  const mappedPackages = [...origins.keys()]
    .filter((o) => o.startsWith("package:"))
    .map((o) => o.slice("package:".length));
  for (const name of mappedPackages)
    assert.ok(
      listed.has(name),
      `bundled code from ${name} is not in the inventory`,
    );
  for (const c of data.components.filter(
    (c) => c.shipped === "bundled in dist-web",
  ))
    assert.ok(
      mappedPackages.includes(c.name),
      `${c.name} is listed as bundled but no emitted code maps to it`,
    );
  assert.ok(
    unmapped.length > 0,
    "the build is expected to write some code of its own",
  );
  for (const piece of unmapped) {
    const { origins: found, unexplained } = explainUnmapped(piece.text);
    assert.equal(
      unexplained,
      null,
      `${piece.file}:${piece.line}:${piece.column}: emitted code with no source and no known origin`,
    );
    for (const origin of found)
      assert.ok(
        listed.has(origin),
        `${origin} writes code into the bundle but is not in the inventory`,
      );
  }
});
test("unmapped build-tool code is recognised by shape, and anything else is reported", () => {
  const helper =
    'function Xg(u){return u&&u.__esModule&&Object.prototype.hasOwnProperty.call(u,"default")?u.default:u}var ro={exports:{}},ri={};var $m;function Gg(){if($m)return ri;$m=1;';
  assert.deepEqual(explainUnmapped(helper), {
    origins: new Set(["@rollup/plugin-commonjs"]),
    unexplained: null,
  });
  const linked =
    'import{r as f,j as t}from"./react-C9.js";import{T as td}from"./editor-3I.js";';
  assert.deepEqual([...explainUnmapped(linked).origins], ["rollup"]);
  const polyfill =
    '(function(){const n=document.createElement("link").relList;if(n&&n.supports&&n.supports("modulepreload"))return;function i(o){if(o.ep)return;o.ep=!0;const r=s(o);fetch(o.href,r)}})();';
  assert.deepEqual([...explainUnmapped(polyfill).origins], ["vite"]);
  assert.match(
    explainUnmapped(
      "var __defProp=Object.defineProperty;var __publicField=(o,k,v)=>__defProp(o,k,v);",
    ).unexplained,
    /__defProp/,
  );
});
