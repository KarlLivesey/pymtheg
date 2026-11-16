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
  const resolved = await rust.resolve({
    projectId: "review",
    files,
    contextFiles,
    symbols,
    links,
  });
  const decisions = Array.isArray(resolved) ? resolved : resolved.resolutions;
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

for (const ed of ["2018", "2021", "2024"])
  for (const attr of [
    "",
    "#[cfg_attr(any(),macro_export)]",
    '#[cfg_attr(feature="x",macro_export)]',
    '#[cfg(feature="x")]#[macro_export]',
  ])
    test(`path macros use export/import routes ${ed} ${attr}`, async () => {
      // rustc: no feature => other (2u16); conditional exports with x => m (1u8).
      const conditional = attr.includes("feature=");
      const g = await graph(
        lib(
          `${attr}macro_rules! m{()=>{1u8}}macro_rules! other{()=>{2u16}}${conditional ? '#[cfg(not(feature="x"))]' : ""}pub(crate)use other as m;pub fn run(){let x=crate::m!();}`,
        ),
        { "Cargo.toml": `[package]\nname="app"\nedition="${ed}"\n` },
      );
      if (conditional) {
        const l = g.links.find(
          (l) => l.kind === "macros" && l.targetName === "crate::m",
        );
        const d = g.decisions.find((d) => d.linkId === l.id);
        const ids = d?.candidateIds ?? l.data?.targets ?? [];
        assert.deepEqual(
          ids.map((id) => g.symbols.find((s) => s.id === id).identity).sort(),
          ["m", "other"],
        );
        assert.equal(d?.targetId, undefined);
      } else g.one("crate::m", "other", "macros");
      if (attr.includes("cfg_attr(feature"))
        assert.equal(
          g.symbols.find((s) => s.identity === "m").data.visibility,
          "private",
        );
    });
test("exported macro in submodule lives at crate root only", async () => {
  // rustc: crate::m succeeds; crate::sub::m is E0433.
  const g = await graph(
    lib(
      `mod sub{#[macro_export]macro_rules! m{()=>{1u8}}}fn run(){crate::m!();crate::sub::m!();}`,
    ),
  );
  g.one("crate::m", "sub::m", "macros");
  g.unknown("crate::sub::m", "macros");
});
test("bare macro uses textual route before a path import", async () => {
  // rustc: m! => 1u8, crate::m! => 2u16.
  const g = await graph(
    lib(
      `macro_rules! m{()=>{1u8}}macro_rules! other{()=>{2u16}}pub(crate)use other as m;fn run(){m!();crate::m!();}`,
    ),
  );
  g.one("m", "m", "macros");
  g.one("crate::m", "other", "macros");
  g.one("other", "other", "imports");
});
test("bare textual macro_use module and file module", async () => {
  // rustc: macro_use carries the ending module textual scope outward.
  const g = await graph({
    "src/lib.rs": `#[macro_use]mod sub;fn run(){m!();}`,
    "src/sub.rs": "macro_rules! m{()=>{1u8}}",
  });
  g.one("m", "m", "macros");
});
test("unknown export guard is carried into root lookup", async () => {
  const g = await graph(
    lib(
      `mod inner{#[cfg_attr(feature="x",macro_export)]macro_rules! m{()=>{1u8}}}fn run(){crate::m!();}`,
    ),
  );
  g.unverified("crate::m", "inner::m", "macros");
  assert.equal(
    g.symbols.find((s) => s.identity === "inner::m").data.visibility,
    "private",
  );
});
test("2015 nonexported macro import is not a path binding", async () => {
  // rustc 2015 rejects use other as m; modern editions accept it.
  const g = await graph(
    lib(`macro_rules! other{()=>{2u16}}use other as m;fn run(){crate::m!();}`),
    { "Cargo.toml": '[package]\nname="app"\nedition="2015"\n' },
  );
  g.unknown("crate::m", "macros");
});

test("macro_use ending scope retains latest definition through nested files", async () => {
  const g = await graph({
    "src/lib.rs": "#[macro_use]mod outer;fn run(){m!();}",
    "src/outer.rs": "#[macro_use]mod inner;",
    "src/outer/inner.rs": "macro_rules! m{()=>{1u8}}macro_rules! m{()=>{2u16}}",
  });
  const l = g.links.find((l) => l.kind === "macros" && l.targetName === "m");
  const d = g.decisions.find((d) => d.linkId === l.id);
  assert.ok(d?.targetId);
  const target = g.symbols.find((s) => s.id === d.targetId);
  assert.equal(target.file, "src/outer/inner.rs");
  assert.equal(target.range.start, 25);
});
test("macro export inherits a file module declaration gate", async () => {
  const g = await graph({
    "src/lib.rs": '#[cfg(feature="x")]mod inner;fn run(){crate::m!();}',
    "src/inner.rs": "#[macro_export]macro_rules! m{()=>{1u8}}",
  });
  g.unverified("crate::m", "m", "macros");
});
