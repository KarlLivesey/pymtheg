// R1-H: the checked-in licence inventory and notices match what the package
// ships, nothing shipped carries a licence outside the allow-list or lacks its
// licence text, and Pymtheg's own MIT licence is declared and stated.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  generate,
  classify,
  satisfiable,
  allowed,
  root,
  assess,
  blocking,
  uncoveredNotices,
  reviewEmbedded,
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
    assert.deepEqual(blocking(c), [], `${c.name}@${c.version}`);
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
test("the tarball carries the notices and the inventory states Pymtheg's own licence", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(pkg.files.includes("THIRD-PARTY-NOTICES"));
  assert.equal(pkg.license, "MIT");
  assert.match(readFileSync("LICENSE", "utf8"), /^MIT License/);
  const doc = readFileSync("docs/licences.md", "utf8");
  assert.match(doc, /\*\*Pymtheg is MIT licensed;\*\* see `LICENSE`\./);
  assert.match(
    doc,
    /All shipped third-party components are declared under MIT, Apache-2\.0, (BSD-3-Clause or ISC|ISC or BSD-3-Clause)\./,
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
  // The wrapper form that declares several names before its guard.
  assert.deepEqual(
    [
      ...explainUnmapped("var xi,Ua;function Ed(){if(Ua)return xi;Ua=1;")
        .origins,
    ],
    ["@rollup/plugin-commonjs"],
  );
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

test("a licence file outside the allow-list blocks even when the declared licence is allowed", () => {
  const gpl =
    "GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\nCopyright (C) 2007 Free Software Foundation, Inc.";
  // The sabotage the round 1 review ran: crelt's LICENSE replaced by GPL text, MIT declared.
  const sabotaged = assess({
    name: "crelt",
    version: "1.0.6",
    declared: "MIT",
    files: ["LICENSE"],
    texts: [gpl],
  });
  assert.deepEqual(blocking(sabotaged), [
    "licence file reads as GPL, outside the allow-list",
  ]);
  // A notice file quoting another licence is not the package's grant.
  const notice = assess({
    name: "crelt",
    version: "1.0.6",
    declared: "MIT",
    files: ["LICENSE", "ThirdPartyNoticeText.txt"],
    texts: [
      "Permission is hereby granted, free of charge, to any person obtaining a copy",
      gpl,
    ],
  });
  assert.deepEqual(blocking(notice), []);
  assert.ok(notice.embedded.includes("GPL"));
  // A reviewed explanation lets only the licence it names pass, and only for
  // the exact licence text it was written for.
  const mcp = readFileSync(
    "node_modules/@modelcontextprotocol/server/LICENSE",
    "utf8",
  );
  const server = (text) =>
    assess({
      name: "@modelcontextprotocol/server",
      version: "2.4.0",
      declared: "Apache-2.0",
      files: ["LICENSE"],
      texts: [text],
    });
  const explained = server(mcp);
  assert.ok(
    explained.problems.some((p) => /CC-BY-4.0, outside the allow-list/.test(p)),
  );
  assert.deepEqual(blocking(explained), []);
  // The round 2 review's sabotage: the MCP LICENSE replaced by GPL text.
  assert.ok(blocking(server(gpl)).length > 0);
  // GPL added to the reviewed text: a different text, and GPL is not allowed.
  const added = blocking(server(mcp + "\n" + gpl));
  assert.ok(added.some((p) => /different licence text/.test(p)));
  assert.ok(added.some((p) => /GPL/.test(p)));
});
test("notices inside bundled source files must be covered by the package licence or reviewed", () => {
  const licence = [
    "MIT License\n\nCopyright (c) Meta Platforms, Inc. and affiliates.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy",
  ];
  // React's @license headers name the holder in React's own LICENSE: covered.
  const react =
    "/**\n * @license React\n * react.production.js\n *\n * Copyright (c) Meta Platforms, Inc. and affiliates.\n *\n * This source code is licensed under the MIT license found in the\n * LICENSE file in the root directory of this source tree.\n */\nexport {};";
  assert.deepEqual(uncoveredNotices(react, licence), []);
  // "(c)" in an example is not a copyright line.
  assert.deepEqual(
    uncoveredNotices("/**\n * Examples\n * (c)\n * 'a'\n */", licence),
    [],
  );
  // Sabotage: a bundled module carrying someone else's notice fails.
  const foreign =
    "// Copyright (c) 2019 Someone Else\n// Permission is hereby granted, free of charge, to any person obtaining a copy\nexport const x = 1;";
  const [notice] = uncoveredNotices(foreign, licence);
  assert.ok(notice);
  const host = {
    name: "react",
    version: "19.2.0",
    location: "node_modules/react",
  };
  const { problem } = reviewEmbedded("react/cjs/extra.js", notice, host);
  assert.match(problem, /not covered by its licence file/);
  const sabotaged = assess({
    name: "react",
    version: "19.2.0",
    declared: "MIT",
    files: ["LICENSE"],
    texts: licence,
    preProblems: [problem],
  });
  assert.deepEqual(blocking(sabotaged), [problem]);
  // Documentation prose about deriving state is not a notice.
  assert.deepEqual(
    uncoveredNotices(
      "/** Use it when the new state isn't\n * derived from the old state. */",
      licence,
    ),
    [],
  );
  // A derivative-work notice is never covered by the host's licence alone.
  assert.equal(
    uncoveredNotices("// A derivative work based on: x.\nexport {};", licence)
      .length,
    1,
  );
});
test("the reviewed vfile notice yields both embedded origins and blocks if the header changes", () => {
  const source = readFileSync(
    "node_modules/vfile/lib/minpath.browser.js",
    "utf8",
  );
  const licence = [readFileSync("node_modules/vfile/license", "utf8")];
  const [notice] = uncoveredNotices(source, licence);
  const host = {
    name: "vfile",
    version: "6.0.3",
    location: "node_modules/vfile",
  };
  const { components } = reviewEmbedded(
    "vfile/lib/minpath.browser.js",
    notice,
    host,
  );
  assert.deepEqual(
    components.map((c) => [c.name, c.declared]),
    [
      ["path-browserify (embedded in vfile@6.0.3)", "MIT"],
      ["Node.js lib/path.js (embedded in vfile@6.0.3)", "MIT"],
    ],
  );
  assert.match(components[0].texts[0], /Copyright \(c\) 2013 James Halliday/);
  assert.match(
    components[1].texts[0],
    /Copyright Joyent, Inc\. and other Node contributors\./,
  );
  const changed = {
    ...notice,
    text: notice.text.replace("James Halliday", "Someone Else"),
  };
  assert.match(
    reviewEmbedded("vfile/lib/minpath.browser.js", changed, host).problem,
    /no longer matches its review/,
  );
});
test("provenance notes in bundled files are reviewed, and a changed note blocks", () => {
  const host = { name: "zod", version: "4.6.6", location: "node_modules/zod" };
  const zod = readFileSync("node_modules/zod/v4/core/regexes.js", "utf8");
  const licence = [readFileSync("node_modules/zod/LICENSE", "utf8")];
  const notices = uncoveredNotices(zod, licence);
  assert.equal(notices.length, 6);
  const reviewed = notices.map(
    (n) => reviewEmbedded("zod/v4/core/regexes.js", n, host).provenance,
  );
  assert.ok(reviewed.every(Boolean));
  assert.ok(
    reviewed.some(
      (p) =>
        /3143231/.test(p.match) && /Attribution-ShareAlike/.test(p.licence),
    ),
  );
  const changed = {
    ...notices[0],
    text: "Adapted from https://example.com/other",
  };
  assert.match(
    reviewEmbedded("zod/v4/core/regexes.js", changed, host).problem,
    /no longer matches its review/,
  );
});
test("the notice scan's wording rules: what counts as a provenance note", () => {
  const found = (comment) =>
    uncoveredNotices(comment + "\nexport {};", []).length;
  for (const comment of [
    "// Somewhat based on:\n// <https://github.com/x/y/blob/main/a.js>.",
    "// based on https://stackoverflow.com/questions/1/x",
    "// from https://example.com/post#regex",
    "/** Equivalent to X. Source: https://developer.mozilla.org/x */",
    "// https://stackoverflow.com/questions/2/y",
    "// https://blog.example.com/archives/p#r4 (regex sans spaces)",
    "// Port of `x.rs` from `y`.",
    "/*! @license MIT */",
    "// A derivative work based on: x",
  ])
    assert.equal(found(comment), 1, comment);
  for (const comment of [
    "/** Check if a pattern is in scope based on the current stack. */",
    "/** Reset when the new state isn't derived from the old state. */",
    "// The tree that this fragment is based on.",
    "// https://github.com/x/y/issues/414",
    "// See https://github.com/codemirror/dev/issues/414",
    "// Note: <https://github.com/github/cmark-gfm/issues/279>",
    "/** @license React\n * Copyright (c) Someone */",
  ])
    assert.equal(
      uncoveredNotices(comment + "\nexport {};", ["Copyright (c) Someone"])
        .length,
      0,
      comment,
    );
});
