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

const broken =
  "pub fn g()->u8{fn gap()->u8{1}gap::<>()}macro_rules! m{()=>{2u16}}";
function failedText(g) {
  g.unverified("m", "m", "macros");
  const calls = g.links.filter(
    (l) => l.kind === "macros" && l.targetName === "m",
  );
  assert.ok(
    calls.every((l) =>
      l.data.uncertainty.includes("failed-file-unseen-declarations"),
    ),
  );
  assert.ok(calls.every((l) => l.data.cause === undefined));
  assert.ok(g.files.some((f) => f.result.status === "failed"));
}
test("f1: failed macro_use module adds an unseen textual entry", async () => {
  // rustc accepts the empty-turbofish grammar gap (`gap::<>()`, still rejected
  // by the vendored grammar, W2-V): m! returns 2, broken::g returns 1.
  const g = await graph({
    "src/main.rs":
      "macro_rules! m{()=>{1u8}}#[macro_use]mod broken;pub fn run()->u16{let v=m!();v as u16}fn main(){run();broken::g();}",
    "src/broken.rs": broken,
  });
  failedText(g);
});
test("f2: nested file macro_use failure reaches parent and inline child scope", async () => {
  // rustc calls broken.rs's m (2), not the root m (1).
  const g = await graph({
    "src/main.rs":
      "macro_rules! m{()=>{1u8}}#[macro_use]mod a;mod inl{pub fn run()->u16{let v=m!();v as u16}}fn main(){inl::run();}",
    "src/a.rs": "#[macro_use]mod broken;",
    "src/a/broken.rs": broken,
  });
  failedText(g);
});
test("inline macro_use chain propagates a failed child", async () => {
  const g = await graph({
    "src/main.rs":
      "macro_rules! m{()=>{1u8}}#[macro_use]mod a{#[macro_use]mod broken;}fn main(){m!();}",
    "src/a/broken.rs": broken,
  });
  failedText(g);
});
test("failed macro_use entry starts after the mod item", async () => {
  // rustc: before() -> 1, after() -> 2.
  const g = await graph({
    "src/main.rs":
      "macro_rules! m{()=>{1u8}}fn before(){m!();}#[macro_use]mod broken;fn after(){m!();}",
    "src/broken.rs": broken,
  });
  const calls = g.links.filter(
    (l) => l.kind === "macros" && l.targetName === "m",
  );
  assert.equal(calls.length, 2);
  const first = g.decisions.find((d) => d.linkId === calls[0].id);
  assert.equal(g.symbols.find((s) => s.id === first.targetId).identity, "m");
  assert.equal(
    g.decisions.find((d) => d.linkId === calls[1].id)?.targetId,
    undefined,
  );
  assert.ok(
    calls[1].data.uncertainty.includes("failed-file-unseen-declarations"),
  );
});
test("failed module without outer macro_use has unknown inner status", async () => {
  // Round 17 supersedes the old negative control: the failed file may have
  // an unreadable leading inner macro_use, even when its declaration has none.
  const g = await graph({
    "src/main.rs": "macro_rules! m{()=>{1u8}}mod broken;fn main(){m!();}",
    "src/broken.rs": broken,
  });
  failedText(g);
});
test("later known macro shadows unseen macro_use entry", async () => {
  // rustc: m defined after the failed module wins (3).
  const g = await graph({
    "src/main.rs":
      "macro_rules! m{()=>{1u8}}#[macro_use]mod broken;macro_rules! m{()=>{3u32}}fn main(){m!();}",
    "src/broken.rs": broken,
  });
  const l = g.links.find((l) => l.kind === "macros" && l.targetName === "m");
  const d = g.decisions.find((d) => d.linkId === l.id);
  const target = g.symbols.find((s) => s.id === d.targetId);
  assert.match(
    g.files
      .find((f) => f.path === target.file)
      .text.slice(target.range.start, target.range.end),
    /3u32/,
  );
});
test("failed parent erases child ancestry: no invented inherited macro or cause", async () => {
  // rustc: parent m is inherited into child (2). Failed parent contributes no
  // mod child declaration, so this fallback cannot prove ancestry or its target.
  const g = await graph({
    "src/main.rs": "mod parent;fn main(){parent::child::run();}",
    "src/parent.rs":
      "pub fn g()->u8{fn gap()->u8{1}gap::<>()}macro_rules! m{()=>{2u16}}pub mod child;",
    "src/parent/child.rs": "pub fn run()->u16{m!()}",
  });
  g.unknown("m", "macros");
  const l = g.links.find((l) => l.kind === "macros" && l.targetName === "m");
  assert.equal(l.data.cause, undefined);
  assert.equal(l.data.targets, undefined);
  assert.notEqual(l.data.uncertainty, "invalid-code");
});
test("M1: later same-scope textual definition wins", async () => {
  // rustc: the second m returns 2u16.
  const g = await graph(
    lib(
      "macro_rules! m{()=>{1u8}}macro_rules! m{()=>{2u16}}pub fn run()->u16{let v=m!();v as u16}",
    ),
  );
  const l = g.links.find((l) => l.kind === "macros" && l.targetName === "m");
  const d = g.decisions.find((d) => d.linkId === l.id);
  assert.equal(g.symbols.find((s) => s.id === d.targetId).range.start, 25);
});
test("M7: macro_use not active before the mod item", async () => {
  // rustc: before() uses sub::m (2), not a::m (1).
  const g = await graph(
    lib(
      "pub fn before()->u16{let v=m!();v as u16}#[macro_use]mod a{macro_rules! m{()=>{1u8}}}mod sub{#[macro_export]macro_rules! m{()=>{2u16}}}",
    ),
  );
  g.one("m", "sub::m", "macros");
});
test("M6: conditional textual scope retains the path alternative", async () => {
  // rustc: no feature -> sub::m (2); x -> textual m (1).
  const g = await graph(
    lib(
      'mod sub{#[macro_export]macro_rules! m{()=>{2u16}}}#[cfg(feature="x")]macro_rules! m{()=>{1u8}}fn run(){m!();}',
    ),
  );
  g.unverified("m", "m", "macros");
  g.unverified("m", "sub::m", "macros");
});
