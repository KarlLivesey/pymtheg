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
function noCause(g, name, kind = "calls") {
  const links = g.links.filter((l) => l.targetName === name && l.kind === kind);
  assert.ok(links.length, `${kind} ${name}`);
  for (const l of links) {
    assert.equal(l.data?.cause, undefined, name);
    assert.notEqual(l.data?.uncertainty, "invalid-code", name);
  }
}
for (const [name, external, declaration, call] of [
  [
    "Error",
    "std::error::Error",
    "#[derive(Debug)]pub struct Error(pub u8);",
    "let e=Error(3);e.0",
  ],
  [
    "Write",
    "std::fmt::Write",
    "#[allow(non_snake_case)]pub fn Write()->u8{3}",
    "Write()",
  ],
])
  test(`round 9 B1 unknown external namespace keeps glob ${name}`, async () => {
    // rustc prints 3 in both cases: the std trait has no value binding.
    const g = await graph(
      lib(
        `mod errors{${declaration}}mod user{use ${external};use crate::errors::*;pub fn run()->u8{${call}}}`,
      ),
    );
    g.unknown(name);
    g.unverified(name, `errors::${name}`);
    noCause(g, name);
    assert.match(
      g.links.find((l) => l.kind === "calls" && l.targetName === name).data
        .uncertainty,
      /namespace-binding-unverified/,
    );
  });
const kinds = [
  {
    name: "unit",
    decl: "pub struct X;",
    value: "let _=X;",
    valueKind: "values",
    both: true,
  },
  {
    name: "tuple",
    decl: "pub struct X(pub u8);",
    value: "let _=X(1);",
    valueKind: "calls",
    both: true,
  },
  { name: "braced", decl: "pub struct X{pub x:u8}", typeOnly: true },
  { name: "enum", decl: "pub enum X{V}", typeOnly: true },
  { name: "trait", decl: "pub trait X{}", typeOnly: true, typeExpr: "&dyn X" },
  { name: "alias", decl: "pub type X=u8;", typeOnly: true },
  {
    name: "module",
    decl: "pub mod X{pub struct Y;}",
    typeOnly: true,
    typeExpr: "X::Y",
    typeName: "X::Y",
    target: "X::Y",
  },
  {
    name: "function",
    decl: "#[allow(non_snake_case)]pub fn X()->u8{1}",
    valueOnly: true,
    value: "let _=X();",
    valueKind: "calls",
  },
  {
    name: "const",
    decl: "pub const X:u8=1;",
    valueOnly: true,
    value: "let _=X;",
    valueKind: "values",
  },
  {
    name: "static",
    decl: "pub static X:u8=1;",
    valueOnly: true,
    value: "let _=X;",
    valueKind: "values",
  },
];
for (const mode of ["local", "explicit"])
  for (const c of kinds)
    test(`round 9 B1 ${mode} ${c.name} binds only its Rust namespaces`, async () => {
      // Compiler controls pin every row: local/imported type and value items coexist
      // with a same-name glob item in the OTHER namespace; unit/tuple bind both.
      const own =
        mode === "local" ? c.decl : `mod chosen{${c.decl}}use chosen::X;`;
      const prefix = mode === "local" ? "" : "chosen::";
      const source = `mod glob{pub struct X{pub x:u8}#[allow(non_snake_case)]pub fn X()->u8{3}}use glob::*;${own}fn type_use(_: ${c.typeExpr ?? "X"}){}fn value_use(){${c.typeOnly ? "let _=X();" : c.value}}`;
      const g = await graph(lib(source));
      if (c.typeOnly || c.both) {
        g.one(c.typeName ?? "X", prefix + (c.target ?? "X"), "types");
      } else g.one("X", "glob::X", "types");
      if (c.typeOnly) g.one("X", "glob::X");
      else g.one("X", prefix + "X", c.valueKind);
    });
for (const mode of ["local", "explicit"])
  test(`round 9 B1 ${mode} macro binds only macro namespace`, async () => {
    // rustc: type uses glob::X; X() is glob::X (3); X!() is selected (1).
    const own =
      mode === "local"
        ? "macro_rules! X{()=>{1u8}}"
        : "#[macro_export]macro_rules! selected{()=>{1u8}}use crate::selected as X;";
    const g = await graph(
      lib(
        `${own}mod glob{pub struct X{pub x:u8}#[allow(non_snake_case)]pub fn X()->u8{3}}use glob::*;fn t(_:X){}fn r(){let _=X();}fn m(){let _=X!();}`,
      ),
    );
    g.one("X", "glob::X", "types");
    g.one("X", "glob::X");
    g.one("X", mode === "local" ? "X" : "selected", "macros");
  });
for (const decl of [
  "struct X{v:u8}",
  "fn X()->u8{1}",
  "const X:u8=1;",
  "static X:u8=1;",
  "trait X{}",
  "type X=u8;",
  "mod X{}",
])
  test(`round 9 B1 ${decl.split(" ")[0]} cannot bind macro namespace`, async () => {
    // rustc accepts the value/type item beside a glob macro; X! prints 3.
    const g = await graph(
      lib(
        `#[macro_export]macro_rules! selected{()=>{3u8}}mod glob{pub use crate::selected as X;}use glob::*;${decl}fn r(){let _=X!();}`,
      ),
    );
    g.one("X", "selected", "macros");
  });
test("round 9 B1 conditional type-only import cannot complete a value binding family", async () => {
  // rustc x on prints 1, x off prints 3; imported braced X does not mask fn X.
  const g = await graph(
    lib(
      "mod glob{pub fn X()->u8{3}}mod other{pub struct X{pub x:u8}}use glob::*;#[cfg(x)]fn X()->u8{1}#[cfg(not(x))]use other::X;fn r()->u8{X()}",
    ),
  );
  g.unknown("X");
  assert.deepEqual(
    g
      .would("X")[0]
      .map((s) => s.identity)
      .sort(),
    ["X", "glob::X"],
  );
});
const broken = "pub fn hidden()->u8{fn gap()->u8{1}gap::<>()}";
test("round 9 B2 failed glob never accuses prelude or unknown names", async () => {
  // rustc accepts the grammar-gap file and prints the usual std results. Globs
  // cannot prove whether any of these names would come from the failed file.
  const sources = {
    "src/lib.rs": `mod broken;use broken::*;
 fn a(){let _:Vec<u8>=Vec::new();}fn b(){drop(1u8);}fn c(){let _=Some(1u8);}
 fn d(){let _=String::from("x");}fn e(){println!("x");}fn f(){let _=format!("x");}
 fn g(){let _=vec![1u8];}fn h(){assert!(true);}fn only(){OnlyThere();}`,
    "src/broken.rs": broken + "pub fn OnlyThere(){}",
  };
  const g = await graph(sources);
  for (const [name, kind] of [
    ["Vec", "types"],
    ["Vec::new", "calls"],
    ["drop", "calls"],
    ["Some", "calls"],
    ["String::from", "calls"],
    ["println", "macros"],
    ["format", "macros"],
    ["vec", "macros"],
    ["assert", "macros"],
    ["OnlyThere", "calls"],
  ]) {
    g.unknown(name, kind);
    noCause(g, name, kind);
    for (const l of g.links.filter(
      (l) => l.kind === kind && l.targetName === name,
    ))
      assert.match(l.data.uncertainty, /failed-file-unseen-declarations/, name);
  }
  const fixed = await graph({
    ...sources,
    "src/broken.rs": sources["src/broken.rs"].replaceAll("gap::<>()", "gap()"),
  });
  for (const l of fixed.links) assert.equal(l.data?.cause, undefined);
  fixed.one("OnlyThere", "OnlyThere");
});
test("round 9 B2 direct paths and explicit named imports still prove failed traversal", async () => {
  const g = await graph({
    "src/lib.rs":
      "mod broken;use broken::Thing;fn r(){broken::f();let _:Option<crate::broken::Thing>=None;let _:Option<Thing>=None;}mod child{fn r(){super::broken::f();}}",
    "src/broken.rs": broken,
  });
  for (const [name, kind] of [
    ["broken::f", "calls"],
    ["super::broken::f", "calls"],
    ["crate::broken::Thing", "types"],
    ["broken::Thing", "imports"],
    ["Thing", "types"],
  ]) {
    g.unknown(name, kind);
    const ls = g.links.filter((l) => l.targetName === name && l.kind === kind);
    assert.ok(ls.length, name);
    for (const l of ls) {
      assert.equal(l.data.uncertainty, "invalid-code");
      assert.deepEqual(l.data.cause, { files: ["src/broken.rs"] });
      assert.equal(l.data.targets, undefined);
    }
  }
});
test("round 9 B2 a captured explicit reexport still proves the failed supplier", async () => {
  const g = await graph({
    "src/lib.rs":
      "mod broken;mod exports{pub use crate::broken::Thing;}use exports::*;fn r(){let _:Option<Thing>=None;}",
    "src/broken.rs": broken,
  });
  g.unknown("Thing", "types");
  const l = g.links.find((l) => l.targetName === "Thing" && l.kind === "types");
  assert.equal(l.data.uncertainty, "invalid-code");
  assert.deepEqual(l.data.cause, { files: ["src/broken.rs"] });
  assert.equal(l.data.targets, undefined);
});
test("round 9 small path uncertainty never describes a receiver", async () => {
  const g = await graph(lib("mod missing{}fn r(){missing::Unknown::make();}"));
  g.unknown("missing::Unknown::make");
  const reason = g.links.find((l) => l.targetName === "missing::Unknown::make")
    .data.uncertainty;
  assert.match(reason, /path-type-unverified/);
  assert.doesNotMatch(reason, /receiver-type-unverified/);
});
for (const scope of ["module", "block"])
  test(`round 9 B1 present ${scope} type excludes glob members even for unverified projections`, async () => {
    // rustc prints 1. Associated-const proof remains outside this fallback, but
    // uncertainty about the member never makes glob::A::NAME a possible target.
    const root = "mod glob{pub mod A{pub const NAME:u8=3;}}use glob::*;";
    const own = "struct A;impl A{const NAME:u8=1;}";
    const source =
      scope === "module"
        ? root + own + "fn r()->u8{A::NAME}"
        : root + "fn r()->u8{" + own + "A::NAME}";
    const g = await graph(lib(source));
    g.unknown("A::NAME", "values");
    assert.deepEqual(
      g.would("A::NAME", "values")[0].map((s) => s.identity),
      [scope === "module" ? "impl A::NAME" : "r::impl A::NAME"],
    );
  });
for (const mode of ["local", "explicit"])
  for (const [kind, decl, value] of [
    ["function", "pub fn S()->u8{1}", "S()"],
    ["const", "pub const S:u8=1;", "S"],
    ["static", "pub static S:u8=1;", "S"],
  ])
    test(`round 9 B1 struct pattern uses type namespace beside ${mode} ${kind}`, async () => {
      // rustc prints 3: the value S does not mask the braced-struct pattern's type S.
      const own = mode === "local" ? decl : `mod chosen{${decl}}use chosen::S;`;
      const g = await graph(
        lib(
          `mod glob{pub struct S{pub x:u8}}use glob::*;${own}fn r()->u8{let S{x}=glob::S{x:3};let _=${value};x}`,
        ),
      );
      g.one("S", "glob::S", "patterns");
      g.one(
        "S",
        mode === "local" ? "S" : "chosen::S",
        kind === "function" ? "calls" : "values",
      );
    });
for (const mode of ["local", "explicit"])
  test(`round 9 B1 tuple pattern uses value namespace beside ${mode} alias`, async () => {
    // rustc prints 3: a type-only alias S does not mask the tuple constructor S.
    const own =
      mode === "local"
        ? "type S=u8;"
        : "mod chosen{pub type S=u8;}use chosen::S;";
    const g = await graph(
      lib(
        `mod glob{pub struct S(pub u8);}use glob::*;${own}fn r()->u8{let S(x)=glob::S(3);let _:Option<S>=None;x}`,
      ),
    );
    g.one("S", "glob::S", "patterns");
    g.one("S", mode === "local" ? "S" : "chosen::S", "types");
  });
test("round 9 B1/B2 an unverified namespace cannot accuse a possible glob module route", async () => {
  // rustc prints x 3. std::String wins for String::from; the explicitly named
  // glob::String::from uses the grammar-gap file. The two paths need different outcomes.
  const g = await graph({
    "src/lib.rs":
      'mod glob;use std::string::String;use glob::*;fn r()->String{String::from("x")}fn project()->u8{glob::String::from("x")}',
    "src/glob.rs": "pub mod String;",
    "src/glob/String.rs": "pub fn from(_: &str)->u8{fn gap()->u8{3}gap::<>()}",
  });
  g.unknown("String::from");
  noCause(g, "String::from");
  assert.match(
    g.links.find((l) => l.targetName === "String::from").data.uncertainty,
    /failed-file-unseen-declarations/,
  );
  const direct = g.links.find((l) => l.targetName === "glob::String::from");
  assert.equal(direct.data.uncertainty, "invalid-code");
  assert.deepEqual(direct.data.cause, { files: ["src/glob/String.rs"] });
});
