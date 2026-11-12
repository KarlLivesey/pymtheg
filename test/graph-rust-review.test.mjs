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
  manifests = { "Cargo.toml": '[package]\nedition="2024"\nname="app"\n' },
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
    one,
    unknown,
    would,
    unverified,
    files,
    contextFiles,
    symbols,
    links,
  };
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
  assert.equal(ts[1].length, 0);
  assert.ok(g.would("x.f")[1].some((s) => s.identity === "impl Foo<u8>::f"));
  const a = await graph(
    lib(
      `struct Foo<T>(T); impl<T> Foo<T>{fn f(&self){}} impl Foo<u8>{fn f(&self){}} fn run(x:Foo<u8>){x.f();}`,
    ),
  );
  assert.equal(a.would("x.f")[0].length, 2);
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
      "extra/p.rs": "pub mod child;",
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
      '[package]\nedition="2024"\nname="app"\n[dependencies]\nfoo={path="dep"}\nrenamed={package="foo",path="dep"}\n',
    "dep/Cargo.toml":
      '[package]\nedition="2024"\nname="foo"\n[lib]\nname="bar-name"\n',
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
  g.unknown("x.f");
  const ts = g.would("x.f")[0];
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
      "Cargo.toml":
        '[package]\nedition="2024"\nname="app"\n[dependencies]\ndep={path="dep"}\n',
      "dep/Cargo.toml": '[package]\nedition="2024"\nname="dep"\n',
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
      .would("A::f")[0]
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
        '[package]\nedition="2024"\nname="app"\nautobins=false\nautotests=false\n[build-dependencies]\ntool={path="dep"}\n',
      "dep/Cargo.toml": '[package]\nedition="2024"\nname="tool"\n',
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
  g.unverified("x.match", "impl Type::match");
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
      `mod a{pub mod f{}mod inner{pub fn f(){}}pub use inner::f;}use crate::a::f;fn run(){f();}`,
    ),
  );
  g.unknown("crate::a::f", "imports");
  g.one("f", "a::inner::f");
});

test("review path-child negative: a stem directory is not searched for a path-loaded file", async () => {
  const g = await graph({
    "src/lib.rs": '#[path="../extra/p.rs"]mod p;fn run(){p::child::f();}',
    "extra/p.rs": "pub mod child;",
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
  yes.unverified("x.f", "impl A::f");
});

test("review borrow preference: different autoref forms never imply inherent dominance", async () => {
  const g = await graph(
    lib(
      `struct A;impl A{fn f(&mut self){}}trait T{fn f(&self);}impl T for A{fn f(&self){}}fn run(mut x:A){x.f();}`,
    ),
  );
  assert.deepEqual(
    g
      .would("x.f")[0]
      .map((s) => s.identity)
      .sort(),
    ["impl A::f", "impl T for A::f"],
  );
  const same = await graph(
    lib(
      `struct A;impl A{fn f(&self){}}trait T{fn f(&self);}impl T for A{fn f(&self){}}fn run(x:A){x.f();}`,
    ),
  );
  same.unverified("x.f", "impl A::f");
});
test("review exact first probe beats reference trait impls", async () => {
  const g = await graph(
    lib(
      `struct A;impl A{fn f(&self){}}trait T{fn f(self);}impl T for &A{fn f(self){}}fn run(x:&A){x.f();}`,
    ),
  );
  g.one("x.f", "impl A::f"); // Exact first probe wins over the reference trait.
});

test("shared path file preserves both module views", async () => {
  const g = await graph({
    "src/lib.rs": `mod left { fn g(){} #[path="../shared.rs"] mod m; } mod right { fn g(){} #[path="../shared.rs"] mod m; }`,
    "src/shared.rs": `pub fn f(){super::g();}`,
  });
  assert.deepEqual(
    g
      .targets("super::g")[0]
      .map((s) => s.identity)
      .sort(),
    ["left::g", "right::g"],
  );
});

test("round 3.1: inferred placeholders and anonymous imports never bind names", async () => {
  const g = await graph(
    lib(
      `mod m {pub trait Ext{}} use m::Ext as _; fn run(x:Vec<u8>){let v:Vec<_>=x;} fn typed(x:m::Ext){}`,
    ),
  );
  assert.equal(
    g.links.filter(
      (l) => ["types", "patterns"].includes(l.kind) && l.targetName === "_",
    ).length,
    0,
  );
  g.one("m::Ext", "m::Ext", "types");
  const mixed = await graph(
    lib(
      `mod a{pub trait T{}}mod b{pub trait U{}}use a::T as _;use b::U as _;fn f(x:Vec<_>) {}`,
    ),
  );
  assert.equal(mixed.links.filter((l) => l.targetName === "_").length, 0);
});
test("round 3.2: blanket impls cannot disappear from method choices", async () => {
  for (const target of ["T", "&T", "&mut T"]) {
    const g = await graph(
      lib(
        `struct A;impl A{fn f(&self){}}trait Tr{fn f(self){}}impl<T> Tr for ${target} {}fn run(a:A){a.f();}`,
      ),
    );
    g.unknown("a.f");
  }
  const defaults = await graph(
    lib(
      `struct A;mod tr{pub trait T{fn f(self){}}pub trait U{fn f(&self){}}pub trait V{fn f(&self){}}}impl<X> tr::T for X{}impl tr::U for A{}impl tr::V for A{}use tr::T;fn run(a:A){a.f();}`,
    ),
  );
  defaults.unknown("a.f");
  const other = await graph(
    lib(
      `struct A;impl A{fn f(&self){}}trait Tr{fn other(self){}}impl<T> Tr for T{}fn run(a:A){a.f();}`,
    ),
  );
  other.unverified("a.f", "impl A::f");
  const bounded = await graph(
    lib(
      `struct A;impl A{fn f(&self){}}trait Tr{fn f(self){}}impl<T:Copy> Tr for T{}fn run(a:A){a.f();}`,
    ),
  );
  bounded.unknown("a.f");
});
test("round 3.3: all self receiver forms are parsed structurally", async () => {
  const forms = [
    ["self", "self"],
    ["mut self", "self"],
    ["&self", "&self"],
    ["&mut self", "&mut self"],
    ["&'a self", "&self"],
    ["&'a mut self", "&mut self"],
    ["self: Self", "self"],
    ["self: &Self", "&self"],
    ["self: &mut Self", "&mut self"],
    ["self: Box<Self>", "unknown"],
    ["self: Rc<Self>", "unknown"],
    ["self: Pin<&mut Self>", "unknown"],
    ["mut self: Box<Self>", "unknown"],
  ];
  for (const [form, kind] of forms) {
    const g = await graph(
      lib(`struct A;impl A{fn f(&mut self){}fn run<'a>(${form}){self.f();}}`),
    );
    const method = g.symbols.find((s) => s.identity === "impl A::run");
    assert.equal(method.data.receiverKind, kind, form);
    assert.equal(method.data.receiverSyntax, form);
    if (kind === "&mut self") g.one("self.f", "impl A::f");
    else g.unknown("self.f");
  }
  const g = await graph(
    lib(
      `struct A;impl A{fn f(&mut self){}fn run<'a>(&'a mut self){self.f();}}mod tr{pub trait U{fn f(&self){}}pub trait V{fn f(&self){}}}impl tr::U for A{}impl tr::V for A{}`,
    ),
  );
  assert.ok(g.targets("self.f")[0].some((s) => s.identity === "impl A::f"));
});
test("round 3.4: glob visibility is evaluated for the importing module", async () => {
  const g = await graph(
    lib(
      `mod a{fn drop(x:u8){}struct String;pub fn g(){}pub(crate) fn c(){}pub(super) fn s(){}pub(in crate::a) fn restricted(){}mod child{use super::*;fn run(){drop(1);restricted();}}}mod b{use crate::a::*;fn run(x:String){drop(x);g();c();s();restricted();}}`,
    ),
  );
  const drops = g.targets("drop");
  assert.equal(drops[0][0].identity, "a::drop");
  assert.equal(drops[1].length, 0);
  g.unknown("String", "types");
  g.one("g", "a::g");
  g.one("c", "a::c");
  g.one("s", "a::s");
  assert.deepEqual(
    g.targets("restricted").map((ts) => ts.map((s) => s.identity)),
    [["a::restricted"], []],
  );
  const shadow = await graph(
    lib(
      `mod a{pub fn f(){}}mod b{pub fn f(){}}mod c{use crate::a::*;use crate::b::f;fn run(){f();}}mod d{use crate::a::*;fn f(){}fn run(){f();}}`,
    ),
  );
  assert.deepEqual(
    shadow.targets("f").map((ts) => ts[0].identity),
    ["b::f", "d::f"],
  );
  const hidden = await graph(
    lib(
      `mod a{pub fn f(){}}mod b{use crate::a::f;}mod c{use crate::b::*;fn run(){f();}}`,
    ),
  );
  hidden.unknown("f");
});
test("round 3.5: lifetimes never select between impls", async () => {
  const g = await graph(
    lib(
      `struct A<'a>(&'a u8);impl<'a>A<'a>{fn new(){}fn f(&self){}}fn run(x:A<'_>){A::new();x.f();}`,
    ),
  );
  g.one("A::new", "impl<'a> A<'a>::new");
  g.unverified("x.f", "impl<'a> A<'a>::f");
  const generic = await graph(
    lib(`struct A<T>(T);impl<T>A<T>{fn new(){}}fn run(){A::new();}`),
  );
  generic.one("A::new", "impl<T> A<T>::new");
});
test("round 3.6: Self variants and members in the same generic impl", async () => {
  const g = await graph(
    lib(
      `enum E<T>{A(T),B}impl<T>E<T>{fn new(){}fn m(&self){}fn run(&self){Self::new();self.m();match self{Self::A(x)=>{},Self::B=>{}}}}`,
    ),
  );
  g.one("Self::new", "impl<T> E<T>::new");
  g.one("self.m", "impl<T> E<T>::m");
  g.one("Self::A", "E::A", "patterns");
  g.one("Self::B", "E::B", "patterns");
  const outside = await graph(
    lib(`struct A<T>(T);impl<T>A<T>{fn m(&self){}}fn run(x:A<u8>){x.m();}`),
  );
  outside.unverified("x.m", "impl<T> A<T>::m");
});
test("round 3.7: glob reexports compose and cycles terminate", async () => {
  const g = await graph(
    lib(
      `mod a{pub struct X;pub fn f(){}}mod facade{pub use crate::a::*;}mod facade2{pub use crate::facade::*;}mod user{use crate::facade2::*;use super::facade2::X;fn run(x:X){f();}}`,
    ),
  );
  g.one("X", "a::X", "types");
  g.one("f", "a::f");
  const cycle = await graph(
    lib(
      `mod a{pub use crate::b::*;pub fn f(){}}mod b{pub use crate::a::*;}mod user{use crate::b::*;fn run(){f();unknown();}}`,
    ),
  );
  cycle.one("f", "a::f");
  cycle.unknown("unknown");
  const ambiguous = await graph(
    lib(
      `mod a{pub fn f(){}}mod b{pub fn f(){}}mod facade{pub use crate::a::*;pub use crate::b::*;}use facade::*;fn run(){f();}`,
    ),
  );
  assert.equal(ambiguous.targets("f")[0].length, 2);
});
test("round 3.8: reference impl uncertainty is limited to supplied names", async () => {
  const g = await graph(
    lib(
      `struct A;impl A{fn f(&self){}}trait Tr{fn g(self){}}impl Tr for &A{}fn run(a:A){a.f();a.g();A::f(&a);}`,
    ),
  );
  g.unverified("a.f", "impl A::f");
  g.unknown("a.g");
  g.one("A::f", "impl A::f");
  const opaque = await graph(
    lib(
      `struct A;impl A{fn f(&self){}}impl External for &A{}fn run(a:A){a.f();A::f(&a);}`,
    ),
  );
  opaque.unknown("a.f");
  opaque.one("A::f", "impl A::f");
});
test("round 3.9: conditional patterns bind only within their actual regions", async () => {
  const g = await graph(
    lib(
      `fn f(){}fn run(x:Option<fn()>){if let Some(f)=x{f();}else{f();}f();while let Some(f)=x{f();}f();let Some(f)=x else{f();return;};f();}fn arms(x:Option<fn()>){match x{Some(f)=>f(),None=>f()};f();}`,
    ),
  );
  assert.deepEqual(
    g.targets("f").map((ts) => ts.map((s) => s.identity)),
    [[], ["f"], ["f"], [], ["f"], ["f"], [], [], ["f"], ["f"]],
  );
});
test("round 3.10: macro_export has public visibility", async () => {
  const g = await graph(
    lib(
      `#[macro_export]macro_rules! public_macro{()=>{}}macro_rules! private_macro{()=>{}}fn f(){public_macro!();private_macro!();}`,
    ),
  );
  assert.equal(
    g.symbols.find((s) => s.name === "public_macro").data.visibility,
    "pub",
  );
  assert.equal(
    g.symbols.find((s) => s.name === "private_macro").data.visibility,
    "private",
  );
  g.one("public_macro", "public_macro", "macros");
  g.one("private_macro", "private_macro", "macros");
});

test("round 3: multiline self calls retain same-impl generic evidence", async () => {
  const g = await graph(
    lib(`struct A<T>(T);impl<T>A<T>{fn f(&self){}fn run(&self){self\n .f();}}`),
  );
  g.one("self\n .f", "impl<T> A<T>::f");
});
test("round 6: an unresolved trait keeps later receiver applicability unknown", async () => {
  const g = await graph(
    lib(
      `struct W<T>(T);impl<T> External for W<T>{}struct A;impl A{fn f(&self){}}fn run(a:A,w:W<u8>){a.f();w.f();}`,
    ),
  );
  g.unknown("a.f"); // ROOT 3: an unresolved trait's defaults cannot establish exclusions.
  g.unknown("w.f");
});

test("round 3 loss audit: cfg attributes are not call arguments", async () => {
  const g = await graph(
    lib(
      `struct A;impl A{fn new(x:u8,#[cfg(test)] y:u8){} }fn run(){A::new(1,#[cfg(test)] 2);}`,
    ),
  );
  g.one("A::new", "impl A::new");
  const no = await graph(
    lib(`struct A;impl A{fn f(x:u8,y:u8){}}fn run(){A::f(1);}`),
  );
  no.unknown("A::f");
});

test("round 3 loss audit: wrapper blankets affect compatible nominal types only", async () => {
  const g = await graph(
    lib(
      `struct A;impl A{fn f(&self){}}struct W<T>(T);trait Tr{fn f(self){}}impl<T>Tr for W<T>{}impl<T>W<T>{fn f(&self){}fn run(&self){self.f();}}fn run(a:A){a.f();}`,
    ),
  );
  g.unverified("a.f", "impl A::f");
  g.one("self.f", "impl<T> W<T>::f");
});

test("round 3 unresolved audit: blanket impls in unrelated crates do not affect a caller", async () => {
  const sources = {
    "src/lib.rs": `struct A;impl A{fn f(&self){}}fn run(a:A){a.f();}`,
    "other/src/lib.rs": `pub trait Tr{fn f(self){}}impl<T>Tr for T{}`,
  };
  const manifests = {
    "Cargo.toml":
      '[package]\nedition="2024"\nname="app"\n[workspace]\nmembers=["other"]\n',
    "other/Cargo.toml": '[package]\nedition="2024"\nname="other"\n',
  };
  const isolated = await graph(sources, manifests);
  isolated.unverified("a.f", "impl A::f");
  const connected = await graph(
    { ...sources, "src/lib.rs": `use other::Tr;${sources["src/lib.rs"]}` },
    {
      ...manifests,
      "Cargo.toml":
        manifests["Cargo.toml"] + `[dependencies]\nother={path="other"}\n`,
    },
  );
  connected.unknown("a.f");
});

test("round 3 unresolved audit: standard Drop Default Clone names do not hide unrelated members", async () => {
  const g = await graph(
    lib(
      `struct A;impl Default for A{fn default()->Self{A}}impl A{fn f(&self){}fn run(&mut self){self.f();}}struct W<T>(T);use core::clone::Clone as C;impl<T:C>C for W<T>{fn clone(&self)->Self{todo!()}}impl<T>W<T>{fn f(&self){}fn run(&self){self.f();}}`,
    ),
  );
  assert.deepEqual(
    g.targets("self.f").map((ts) => ts.map((s) => s.identity)),
    [[], ["impl<T> W<T>::f"]],
  );
  const custom = await graph(
    lib(
      `use external::Clone;struct W<T>(T);impl<T> Clone for W<T>{}impl<T>W<T>{fn f(&self){}fn run(&self){self.f();}}`,
    ),
  );
  custom.one("self.f", "impl<T> W<T>::f");
  const local = await graph(
    lib(
      `trait Clone{fn f(self){}}struct A;impl Clone for A{}impl A{fn f(&self){}}fn run(a:A){a.f();}`,
    ),
  );
  assert.equal(local.would("a.f")[0].length, 2);
});

test("round 3 unresolved audit: known standard trait names also constrain reference impls", async () => {
  const g = await graph(
    lib(
      `struct A;impl A{fn len(&self){}fn run(&mut self){self.len();}}impl<'a> IntoIterator for &'a A{type Item=u8;type IntoIter=();fn into_iter(self)->Self::IntoIter{()}}impl From<u8> for A{fn from(x:u8)->Self{A}}`,
    ),
  );
  g.unknown("self.len"); // ExactSizeIterator::len is in the full prelude contract.
  const custom = await graph(
    lib(
      `use external::IntoIterator;struct A;impl A{fn len(&self){}}impl IntoIterator for &A{}fn run(a:A){a.len();}`,
    ),
  );
  custom.unknown("a.len");
});

test("round 3 standard trait evidence respects a shadowed std module", async () => {
  const g = await graph(
    lib(
      `mod std{pub mod clone{pub use external::Clone;}}struct W<T>(T);impl<T>std::clone::Clone for W<T>{}impl<T>W<T>{fn f(&self){}fn run(&self){self.f();}}`,
    ),
  );
  g.one("self.f", "impl<T> W<T>::f");
});

test("round 3 standard prelude evidence cannot override an opaque glob binding", async () => {
  const g = await graph(
    lib(
      `use external::*;struct W<T>(T);impl<T> Clone for W<T>{}impl<T>W<T>{fn f(&self){}fn run(&self){self.f();}}`,
    ),
  );
  g.one("self.f", "impl<T> W<T>::f");
});

test("round 3 unresolved audit: equal impl identity text does not merge their members", async () => {
  const g = await graph(
    lib(
      `struct W<T>(T);impl<T>W<T>{fn f(&self){}fn run(&self){self.f();}}impl<T>W<T>where T:Copy{fn other(&self){}}`,
    ),
  );
  g.one("self.f", "impl<T> W<T>::f");
  const impls = g.symbols.filter((s) => s.kind === "impl");
  assert.equal(impls.length, 2);
  assert.equal(impls[0].identity, impls[1].identity);
  assert.notEqual(impls[0].id, impls[1].id);
  const separate = await graph(
    lib(
      `struct W<T>(T);impl<T>W<T>{fn f(&self){}}impl<T>W<T>where T:Copy{fn run(&self){self.f();}}`,
    ),
  );
  separate.one("self.f", "impl<T> W<T>::f");
});

test("round 3 unresolved audit: static blanket functions cannot mask dot methods", async () => {
  const g = await graph(
    lib(
      `struct A;impl A{fn f(&mut self){}fn run(&mut self){self.f();}}trait Tr{fn f(){}}impl<T>Tr for T{}`,
    ),
  );
  g.one("self.f", "impl A::f");
  const receiver = await graph(
    lib(
      `struct A;impl A{fn f(&self){}}trait Tr{fn f(self){}}impl<T>Tr for T{}fn run(a:A){a.f();}`,
    ),
  );
  receiver.unknown("a.f");
});
test("round 3: associated trait candidate sets cannot omit a blanket default", async () => {
  const g = await graph(
    lib(
      `struct A;trait T{fn f(){}}impl<X>T for X{}trait U{fn f();}trait V{fn f();}impl U for A{fn f(){}}impl V for A{fn f(){}}fn run(){A::f();}`,
    ),
  );
  g.unknown("A::f");
  const inherent = await graph(
    lib(
      `struct A;trait T{fn f(){}}impl<X>T for X{}impl A{fn f(){}}fn run(){A::f();}`,
    ),
  );
  inherent.one("A::f", "impl A::f");
});

test("round 3 standard trait evidence respects Cargo and extern-crate aliases", async () => {
  const g = await graph(
    {
      "src/lib.rs": `struct W<T>(T);impl<T> ::std::clone::Clone for W<T>{}impl<T>W<T>{fn f(&self){}fn run(&self){self.f();}}`,
      "dep/src/lib.rs": `pub mod clone{pub use external::Clone;}`,
    },
    {
      "Cargo.toml":
        '[package]\nedition="2024"\nname="app"\n[dependencies]\nstd={path="dep"}\n',
      "dep/Cargo.toml": '[package]\nedition="2024"\nname="std"\n',
    },
  );
  g.one("self.f", "impl<T> W<T>::f");
  const alias = await graph(
    lib(
      `extern crate foreign as std;struct W<T>(T);impl<T> std::clone::Clone for W<T>{}impl<T>W<T>{fn f(&self){}fn run(&self){self.f();}}`,
    ),
  );
  alias.one("self.f", "impl<T> W<T>::f");
});

test("round 3 R3: equal type-argument spelling is not equal namespace binding", async () => {
  const g = await graph(
    lib(
      `struct F<T>(T);mod a{use super::F;pub type X=u8;impl F<X>{pub fn f(&self){}}}mod b{use super::F;type X=String;fn run(x:F<X>){x.f();}}`,
    ),
  );
  g.unknown("x.f");
  const same = await graph(
    lib(
      `struct F<T>(T);mod a{use super::F;pub type X=u8;impl F<X>{pub fn f(&self){}}}use a::X as Y;fn run(x:F<Y>){x.f();}`,
    ),
  );
  same.unverified("x.f", "a::impl F<X>::f");
  const generic = await graph(
    lib(
      `struct F<T>(T);type X=u8;impl F<X>{fn f(&self){}}fn run<X>(x:F<X>){x.f();}`,
    ),
  );
  generic.unknown("x.f");
});
test("round 3 R3: alias equivalence cannot be rejected out of a candidate set", async () => {
  const g = await graph(
    lib(
      `struct F<T>(T);type X=u8;impl F<X>{fn f(&self){}}trait U{fn f(&self);}trait V{fn f(&self);}impl U for F<u8>{fn f(&self){}}impl V for F<u8>{fn f(&self){}}fn run(x:F<u8>){x.f();}`,
    ),
  );
  g.unknown("x.f"); // Alias argument equivalence is unproven; never a closed set.
});
test("round 3 R5: lifetime erasure preserves char const arguments", async () => {
  const g = await graph(
    lib(
      `struct F<const C:char>;impl F<'a'>{fn f(&self){}}trait Tr{fn f(&self);}impl Tr for F<'b'>{fn f(&self){}}fn wrong(x:F<'b'>){x.f();}fn right(x:F<'a'>){x.f();}`,
    ),
  );
  assert.equal(g.targets("x.f")[0].length, 0);
  assert.ok(g.would("x.f")[1].some((s) => s.identity === "impl F<'a'>::f"));
});

test("round 3 generic bindings include Unicode parameter names", async () => {
  const blanket = await graph(
    lib(
      `struct A;impl A{fn f(&self){}}trait Tr{fn f(self){}}impl<Π>Tr for Π{}fn run(a:A){a.f();}`,
    ),
  );
  blanket.unknown("a.f");
  const scoped = await graph(
    lib(
      `struct Π;struct F<T>(T);trait Bound{}impl<Π:Bound>F<Π>{fn f(&self){}}trait Tr{fn f(&self);}impl Tr for F<Π>{fn f(&self){}}fn run(x:F<Π>){x.f();}`,
    ),
  );
  const choices = scoped.targets("x.f")[0];
  assert.notEqual(choices.length, 1);
  assert.ok(
    !choices.length ||
      choices.some((s) => s.identity === "impl Tr for F<Π>::f"),
  );
});

test("round 3 argument binding proof includes explicit standard imports", async () => {
  const g = await graph(
    lib(
      `use std::string::String as S;struct F<T>(T);impl F<u8>{fn f(&self){}}trait Tr{fn f(&self);}impl Tr for F<S>{fn f(&self){}}fn run(x:F<S>){x.f();}`,
    ),
  );
  g.unknown("x.f");
  const same = await graph(
    lib(
      `struct F<T>(T);impl F<::std::string::String>{fn f(&self){}}fn run(x:F<String>){x.f();}`,
    ),
  );
  same.unverified("x.f", "impl F<::std::string::String>::f");
});

test("round 3 binding identity: shared module type views cannot collapse dispatch", async () => {
  const g = await graph({
    "src/lib.rs": `#[path="shared.rs"]mod a;#[path="shared.rs"]mod b;impl a::S{fn f(&self){}}trait Tr{fn f(&self);}impl Tr for b::S{fn f(&self){}}`,
    "src/shared.rs": `use crate::Tr;pub struct S;impl S{pub fn run(&self){self.f();}}`,
  });
  g.unknown("self.f");
  const own = await graph({
    "src/lib.rs": `#[path="shared.rs"]mod a;#[path="shared.rs"]mod b;`,
    "src/shared.rs": `pub struct S;impl S{fn f(&self){}pub fn run(&self){self.f();}}`,
  });
  own.one("self.f", "impl S::f");
});
test("round 3 binding identity: alias receivers do not omit the underlying type's trait methods", async () => {
  const g = await graph(
    lib(
      `struct A;type Alias=A;impl Alias{fn f(&self){}}trait Tr{fn f(self);}impl Tr for A{fn f(self){}}fn run(x:Alias){x.f();}`,
    ),
  );
  assert.equal(g.would("x.f")[0].length, 2);
});
test("round 3 alias guard preserves explicitly captured associated functions", async () => {
  const g = await graph(
    lib(`struct A; type Alias=A;impl Alias{fn new(){}}fn run(){Alias::new();}`),
  );
  g.one("Alias::new", "impl Alias::new");
});
test("round 3 reference binding borrow is structural across lifetime spacing", async () => {
  const g = await graph(
    lib(`struct A;impl A{fn f(&mut self){}}fn run<'a>(x:& 'a mut A){x.f();}`),
  );
  g.one("x.f", "impl A::f");
});
test("round 3 unresolved audit: a dependency crate can be reexported by its own name", async () => {
  const g = await graph(
    {
      "src/lib.rs": `pub use dep;fn run(){dep::f();missing::f();}`,
      "dep/src/lib.rs": `pub fn f(){}`,
    },
    {
      "Cargo.toml":
        '[package]\nedition="2024"\nname="app"\n[dependencies]\ndep={path="dep"}',
      "dep/Cargo.toml": '[package]\nedition="2024"\nname="dep"',
    },
  );
  g.one("dep::f", "f");
  g.unknown("missing::f");
});
