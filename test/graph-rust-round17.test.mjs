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

for (const header of [
  "#![macro_use]",
  "#![cfg_attr(all(),macro_use)]",
  '#![cfg_attr(feature="x",macro_use)]',
])
  test(`clean child inner macro_use: ${header}`, async () => {
    // rustc: enabled macro_use => child m returns 2; unknown cfg keeps both possibilities.
    const g = await graph({
      "src/lib.rs":
        "macro_rules! m{()=>{1u8}}mod okm;pub fn run()->u16{let v=m!();v as u16}",
      "src/okm.rs": `${header}macro_rules! m{()=>{2u16}}`,
    });
    if (header.includes("feature=")) {
      // Native default/x runs select root/child respectively; both are kept.
      const l = g.links.find(
        (l) => l.kind === "macros" && l.targetName === "m",
      );
      const d = g.decisions.find((d) => d.linkId === l.id);
      assert.equal(d?.targetId, undefined);
      const ids = d?.candidateIds ?? l.data.targets ?? [];
      assert.deepEqual(
        ids.map((id) => g.symbols.find((s) => s.id === id).file).sort(),
        ["src/lib.rs", "src/okm.rs"],
      );
    } else {
      const l = g.links.find(
        (l) => l.kind === "macros" && l.targetName === "m",
      );
      const d = g.decisions.find((d) => d.linkId === l.id);
      assert.equal(
        g.symbols.find((s) => s.id === d.targetId).file,
        "src/okm.rs",
      );
    }
  });
test("false child inner macro_use leaves earlier textual macro definite", async () => {
  // rustc: any() is false; root m returns 1.
  const g = await graph({
    "src/lib.rs": "macro_rules! m{()=>{1u8}}mod okm;fn run(){m!();}",
    "src/okm.rs": "#![cfg_attr(any(),macro_use)]macro_rules! m{()=>{2u16}}",
  });
  const l = g.links.find((l) => l.kind === "macros" && l.targetName === "m");
  const d = g.decisions.find((d) => d.linkId === l.id);
  assert.equal(g.symbols.find((s) => s.id === d.targetId).file, "src/lib.rs");
});
const rawBody =
  "pub fn g()->u8{fn gap()->u8{1}gap::<>()}macro_rules! m{()=>{2u16}}";
for (const header of ["", "#![macro_use]", "#![cfg_attr(all(),macro_use)]"])
  test(`failed child unknown inner attributes: ${header}`, async () => {
    const g = await graph({
      "src/lib.rs": "macro_rules! m{()=>{1u8}}mod broken;fn run(){m!();}",
      "src/broken.rs": header + rawBody,
    });
    g.unverified("m", "m", "macros");
    const l = g.links.find((l) => l.kind === "macros" && l.targetName === "m");
    assert.ok(l.data.uncertainty.includes("failed-file-unseen-declarations"));
    assert.equal(l.data.cause, undefined);
  });
test("failed module after call cannot affect textual binding", async () => {
  // rustc: before uses root m (1) even with an inner macro_use in broken.rs.
  const g = await graph({
    "src/lib.rs": "macro_rules! m{()=>{1u8}}fn before(){m!();}mod broken;",
    "src/broken.rs": "#![macro_use]" + rawBody,
  });
  g.one("m", "m", "macros");
});
test("cfg(any()) failed macro_use module is provably absent", async () => {
  // rustc: the mod item is absent, root m returns 1.
  const g = await graph({
    "src/lib.rs":
      "macro_rules! m{()=>{1u8}}#[cfg(any())]#[macro_use]mod broken;fn run(){m!();}",
    "src/broken.rs": rawBody,
  });
  g.one("m", "m", "macros");
});
test("inner cfg gates child path references and composes with outer cfg", async () => {
  const g = await graph({
    "src/lib.rs": '#[cfg(feature="outer")]mod child;fn run(){child::value();}',
    "src/child.rs": '#![cfg(feature="inner")]pub fn value()->u8{1}',
  });
  g.unverified("child::value", "value");
  const s = g.symbols.find((s) => s.identity === "child");
  assert.ok(s.data.conditions.includes('feature="outer"'));
  assert.ok(s.data.conditions.includes('feature="inner"'));
});
for (const path of ["alternate.rs", "custom/alternate.rs"])
  test(`inner path rebases descendants, not own file: ${path}`, async () => {
    // rustc: child.rs remains the loaded body; its nested module uses dirname(path).
    const target = path.includes("/")
      ? "src/custom/nested.rs"
      : "src/nested.rs";
    const g = await graph({
      "src/lib.rs":
        "mod child;fn run(){child::value();child::nested::picked();}",
      "src/child.rs": `#![path="${path}"]pub mod nested;pub fn value()->u8{1}`,
      "src/alternate.rs": "pub fn value()->u8{9}",
      "src/child/nested.rs": "pub fn picked()->u8{1}",
      [target]: "pub fn picked()->u8{2}",
    });
    g.unverified("child::value", "value");
    g.unverified("child::nested::picked", "picked");
    const l = g.links.find(
      (l) => l.kind === "calls" && l.targetName === "child::nested::picked",
    );
    assert.ok(
      l.data.targets.some(
        (id) => g.symbols.find((s) => s.id === id).file === target,
      ),
    );
  });
test("inline inner path uses a directory prefix", async () => {
  const g = await graph({
    "src/lib.rs":
      'mod child{#![path="custom"]pub mod nested;}fn run(){child::nested::picked();}',
    "src/custom/nested.rs": "pub fn picked()->u8{2}",
    "src/child/nested.rs": "pub fn picked()->u8{1}",
  });
  g.unverified("child::nested::picked", "picked");
  const l = g.links.find(
    (l) => l.kind === "calls" && l.targetName === "child::nested::picked",
  );
  assert.ok(
    l.data.targets.some(
      (id) =>
        g.symbols.find((s) => s.id === id).file === "src/custom/nested.rs",
    ),
  );
});
test("inner opaque attribute marks module and contents unverified", async () => {
  // Custom inner proc attributes are unstable on stable Rust; fallback remains opaque.
  const g = await graph({
    "src/lib.rs":
      "mod child;use crate::child as alias;fn run(){child::value();}",
    "src/child.rs": "#![pm::replace]pub fn value()->u8{1}",
  });
  g.unverified("child::value", "value");
  g.unverified("crate::child", "child", "imports");
  const s = g.symbols.find((s) => s.identity === "child");
  assert.equal(s.data.underOpaqueAttribute, true);
  assert.ok(s.data.opaqueAttributes.includes("pm::replace"));
});
for (const spelling of ["dep::f", "::dep::f"])
  test(`inner no_implicit_prelude dependency route ${spelling}`, async () => {
    const g = await graph(
      {
        "src/lib.rs": "mod child;",
        "src/child.rs": `#![no_implicit_prelude]fn local()->u8{1}fn run(){local();${spelling}();}`,
        "dep/src/lib.rs": "pub fn f()->u8{2}",
      },
      {
        "Cargo.toml":
          '[package]\nname="app"\nedition="2024"\n[dependencies]\ndep={path="dep"}\n',
        "dep/Cargo.toml": '[package]\nname="dep"\nedition="2024"\n',
      },
    );
    g.one("local", "local");
    if (spelling.startsWith("::")) g.one(spelling, "f");
    else g.unverified(spelling, "f");
  });

test("failed child's unknown inner cfg contributes no targets", async () => {
  const g = await graph({
    "src/lib.rs": "macro_rules! m{()=>{1u8}}mod broken;fn run(){m!();}",
    "src/broken.rs": "#![cfg(any())]#![macro_use]" + rawBody,
  });
  g.unverified("m", "m", "macros");
  assert.ok(!g.symbols.some((s) => s.file === "src/broken.rs"));
});
test("repairing child file reads its inner macro_use and clears failure uncertainty", async () => {
  const sources = {
    "src/lib.rs": "macro_rules! m{()=>{1u8}}mod broken;fn run(){m!();}",
    "src/broken.rs": "#![macro_use]" + rawBody,
  };
  const bad = await graph(sources);
  bad.unverified("m", "m", "macros");
  const good = await graph({
    ...sources,
    "src/broken.rs": sources["src/broken.rs"].replaceAll("gap::<>()", "gap()"),
  });
  const l = good.links.find((l) => l.kind === "macros" && l.targetName === "m");
  const d = good.decisions.find((d) => d.linkId === l.id);
  assert.equal(
    good.symbols.find((s) => s.id === d.targetId).file,
    "src/broken.rs",
  );
  assert.equal(l.data.uncertainty, undefined);
  assert.equal(l.data.cause, undefined);
});
test("false inner opaque payload does not taint module presence", async () => {
  const g = await graph({
    "src/lib.rs": "mod child;fn run(){child::value();}",
    "src/child.rs": "#![cfg_attr(any(),pm::replace)]pub fn value()->u8{1}",
  });
  g.one("child::value", "value");
  assert.equal(
    g.symbols.find((s) => s.identity === "child").data.underOpaqueAttribute,
    undefined,
  );
});

test("unknown module-layout applicability cannot close a textual family", async () => {
  // rustc: both default and x print 1; each selected file is cfg-disabled.
  const g = await graph({
    "src/lib.rs":
      'macro_rules! m{()=>{1u8}}#[cfg_attr(feature="x",path="a.rs")]#[cfg_attr(not(feature="x"),path="b.rs")]mod child;fn run(){m!();}',
    "src/a.rs":
      '#![cfg(not(feature="x"))]#![macro_use]macro_rules! m{()=>{2u16}}',
    "src/b.rs": '#![cfg(feature="x")]',
  });
  g.unverified("m", "m", "macros");
});
