import assert from "node:assert/strict";
import { test } from "node:test";
import { fileFacts, contentHash, validateResult } from "../dist/graph/index.js";
import rust from "../dist/graph/languages/rust/index.js";
async function graph(
  sources,
  manifests = { "Cargo.toml": '[package]\nname="app"\n' },
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
  return { targets, one, unknown, files, contextFiles, symbols, links };
}
const lib = (text) => ({ "src/lib.rs": text });
test("review 1: type/value/macro namespaces and constructor forms", async () => {
  const g = await graph(
    lib(
      `fn f() {} fn run(){ struct f { x:u8 } f(); } struct Unit; struct Tuple(u8); struct Named { x:u8 } enum E { Tuple(u8), Named{x:u8}, Unit } fn check(){ Tuple(1); Unit(); Named(); E::Tuple(1); E::Named(); E::Unit(); }`,
    ),
  );
  g.one("f", "f");
  g.one("Tuple", "Tuple");
  g.one("Unit", "Unit");
  g.unknown("Named");
  g.one("E::Tuple", "E::Tuple");
  g.unknown("E::Named");
  g.unknown("E::Unit");
  const shadow = await graph(lib(`fn f(){} fn run(){ struct f(u8); f(1); }`));
  shadow.one("f", "run::f");
});
test("review 2: shared receiver cannot select a mutable inherent method", async () => {
  const g = await graph(
    lib(
      `struct A; impl A { fn f(&mut self){} fn read(&self){} } trait T {fn f(&self);} impl T for A {fn f(&self){}} fn run(x:&A){x.f();x.read();} fn yes(x:&mut A){x.f();}`,
    ),
  );
  const targets = g.targets("x.f");
  assert.equal(targets[0].length, 0);
  assert.equal(targets[1][0].identity, "impl A::f");
  g.one("x.read", "impl A::read");
});
test("review 3: concrete generic impls must match the receiver arguments", async () => {
  const g = await graph(
    lib(
      `struct Foo<T>(T); trait Speak {fn f(&self);} impl Foo<u8>{fn f(&self){}} impl Speak for Foo<String>{fn f(&self){}} fn no(x:Foo<String>){x.f();} fn yes(x:Foo<u8>){x.f();}`,
    ),
  );
  const ts = g.targets("x.f");
  assert.equal(ts[0].length, 0);
  assert.equal(ts[1][0].identity, "impl Foo<u8>::f");
  const a = await graph(
    lib(
      `struct Foo<T>(T); impl<T> Foo<T>{fn f(&self){}} impl Foo<u8>{fn f(&self){}} fn run(x:Foo<u8>){x.f();}`,
    ),
  );
  assert.equal(a.targets("x.f")[0].length, 2);
});
test("review 4: modules inside functions form module scope barriers", async () => {
  const g = await graph(
    lib(
      `pub fn drop(){} pub fn outer(){fn hidden(){} mod inner {pub fn h(){drop(1u8);hidden();crate::drop();super::drop();}} inner::h();}`,
    ),
  );
  g.unknown("drop");
  g.unknown("hidden");
  g.one("inner::h", "outer::inner::h");
  g.one("crate::drop", "drop");
  g.one("super::drop", "drop");
});
test("review 5: path-loaded files have sibling child modules", async () => {
  for (const wrong of [false, true]) {
    const g = await graph({
      "src/lib.rs": '#[path="../extra/p.rs"] mod p; fn run(){p::child::f();}',
      "extra/p.rs": "mod child;",
      "extra/child.rs": "pub fn f(){}",
      ...(wrong ? { "extra/p/child.rs": "pub fn wrong(){}" } : {}),
    });
    g.one("p::child::f", "f");
    assert.equal(g.targets("p::child::f")[0][0].file, "extra/child.rs");
  }
});
test("review 6: library target names and explicit Cargo renames", async () => {
  const src = {
    "src/lib.rs": "fn run(){bar_name::f();foo::f();renamed::f();}",
    "dep/src/lib.rs": "pub fn f(){}",
  };
  const g = await graph(src, {
    "Cargo.toml":
      '[package]\nname="app"\n[dependencies]\nfoo={path="dep"}\nrenamed={package="foo",path="dep"}\n',
    "dep/Cargo.toml": '[package]\nname="foo"\n[lib]\nname="bar-name"\n',
  });
  g.one("bar_name::f", "f");
  g.unknown("foo::f");
  g.one("renamed::f", "f");
});
test("review 7: candidates include trait defaults as well as overrides", async () => {
  const g = await graph(
    lib(
      `struct A; mod traits {pub trait T{fn f(&self){}} pub trait U{fn f(&self);} pub trait V{fn f(&self);}} impl traits::T for A{} impl traits::U for A{fn f(&self){}} impl traits::V for A{fn f(&self){}} use traits::T; fn run(x:A){x.f();}`,
    ),
  );
  const ts = g.targets("x.f")[0];
  assert.deepEqual(ts.map((s) => s.identity).sort(), [
    "impl traits::U for A::f",
    "impl traits::V for A::f",
    "traits::T::f",
  ]);
});
test("review 8: use sites follow multi-hop reexports and parent imports", async () => {
  const g = await graph({
    "src/lib.rs":
      "mod event; mod user; mod second {pub use crate::event::{EventArray,make};} mod third {pub use super::second::*;} fn run(){crate::third::make();}",
    "src/event/mod.rs": "mod array; pub use array::{EventArray,make};",
    "src/event/array.rs":
      "pub struct EventArray; impl EventArray{pub fn new()->Self{EventArray}} pub fn make(){}",
    "src/user.rs":
      "use crate::third::{EventArray,make}; fn f(x:EventArray){make();EventArray::new();} mod child{fn g(){super::make();}}",
  });
  g.one("make", "make");
  g.one("crate::third::make", "make");
  g.one("super::make", "make");
  g.one("EventArray::new", "impl EventArray::new");
  g.one("EventArray", "EventArray", "types");
});
test("review 9: dependency reexports use the destination crate", async () => {
  const g = await graph(
    {
      "src/lib.rs": "fn f(){dep::exported();::dep::exported();dep::missing();}",
      "dep/src/lib.rs": "mod inner{pub fn f(){}} pub use inner::f as exported;",
    },
    {
      "Cargo.toml": '[package]\nname="app"\n[dependencies]\ndep={path="dep"}\n',
      "dep/Cargo.toml": '[package]\nname="dep"\n',
    },
  );
  g.one("dep::exported", "inner::f");
  g.one("::dep::exported", "inner::f");
  g.unknown("dep::missing");
});
test("review 10: raw identifiers normalize names, uses and module files", async () => {
  const g = await graph({
    "src/lib.rs":
      "mod r#ref; use crate::r#ref::r#type as r#match; fn run(){r#ref::r#type();r#match();missing::r#type();}",
    "src/ref.rs": "pub fn r#type(){}",
  });
  g.one("ref::type", "type");
  g.one("match", "type");
  g.unknown("missing::type");
  g.one("ref", "$crate", "modules");
});
test("review 11: path patterns resolve variants, constructors and constants", async () => {
  const g = await graph(
    lib(
      `enum E{Unit,Tuple(u8),Named{x:u8}} struct S(u8); const C:u8=1; fn f(x:E,y:S,n:u8){match x{E::Unit=>{},E::Tuple(_)=>{},E::Named{x:_}=>{}} if let S(_)=y{} match n{crate::C=>{},_=>{}}}`,
    ),
  );
  for (const name of ["E::Unit", "E::Tuple", "E::Named"])
    g.one(name, name, "patterns");
  g.one("S", "S", "patterns");
  g.one("crate::C", "C", "patterns");
});
test("review 12: a single trait impl never proves dispatch; two associated choices are candidates", async () => {
  const g = await graph(
    lib(
      `struct A; trait Tr{fn m(&self);fn f();} impl Tr for A{fn m(&self){}fn f(){}} fn run(x:A){x.m();A::f();}`,
    ),
  );
  g.unknown("x.m");
  g.unknown("A::f");
  const a = await graph(
    lib(
      `struct A;trait T{fn f();}trait U{fn f();}impl T for A{fn f(){}}impl U for A{fn f(){}}fn run(){A::f();}`,
    ),
  );
  assert.deepEqual(
    a
      .targets("A::f")[0]
      .map((s) => s.identity)
      .sort(),
    ["impl T for A::f", "impl U for A::f"],
  );
});
test("review 14: automatic Cargo targets and build dependencies are crate roots", async () => {
  const sources = {
    "src/lib.rs": "pub fn f(){}",
    "src/bin/a.rs": "fn local(){}fn main(){local();app::f();}",
    "src/bin/b/main.rs": "fn local(){}fn main(){local();}",
    "examples/e.rs": "fn local(){}fn main(){local();}",
    "tests/t.rs": "fn local(){}fn t(){local();}",
    "benches/b.rs": "fn local(){}fn b(){local();}",
    "build.rs": "fn local(){}fn main(){local();}",
    "loose.rs": "fn local(){}fn f(){local();}",
  };
  const g = await graph(sources);
  const ts = g.targets("local");
  assert.equal(ts.filter((t) => t.length === 1).length, 6);
  assert.equal(ts.filter((t) => !t.length).length, 1);
  g.one("app::f", "f");
  const results = await rust.analyze({
    projectId: "review",
    files: g.files,
    contextFiles: g.contextFiles,
    changedFiles: [],
    changedContextFiles: [],
  });
  for (const f of results)
    if (f.path !== "loose.rs")
      assert.equal(
        f.result.symbols.find((s) => s.key === "file").data.unitKind,
        "crate",
        f.path,
      );
});

test("review uncertainty: unknown trait defaults cannot be omitted from a candidate set", async () => {
  const g = await graph(
    lib(
      `struct A; trait U{fn f(&self);}trait V{fn f(&self);}impl external::T for A{}impl U for A{fn f(&self){}}impl V for A{fn f(&self){}}fn run(x:A){x.f();}`,
    ),
  );
  g.unknown("x.f");
});
test("review Cargo target flags and build dependency environments", async () => {
  const g = await graph(
    {
      "src/lib.rs": "pub fn f(){tool::f();}",
      "build.rs": "fn main(){tool::f();app::f();}",
      "src/main.rs": "fn main(){app::f();}",
      "src/bin/disabled.rs": "fn f(){app::f();}",
      "tests/disabled.rs": "fn f(){app::f();}",
      "dep/src/lib.rs": "pub fn f(){}",
    },
    {
      "Cargo.toml":
        '[package]\nname="app"\nautobins=false\nautotests=false\n[build-dependencies]\ntool={path="dep"}\n',
      "dep/Cargo.toml": '[package]\nname="tool"\n',
    },
  );
  const ts = g.targets("tool::f");
  assert.equal(ts[0].length, 0);
  assert.equal(ts[1][0].file, "dep/src/lib.rs");
  g.unknown("app::f");
});
test("review raw receiver types and method names resolve canonically", async () => {
  const g = await graph(
    lib(
      `struct r#Type;impl r#Type{fn r#match(&self){}}fn run(x:r#Type){x.r#match();}`,
    ),
  );
  g.one("x.match", "impl Type::match");
});

test("review self imports preserve the inline module namespace", async () => {
  const g = await graph(
    lib(
      `fn f(){}mod inner{use self::{self as here};pub fn f(){}fn run(){here::f();}}`,
    ),
  );
  g.one("here::f", "inner::f");
});

test("review audit: trait candidates respect explicit argument counts", async () => {
  const g = await graph(
    lib(
      `struct A;trait T{fn f(&self);}trait U{fn f(&self,n:u8);}impl T for A{fn f(&self){}}impl U for A{fn f(&self,n:u8){}}fn run(x:A){x.f();}`,
    ),
  );
  g.unknown("x.f");
});
test("review audit: unknown explicit imports cannot fall through to a glob", async () => {
  const g = await graph(
    lib(`use external::f;mod m{pub fn f(){}}use crate::m::*;fn run(){f();}`),
  );
  g.unknown("f");
  const positive = await graph(
    lib(`fn f(){}mod m{pub struct f{x:u8}}fn run(){use crate::m::f;f();}`),
  );
  positive.one("f", "f");
});
test("review audit: mixed-namespace imports are not a one-of candidate set", async () => {
  const g = await graph(
    lib(`mod m{pub mod f{}pub fn f(){}}use crate::m::f;fn run(){f();}`),
  );
  g.unknown("crate::m::f", "imports");
  g.one("f", "m::f");
});

test("review audit: imports combine direct and reexported namespaces without asserting one winner", async () => {
  const g = await graph(
    lib(
      `mod a{mod f{}mod inner{pub fn f(){}}pub use inner::f;}use crate::a::f;fn run(){f();}`,
    ),
  );
  g.unknown("crate::a::f", "imports");
  g.one("f", "a::inner::f");
});

test("review path-child negative: a stem directory is not searched for a path-loaded file", async () => {
  const g = await graph({
    "src/lib.rs": '#[path="../extra/p.rs"]mod p;fn run(){p::child::f();}',
    "extra/p.rs": "mod child;",
    "extra/p/child.rs": "pub fn f(){}",
  });
  g.unknown("p::child::f");
  g.unknown("child", "modules");
});
test("review patterns negative: absent external variants remain named and unresolved", async () => {
  const g = await graph(
    lib(`fn f(x:external::E){match x{external::E::V(_)=>{}}}`),
  );
  g.unknown("external::E::V", "patterns");
});
test("review reexport cycles remain unresolved", async () => {
  const g = await graph(
    lib(
      `mod a{pub use crate::b::f;}mod b{pub use crate::a::f;}fn run(){a::f();}`,
    ),
  );
  g.unknown("a::f");
});

test("review raw generic parameters cannot capture a concrete same-named type", async () => {
  const g = await graph(
    lib(
      `struct Type;impl Type{fn f(&self){}}trait Tr{fn f(&self);}fn run<r#Type:Tr>(x:r#Type){x.f();}`,
    ),
  );
  g.unknown("x.f");
});

test("review raw local bindings shadow and type-check under either identifier spelling", async () => {
  const g = await graph(
    lib(`fn f(){}fn run(){let r#f=||{};f();}fn other(){let f=||{};r#f();}`),
  );
  g.unknown("f");
  const yes = await graph(
    lib(`struct A;impl A{fn f(&self){}}fn run(r#x:A){x.f();}`),
  );
  yes.one("x.f", "impl A::f");
});

test("review borrow preference: different autoref forms never imply inherent dominance", async () => {
  const g = await graph(
    lib(
      `struct A;impl A{fn f(&mut self){}}trait T{fn f(&self);}impl T for A{fn f(&self){}}fn run(mut x:A){x.f();}`,
    ),
  );
  assert.deepEqual(
    g
      .targets("x.f")[0]
      .map((s) => s.identity)
      .sort(),
    ["impl A::f", "impl T for A::f"],
  );
  const same = await graph(
    lib(
      `struct A;impl A{fn f(&self){}}trait T{fn f(&self);}impl T for A{fn f(&self){}}fn run(x:A){x.f();}`,
    ),
  );
  same.one("x.f", "impl A::f");
});
test("review reference impls are not silently omitted from receiver choices", async () => {
  const g = await graph(
    lib(
      `struct A;impl A{fn f(&self){}}trait T{fn f(self);}impl T for &A{fn f(self){}}fn run(x:&A){x.f();}`,
    ),
  );
  g.unknown("x.f");
});
