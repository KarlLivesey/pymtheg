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
function picked(g, name, kind, symbolKind, identity) {
  const ts = g.targets(name, kind);
  for (const xs of ts) {
    assert.equal(xs.length, 1, name);
    assert.equal(xs[0].kind, symbolKind, name);
    assert.equal(xs[0].identity, identity, name);
  }
}
for (const glob of [false, true])
  test(`round 10 B1 struct literal in match guard uses type namespace (${glob ? "glob" : "local"})`, async () => {
    // rustc exits 1: the guard constructs the braced S, not the tuple constructor.
    const prefix = glob
      ? "mod glob{pub struct S(pub u16);}use glob::*;pub struct S{pub x:u8}"
      : "pub struct S(pub u16);";
    const local = glob ? "" : "struct S{x:u8}";
    const g = await graph(
      lib(
        `${prefix}fn run()->u8{${local}let o=Some(1u8);match o{Some(v) if (S{x:v}).x==1=>1,_=>2}}`,
      ),
    );
    picked(g, "S", "types", "struct", glob ? "S" : "run::S");
    assert.equal(
      g.links.some((l) => l.kind === "patterns" && l.targetName === "S"),
      false,
    );
  });
test("round 10 B1 cast in match guard is a type, not a const pattern", async () => {
  // rustc exits 1: Alias is u16, so 300 stays 300, not a u8 truncation or const.
  const g = await graph(
    lib(
      "#[allow(non_upper_case_globals)]pub const Alias:u8=9;pub type Alias=u16;fn run()->u8{let o=Some(300u16);match o{Some(v) if (v as Alias)==300=>1,_=>2}}fn value()->u8{Alias}",
    ),
  );
  picked(g, "Alias", "types", "type", "Alias");
  picked(g, "Alias", "values", "const", "Alias");
});
const typeSites = [
  ["parameter", "fn run(_:X){}"],
  ["return", "fn run()->X{3}"],
  ["let annotation", "fn run(){let _:X=3;}"],
  ["cast", "fn run(){let _=3u8 as X;}"],
  ["alias rhs", "type Y=X;"],
  ["const annotation", "const Y:X=3;"],
  ["static annotation", "static Y:X=3;"],
  ["struct field", "struct Y{v:X}"],
  ["tuple field", "struct Y(X);"],
  ["enum field", "enum Y{V(X),W{v:X}}"],
  ["reference", "fn run(_: &X){}"],
  ["slice", "fn run(_: &[X]){}"],
  ["array", "fn run(_: [X;1]){}"],
  ["tuple", "fn run(_: (X,)){}"],
  ["function type", "type Y=fn(X)->X;"],
  ["generic argument", "struct Y<T>(T);fn run(_:Y<X>){}"],
  ["turbofish argument", "fn take<T>(){}fn run(){take::<X>();}"],
];
for (const [label, body] of typeSites)
  test(`round 10 B1 syntax namespace: ${label}`, async () => {
    // rustc accepts every case: X in the type position is u16; value X is u8 (9).
    const g = await graph(
      lib(
        `#![allow(non_upper_case_globals)]type X=u16;const X:u8=9;${body}fn value()->u8{X}`,
      ),
    );
    picked(g, "X", "types", "type", "X");
    picked(g, "X", "values", "const", "X");
  });
test("round 10 B1 scoped type and value paths keep separate namespaces", async () => {
  // rustc prints 9; m::X in the annotation is u16 and in the body is const u8.
  const g = await graph(
    lib(
      "mod m{pub type X=u16;#[allow(non_upper_case_globals)]pub const X:u8=9;}fn run(_:m::X)->u8{m::X}",
    ),
  );
  picked(g, "m::X", "types", "type", "m::X");
  picked(g, "m::X", "values", "const", "m::X");
});
test("round 10 B1 impl headers and trait bounds use types beside value functions", async () => {
  // rustc accepts: impl headers/bounds use the struct/trait; calls return 9/8.
  const g = await graph(
    lib(
      "struct X{}#[allow(non_snake_case)]fn X()->u8{9}trait Tr{}#[allow(non_snake_case)]fn Tr()->u8{8}impl X{}impl Tr for X{}fn bound<T:Tr>(){}fn run(){let _=X();let _=Tr();}",
    ),
  );
  picked(g, "X", "types", "struct", "X");
  picked(g, "Tr", "types", "trait", "Tr");
  picked(g, "Tr", "implements", "trait", "Tr");
  picked(g, "X", "calls", "function", "X");
  picked(g, "Tr", "calls", "function", "Tr");
});
test("round 10 B1 struct literal and pattern heads use type beside function", async () => {
  // rustc prints 3: both S {..} heads use struct S; S() uses the function (9).
  const g = await graph(
    lib(
      "struct S{x:u8}#[allow(non_snake_case)]fn S()->u8{9}fn run()->u8{let S{x}=S{x:3};let _=S();x}",
    ),
  );
  picked(g, "S", "types", "struct", "S");
  picked(g, "S", "patterns", "struct", "S");
  picked(g, "S", "calls", "function", "S");
});
test("round 10 B1 generic literal head and its type arguments have distinct positions", async () => {
  // rustc prints 3: S::<X>{..} is a struct literal; X is the type alias u16.
  const g = await graph(
    lib(
      "struct S<T>{x:T}#[allow(non_snake_case)]fn S()->u8{9}type X=u16;#[allow(non_upper_case_globals)]const X:u8=8;fn run()->u16{let s=S::<X>{x:3};let _=S();s.x}",
    ),
  );
  picked(g, "S", "types", "struct", "S");
  picked(g, "X", "types", "type", "X");
  picked(g, "S", "calls", "function", "S");
});
test("round 10 B1 tuple constructor and pattern use value beside local alias", async () => {
  // rustc prints 3: S(..) is glob's tuple constructor; annotation S is u16.
  const g = await graph(
    lib(
      "mod g{pub struct S(pub u8);}use g::*;type S=u16;fn run()->u8{let S(x)=S(3);let _:S=0;x}",
    ),
  );
  picked(g, "S", "patterns", "struct", "g::S");
  picked(g, "S", "calls", "struct", "g::S");
  picked(g, "S", "types", "type", "S");
});
test("round 10 B1 unit expression and scoped unit pattern use value namespace", async () => {
  // rustc prints 3: value S and pattern g::S use the unit struct, not type alias S.
  const g = await graph(
    lib(
      "mod g{pub struct S;}use g::*;type S=u16;fn run()->u8{let _:S=0;let s=S;match s{g::S=>3}}",
    ),
  );
  picked(g, "S", "types", "type", "S");
  picked(g, "S", "values", "struct", "g::S");
  picked(g, "g::S", "patterns", "struct", "g::S");
});
test("round 10 B1 unit variant value and pattern beside a type alias", async () => {
  // rustc prints 3: X expression and E::X pattern are the enum's unit variant.
  const g = await graph(
    lib(
      "enum E{X}use E::*;type X=u16;fn run()->u8{let _:X=0;let x=X;match x{E::X=>3}}",
    ),
  );
  picked(g, "X", "types", "type", "X");
  picked(g, "X", "values", "variant", "E::X");
  picked(g, "E::X", "patterns", "variant", "E::X");
});
test("round 10 B1 macro invocation has its own namespace", async () => {
  // rustc prints 3 9: macro X!, type X and const X are independent bindings.
  const g = await graph(
    lib(
      "macro_rules! X{()=>{3u8}}type X=u16;#[allow(non_upper_case_globals)]const X:u8=9;fn run(){let _:X=0;let _=X;let _=X!();}",
    ),
  );
  picked(g, "X", "types", "type", "X");
  picked(g, "X", "values", "const", "X");
  picked(g, "X", "macros", "macro", "X");
});
const broken =
  'pub fn drop(_:Vec<u8>)->u8{fn gap()->u8{1}gap::<>()}pub fn format(_:std::fmt::Arguments<\'_>)->String{fn gap()->u8{1}gap::<>();String::from("outer")}';
for (const [label, source, name] of [
  [
    "block std drop",
    "mod broken;mod user{use crate::broken::drop;pub fn run()->u8{use std::mem::drop;let v=vec![1u8];let unit:()=drop(v);let _=unit;7}}",
    "drop",
  ],
  [
    "block std module alias",
    'mod broken;fn run()->String{use std::fmt as broken;let s:String=broken::format(format_args!("{}",5));s}',
    "broken::format",
  ],
  [
    "block external glob",
    "mod broken;mod user{use crate::broken::drop;pub fn run()->u8{use std::mem::*;let unit:()=drop(vec![1u8]);let _=unit;7}}",
    "drop",
  ],
  [
    "opaque block item macro",
    "mod broken;use broken::drop;macro_rules! local{()=>{fn drop(_:Vec<u8>)->u8{11}}}fn run()->u8{local!();drop(vec![1u8])}",
    "drop",
  ],
])
  test(`round 10 B2 possible inner shadow defeats outer cause: ${label}`, async () => {
    // rustc: drop variants print 7, alias prints 5, local macro prints 11. Grammar-gap file is valid Rust.
    const g = await graph({ "src/lib.rs": source, "src/broken.rs": broken });
    g.unknown(name);
    noCause(g, name);
    const l = g.links.find((l) => l.kind === "calls" && l.targetName === name);
    assert.match(l.data.uncertainty, /failed-file-unseen-declarations/);
    const fixed = await graph({
      "src/lib.rs": source,
      "src/broken.rs": broken.replaceAll("gap::<>()", "gap()"),
    });
    noCause(fixed, name);
  });
for (const [label, source, name] of [
  [
    "type-only drop",
    "mod broken;mod known{pub trait drop{}}mod user{use crate::broken::drop;fn run()->u8{use crate::known::drop;drop(vec![1u8])}}",
    "drop",
  ],
  [
    "value-only module alias",
    'mod broken;mod known{pub fn broken(){}}fn run()->String{use known::broken;broken::format(format_args!("{}",5))}',
    "broken::format",
  ],
])
  test(`round 10 B2 proven other namespace keeps outer cause: ${label}`, async () => {
    // rustc: type-only drop does not mask broken::drop (1); value-only broken does not mask module broken ("outer").
    const g = await graph({ "src/lib.rs": source, "src/broken.rs": broken });
    g.unknown(name);
    const l = g.links.find((l) => l.kind === "calls" && l.targetName === name);
    assert.equal(l.data.uncertainty, "invalid-code");
    assert.deepEqual(l.data.cause, { files: ["src/broken.rs"] });
    assert.equal(l.data.targets, undefined);
  });
test("round 10 B2 possible inner project import keeps its target beside outer failure", async () => {
  // rustc x on prints 13 (inner); x off prints 1 (outer). Neither config is captured as enabled.
  const g = await graph({
    "src/lib.rs":
      "mod broken;mod known{pub fn drop(_:Vec<u8>)->u8{13}}mod user{use crate::broken::drop;fn run()->u8{#[cfg(x)]use crate::known::drop;drop(vec![1u8])}}",
    "src/broken.rs": broken,
  });
  g.unverified("drop", "known::drop");
  noCause(g, "drop");
  const l = g.links.find((l) => l.kind === "calls" && l.targetName === "drop");
  assert.match(l.data.uncertainty, /failed-file-unseen-declarations/);
});
test("round 10 B1 match guard values remain ordinary expressions", async () => {
  // rustc prints 3: the guard compares two enum values; it is not a pattern.
  const g = await graph(
    lib(
      "#[derive(PartialEq)]enum E{X}fn run(e:E)->u8{match Some(1){Some(_) if E::X==e=>3,_=>2}}",
    ),
  );
  picked(g, "E::X", "values", "variant", "E::X");
  assert.equal(
    g.links.some((l) => l.targetName === "E::X" && l.kind === "patterns"),
    false,
  );
});
test("round 10 B1 an unclassified callee expression cannot prove a definite link", async () => {
  // rustc prints 3; parenthesized callee propagation is not proved by this fallback.
  const g = await graph(lib("fn f()->u8{3}fn run()->u8{(f)()}"));
  g.unknown("(f)");
  assert.equal(
    g.links.find((l) => l.targetName === "(f)" && l.kind === "calls").data
      .uncertainty,
    "namespace-position-unverified",
  );
});
test("round 10 cache cyclic globs retain the captured namespace alternatives", async () => {
  // rustc prints 3: a/b's glob cycle does not hide c::S. The guard's S is a type.
  const g = await graph(
    lib(
      "mod a{pub use crate::b::*;pub use crate::c::*;}mod b{pub use crate::a::*;}mod c{pub struct S{pub x:u8}}use a::S;fn run()->u8{match Some(3){Some(x) if (S{x}).x==3=>3,_=>2}}",
    ),
  );
  picked(g, "S", "types", "struct", "c::S");
});

test("round 10 a self-named external import does not expand its own prefix", async () => {
  // rustc prints 5: std here aliases std::fmt; the fallback cannot see its methods.
  const g = await graph(
    lib(
      'use std::fmt as std; fn run()->String{std::format(format_args!("{}",5))}',
    ),
  );
  g.unknown("std::format");
});
test("round 10 repeated reexports with shrinking suffixes remain linkable", async () => {
  // rustc prints 3: each again consumes a path segment before reusing the import.
  const g = await graph(
    lib(
      "pub mod a{pub use crate::a as again;pub fn f()->u8{3}}fn run()->u8{a::again::again::f()}",
    ),
  );
  picked(g, "a::again::again::f", "calls", "function", "a::f");
});
