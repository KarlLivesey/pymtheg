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
) {
  const files = [];
  for (const [path, text] of Object.entries(sources)) {
    const result = await rust.parse({ path, text });
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

test("round 5 A: known derives constrain only supplied names at later probes", async () => {
  for (const [derive, name] of [
    ["PartialEq", "eq"],
    ["PartialEq", "ne"],
    ["PartialOrd", "lt"],
    ["PartialOrd", "partial_cmp"],
    ["Ord", "max"],
    ["Ord", "cmp"],
    ["Ord", "clamp"],
    ["Hash", "hash"],
    ["Debug", "fmt"],
    ["Clone", "clone_from"],
  ]) {
    const g = await graph(
      lib(
        `use std::hash::Hash;use std::fmt::Debug;#[derive(PartialEq,Eq,PartialOrd,Ord,Hash,Debug,Clone,Copy)]struct A;
impl A{fn ${name}(${name === "max" ? "&self, _:A" : name === "clamp" ? "&self, _:A, _:A" : name === "hash" ? "&mut self,_:&mut impl std::hash::Hasher" : name === "fmt" ? "&mut self,_:&mut std::fmt::Formatter" : "&mut self,_:&A"}){}fn safe(&self){}}
fn r(mut a:A,h:&mut std::collections::hash_map::DefaultHasher,formatter:&mut std::fmt::Formatter){
 a.${name}(${name === "max" ? "A" : name === "clamp" ? "A,A" : name === "hash" ? "h" : name === "fmt" ? "formatter" : "&A"});a.safe();}`,
      ),
    );
    g.unknown(`a.${name}`);
    g.unverified("a.safe", "impl A::safe");
    const isolated = await graph(
      lib(
        `#[derive(${derive})]struct A;impl A{fn safe(&self){}}fn r(a:A){a.safe();}`,
      ),
    );
    isolated.unverified("a.safe", "impl A::safe");
  }
  const g = await graph(
    lib(
      `#[derive(PartialEq)]struct A;trait U{fn eq(&mut self,_:&A){}}trait V{fn eq(&mut self,_:&A){}}impl U for A{}impl V for A{}fn r(mut a:A){a.eq(&A);}`,
    ),
  );
  g.unknown("a.eq");
  for (const attr of [
    "#[derive(Custom)] /*comment*/",
    "#[custom::Derive]",
    "#[derive(Custom)]",
    '#[cfg_attr(feature="x",derive(Custom))]',
  ]) {
    const g = await graph(
      lib(`${attr}struct A;impl A{fn f(&self){}}fn r(a:A){a.f();}`),
    );
    g.unknown("a.f");
  }
  for (const attr of [
    "#[allow(dead_code)]",
    "#[repr(C)]",
    "#[derive(Eq,PartialEq,Copy,Clone)]",
  ]) {
    const g = await graph(
      lib(`${attr}struct A;impl A{fn f(&self){}}fn r(a:A){a.f();}`),
    );
    g.unverified("a.f", "impl A::f");
  }
});
test("round 5 A: first probe inherent beats ALL unseen alternatives", async () => {
  for (const [binding, receiver, mut] of [
    ["A", "self", ""],
    ["&A", "&self", ""],
    ["&mut A", "&mut self", ""],
  ]) {
    for (const source of [
      "#[derive(Custom)]struct A;",
      "#[make::generate]struct A;",
      "struct A;imp!(A);",
      "struct A;trait Tr:Sized{fn f(self){}}impl<T>Tr for T{}",
    ]) {
      const g = await graph(
        lib(
          `${source}impl A{fn f(${receiver}){} fn own(${receiver}){self.f();}}fn r(${mut}a:${binding}){a.f();}`,
        ),
      );
      if (source.startsWith("#[make::generate]")) {
        g.unverified("a.f", "impl A::f");
        g.unverified("self.f", "impl A::f");
      } else {
        g.one("a.f", "impl A::f");
        g.one("self.f", "impl A::f");
      }
    }
  }
  const g = await graph(
    lib(`struct A;impl A{fn clone(&self){}}fn r(a:&A){a.clone();}`),
  );
  g.one("a.clone", "impl A::clone");
  const standard = await graph(
    lib(`struct A;impl A{fn into(self)->u8{1}}fn r(a:A){a.into();}`),
  );
  standard.one("a.into", "impl A::into");
  const later = await graph(
    lib(`#[derive(Custom)]struct A;impl A{fn f(&self){}}fn r(a:A){a.f();}`),
  );
  later.unknown("a.f");
});
test("round 5 A: path lookup to one inherent member needs no generic substitution", async () => {
  const g = await graph(
    lib(
      `struct A<X,Y>(X,Y);impl<X,Y>A<X,Y>{fn new(x:X,y:Y)->Self{A(x,y)}}impl<X>A<X,u8>{fn specialised(){}}fn r(){A::new(1,2);A::specialised();}`,
    ),
  );
  g.one("A::new", "impl<X,Y> A<X,Y>::new");
});
test("round 5 A/B: candidate completeness and crate boundaries", async () => {
  const source = `pub struct A;trait U{fn f(&self){}}trait V{fn f(&self){}}impl U for A{}impl V for A{}fn r(a:A){a.f();}`;
  const clean = await graph(lib(source));
  assert.equal(clean.would("a.f")[0].length, 2);
  const opaque = await graph(lib(`#[make::generate]${source}`));
  opaque.unknown("a.f");
  assert.equal(
    opaque.links.find((l) => l.targetName === "a.f").data.targets.length,
    2,
  );
  const swallowed = await graph({
    "src/lib.rs": `mod d;${source}`,
    "src/d.rs": "impl crate::T2 for crate::A { impl crate::U for crate::A {}",
  });
  swallowed.unknown("a.f");
  const unrelated = await graph(
    { "src/lib.rs": source, "other/src/lib.rs": "pub struct Broken<" },
    {
      "Cargo.toml": '[package]\nedition="2024"\nname="app"',
      "other/Cargo.toml": '[package]\nedition="2024"\nname="other"',
    },
  );
  assert.equal(unrelated.would("a.f")[0].length, 2);
  const d = await graph({
    "src/lib.rs":
      "mod good;mod broken;mod mid{pub use crate::broken::*;}fn r(){mid::f();}",
    "src/good.rs": "pub fn f(){}",
    "src/broken.rs": "pub use crate::good::*;pub fn f(",
  });
  d.unknown("mid::f");
});

test("round 5 A/B: unseen impls also prevent closed trait path sets", async () => {
  const decl = `pub struct A;trait U{fn f(&self){}}trait V{fn f(&self){}}impl U for A{}impl V for A{}fn r(a:A){A::f(&a);}`;
  const clean = await graph(lib(decl));
  assert.equal(clean.would("A::f")[0].length, 2);
  for (const prefix of ["#[derive(Custom)]", "#[make::generate]", "imp!(A);"]) {
    const g = await graph(lib(prefix + decl));
    g.unknown("A::f");
  }
  const lossy = await graph({
    "src/lib.rs": "mod broken;" + decl,
    "src/broken.rs": "impl crate::A { pub fn f(",
  });
  lossy.unknown("A::f");
  const inherent = await graph(
    lib(
      `#[derive(Custom)]struct A;impl A{fn f(&self){}}trait U{fn f(&self){}}impl U for A{}fn r(a:A){A::f(&a);}`,
    ),
  );
  inherent.one("A::f", "impl A::f");
});

test("round 5 A: attributed aliases feed the same nominal uncertainty index", async () => {
  for (const alias of [
    "#[make::generate]type A=B;",
    "type Next=B;#[make::generate]type A=Next;",
    "#[make::generate]type A<'a>=&'a B;",
  ]) {
    const g = await graph(
      lib(`struct B;${alias}impl B{fn f(&self){}}fn run(b:B){b.f();}`),
    );
    g.unknown("b.f");
    const first = await graph(
      lib(`struct B;${alias}impl B{fn f(&self){}}fn run(b:&B){b.f();}`),
    );
    first.one("b.f", "impl B::f");
  }
  const blanket = await graph(
    lib(
      `struct T;#[make::generate]type A<T>=T;struct B;impl B{fn f(&self){}}fn run(b:B){b.f();}`,
    ),
  );
  blanket.unknown("b.f");
  const shape = await graph(
    lib(
      `#[make::generate]type A<T>=Box<T>;struct B;impl B{fn f(&self){}}fn run(b:B){b.f();}`,
    ),
  );
  shape.unverified("b.f", "impl B::f");
});

test("round 5 A: self retains its signature type across opaque statements", async () => {
  for (const receiver of ["self", "&self", "&mut self"]) {
    const g = await graph(
      lib(
        `struct A;impl A{fn f(${receiver}){}fn run(${receiver}){m!(self);self.f();}}`,
      ),
    );
    g.one("self.f", "impl A::f");
  }
  const later = await graph(
    lib(`struct A;impl A{fn f(&self){}fn run(self){m!(self);self.f();}}`),
  );
  later.unknown("self.f");
  const unrelated = await graph(
    lib(
      `mod a{pub struct A;impl A{fn f(&self){}fn run(&self){m!(self);self.f();}}}mod b{pub struct A;impl A{pub fn f(&self){}}}fn r(x:b::A){x.f();}`,
    ),
  );
  unrelated.unverified("x.f", "b::impl A::f");
});

test("round 5 A: sole path lookup cannot bypass unknown explicit specialisation", async () => {
  const g = await graph(
    lib(
      `struct W<T>(T);impl<T>W<Vec<T>>{fn f(){}}trait Tr{fn f();}impl Tr for W<String>{fn f(){}}fn run(){W::<String>::f();}`,
    ),
  );
  g.unknown("W::<String>::f");
  const implicit = await graph(
    lib(`struct W<T>(T);impl<T>W<Vec<T>>{fn f(){}}fn run(){W::f();}`),
  );
  implicit.one("W::f", "impl<T> W<Vec<T>>::f");
});

test("round 5 A: explicit path arguments cannot assume unproved impl bounds", async () => {
  const g = await graph(
    lib(
      `struct W<T>(T);impl<T:Copy>W<T>{fn f(){}}trait Tr{fn f();}impl Tr for W<String>{fn f(){}}fn run(){W::<String>::f();}`,
    ),
  );
  g.unknown("W::<String>::f");
  const generic = await graph(
    lib(`struct W<T>(T);impl<T>W<T>{fn f(){}}fn run(){W::<String>::f();}`),
  );
  generic.one("W::<String>::f", "impl<T> W<T>::f");
});
