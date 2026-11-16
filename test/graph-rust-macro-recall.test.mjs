// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileFacts, contentHash, validateResult } from "../dist/graph/index.js";
const rust = (
  await import(
    process.env.RUST_TEST_MODULE ?? "../dist/graph/languages/rust/index.js"
  )
).default;
async function graph(
  sources,
  manifests = { "Cargo.toml": '[package]\nname="app"\nedition="2024"\n' },
  replacements = {},
) {
  const files = [];
  for (const [path, text] of Object.entries(sources)) {
    const result = replacements[path] ?? (await rust.parse({ path, text }));
    validateResult(text, result);
    files.push({
      path,
      text,
      result,
      hash: contentHash(text),
      module: "rust",
      version: rust.version,
    });
  }
  const contextFiles = Object.entries(manifests).map(([path, text]) => ({
    path,
    text,
    hash: contentHash(text),
    status: "clean",
    diagnostics: [],
  }));
  for (const a of await rust.analyze({
    projectId: "review",
    files,
    contextFiles,
    changedFiles: files.map((f) => f.path),
    changedContextFiles: [],
  }))
    files.find((f) => f.path === a.path).result = a.result;
  const facts = files.map((f) => fileFacts("review", f));
  const symbols = facts.flatMap((f) => f.symbols);
  const links = facts.flatMap((f) => f.links);
  const decisions = await rust.resolve({
    projectId: "review",
    files,
    contextFiles,
    symbols,
    links,
  });
  const byId = new Map(symbols.map((s) => [s.id, s]));
  const byLink = new Map(decisions.map((d) => [d.linkId, d]));
  function targets(name, kind = "calls") {
    const ls = links.filter((l) => l.targetName === name && l.kind === kind);
    assert.ok(ls.length, `${kind}: ${name}`);
    return ls.map((l) => {
      const d = byLink.get(l.id);
      return d?.targetId
        ? [byId.get(d.targetId)]
        : d?.candidateIds
          ? d.candidateIds.map((id) => byId.get(id))
          : [];
    });
  }
  function one(name, identity, kind = "calls") {
    const ts = targets(name, kind);
    for (const t of ts) {
      assert.equal(t.length, 1, name);
      assert.equal(t[0].identity, identity, name);
    }
  }
  function unknown(name, kind = "calls") {
    for (const t of targets(name, kind)) assert.equal(t.length, 0, name);
  }
  function would(name, kind = "calls") {
    return links
      .filter((l) => l.targetName === name && l.kind === kind)
      .map((l) => (l.data?.targets ?? []).map((id) => byId.get(id)));
  }
  function unverified(name, identity, kind = "calls") {
    unknown(name, kind);
    for (const ts of would(name, kind))
      assert.ok(
        ts.some((s) => s.identity === identity),
        `${name} retains ${identity}`,
      );
  }
  return {
    targets,
    would,
    unverified,
    one,
    unknown,
    files,
    contextFiles,
    symbols,
    links,
    decisions,
  };
}

const cases = JSON.parse(
  await readFile(
    new URL("./fixtures/graph-rust/macro-recall.json", import.meta.url),
    "utf8",
  ),
);
for (const c of cases)
  test("macro recall: " + c.name, async () => {
    // evidence/w2-c2/compiler-controls.mjs checks the printed target for every case.
    const g = await graph(c.files);
    for (const expected of c.definite ?? []) {
      g.one(expected.name, expected.identity, expected.kind ?? "calls");
      for (const targets of g.targets(expected.name, expected.kind ?? "calls"))
        for (const target of targets) {
          if (expected.file) assert.equal(target.file, expected.file);
          if (expected.start !== undefined)
            assert.equal(target.range.start, expected.start);
        }
    }
    for (const name of c.unresolved ?? []) g.unknown(name);
    for (const expected of c.would ?? [])
      g.unverified(expected.name, expected.identity);
    if (c.candidateMacros)
      assert.equal(g.targets("m", "macros")[0].length, c.candidateMacros);
    for (const name of c.unresolvedMacros ?? []) g.unknown(name, "macros");
  });

test("failed macro_use before child keeps inherited macro uncertain", async () => {
  const g = await graph({
    "src/main.rs":
      "macro_rules! m {()=>{1u8}} #[macro_use] mod broken; mod child;",
    "src/broken.rs": "pub fn broken( {",
    "src/child.rs": "pub fn run(){m!();}",
  });
  g.unverified("m", "m", "macros");
});
test("conditional child text retains inherited alternative", async () => {
  const g = await graph({
    "src/main.rs": "macro_rules! m {()=>{2u16}} mod child;",
    "src/child.rs":
      '#[cfg(feature="x")] macro_rules! m {()=>{1u8}} pub fn run(){m!();}',
  });
  assert.equal(g.targets("m", "macros")[0].length, 2);
});

test("named uncaptured macro_use keeps a standard name opaque", async () => {
  const g = await graph({
    "src/main.rs":
      "#[macro_use(println)] extern crate pm; struct A; impl A {fn take(self)->u16{2}} fn run(a:A)->u16 {println!(a);a.take()}",
  });
  g.unknown("a.take");
});
test("unknown macros still invalidate receiver inference", async () => {
  const g = await graph({
    "src/main.rs":
      "struct A; impl A {fn take(self)->u16{2}} fn run(a:A)->u16 {unknown!(a);a.take()}",
  });
  g.unknown("a.take");
});

test("an unverified parent declaration cannot prove inherited text", async () => {
  const g = await graph({
    "src/main.rs":
      'macro_rules! m {()=>{2u16}} #[path="./child.rs"] mod child;',
    "src/child.rs": "pub fn run()->u16{m!()}",
  });
  g.unknown("m", "macros");
});
