// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
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
const lib = (text) => ({ "src/lib.rs": text });

const pkg = (name) =>
  `[package]\nname="${name}"\nedition="2024"\nversion="0.1.0"\n`;

for (const head of ["derive", "global_allocator"]) {
  for (const [label, attr] of [
    ["true", `cfg_attr(all(), macro_use(${head}))`],
    ["nested", `cfg_attr(all(), cfg_attr(all(), macro_use(${head})))`],
    ["unknown", `cfg_attr(feature = "x", macro_use(${head}))`],
    ["multi", "cfg_attr(all(), macro_use(derive, global_allocator))"],
  ])
    test(`effective macro_use ${head}: ${label}`, async () => {
      // rustc with the payload enabled: pm replaces the impl with nothing; Tr::f returns 2.
      const g = await graph(
        lib(
          `#[${attr}]extern crate pm;pub struct A;pub trait Tr{fn f(self)->u16;}impl Tr for A{fn f(self)->u16{2}}#[${head}${head === "derive" ? "(Clone)" : ""}]impl A{pub fn f(self)->u8{1}}pub fn run(a:A)->u16{a.f()}`,
        ),
      );
      g.unverified("a.f", "impl A::f");
      assert.equal(
        g.symbols.find((s) => s.identity === "impl A::f").data
          .underOpaqueAttribute,
        true,
      );
    });
}
test("false effective macro_use does not shadow derive", async () => {
  // rustc: any() is false, builtin derive remains; the inherent by-value f returns 1.
  const g = await graph(
    lib(
      `#[cfg_attr(any(),macro_use(derive))]extern crate pm;#[derive(Clone)]pub struct A;impl A{pub fn f(self)->u8{1}}pub fn run(a:A)->u8{a.f()}`,
    ),
  );
  g.one("a.f", "impl A::f");
  assert.equal(
    g.symbols.find((s) => s.identity === "A").data.underOpaqueAttribute,
    undefined,
  );
});
test("effective bare macro_use keeps test strict", async () => {
  // rustc: the imported test attribute can replace this impl, including under cfg(test).
  const g = await graph(
    lib(
      `#[cfg_attr(all(),macro_use)]extern crate pm;struct A;#[test]impl A{pub fn f(self)->u8{1}}#[cfg(test)]fn run(a:A){a.f();}`,
    ),
  );
  g.unverified("a.f", "impl A::f");
  assert.equal(
    g.symbols.find((s) => s.identity === "impl A::f").data.underOpaqueAttribute,
    true,
  );
});
test("effective named macro_use shadows attributes in a child module", async () => {
  const g = await graph(
    lib(
      `#[cfg_attr(all(),macro_use(derive))]extern crate pm;pub struct A;mod child{#[derive(Clone)]impl super::A{pub fn f(self)->u8{1}}pub fn run(a:super::A){a.f();}}`,
    ),
  );
  g.unverified("a.f", "child::impl super::A::f");
});
for (const [pred, visibility] of [
  ["all()", "pub"],
  ["any()", "private"],
  ['feature="x"', "private"],
])
  test(`effective macro_export ${pred}`, async () => {
    const g = await graph(
      lib(`#[cfg_attr(${pred},macro_export)]macro_rules! selected{()=>{}}`),
    );
    assert.equal(
      g.symbols.find((s) => s.identity === "selected").data.visibility,
      visibility,
    );
  });
for (const [pred, identity] of [
  ["all()", "selected::alternate"],
  ["any()", "selected::ordinary"],
])
  test(`effective path ${pred}`, async () => {
    const g = await graph({
      "src/lib.rs": `#[cfg_attr(${pred},path="alt.rs")]mod selected;fn run(){selected::picked();}`,
      "src/alt.rs": "pub fn picked()->u8{2}",
      "src/selected.rs": "pub fn picked()->u8{1}",
    });
    g.one("selected::picked", "picked");
    const call = g.links.find(
      (l) => l.kind === "calls" && l.targetName === "selected::picked",
    );
    const target = g.decisions.find((d) => d.linkId === call.id).targetId;
    assert.equal(
      g.symbols.find((s) => s.id === target).file,
      pred === "all()" ? "src/alt.rs" : "src/selected.rs",
    );
  });

test("bare macro_use extern crate alias is not an attribute namespace binding", async () => {
  // rustc: the crate alias lives in the type namespace; E4 ignores unknown bare exports.
  const g = await graph(
    lib(
      `#[macro_use]extern crate pm as derive;#[derive(Clone)]pub struct A;impl A{pub fn f(self)->u8{1}}fn run(a:A){a.f();}`,
    ),
  );
  g.one("a.f", "impl A::f");
  assert.equal(
    g.symbols.find((s) => s.identity === "A").data.underOpaqueAttribute,
    undefined,
  );
});
test("effective named macro_use(test) is a visible binding", async () => {
  const g = await graph(
    lib(
      `#[cfg_attr(all(),macro_use(test))]extern crate pm;struct A;#[test]impl A{pub fn f(self)->u8{1}}#[cfg(test)]fn run(a:A){a.f();}`,
    ),
  );
  g.unverified("a.f", "impl A::f");
  assert.equal(
    g.symbols.find((s) => s.identity === "impl A::f").data.underOpaqueAttribute,
    true,
  );
});

for (const [pred, expected] of [
  ["all()", "macro"],
  ["any()", undefined],
])
  test(`effective proc_macro attribute ${pred}`, async () => {
    const g = await graph(
      lib(
        `#[cfg_attr(${pred},proc_macro_derive(Made))]pub fn expand(x:proc_macro::TokenStream)->proc_macro::TokenStream{x}`,
      ),
    );
    const d = g.symbols.find((s) => s.identity === "expand").data;
    assert.equal(d.semanticKind, expected);
    if (expected) assert.equal(d.exportedMacroName, "Made");
  });
