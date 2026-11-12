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

test("round 6 F7 unknown cfg alternatives cannot vanish at the first probe or path", async () => {
  // rustc prints 1 without bounded and 2 with --cfg feature="bounded".
  for (const [first, second] of [
    ['#[cfg(not(feature="bounded"))]', '#[cfg(feature="bounded")]'],
    [
      '#[cfg_attr(feature="x",cfg(feature="bounded"))]',
      '#[cfg(feature="bounded")]',
    ],
    ["", '#[cfg(feature="bounded")]'],
  ]) {
    const g = await graph(
      lib(
        `struct W<T>(T);${first}impl<T>W<T>{fn f(&self){}fn new(){}}${second}impl<T:Copy>W<T>{fn f(&self){}fn new(){}}fn r(w:&W<u8>){w.f();W::<u8>::new();}`,
      ),
    );
    g.unknown("w.f");
    g.unknown("W::<u8>::new");
    for (const n of ["w.f", "W::<u8>::new"])
      assert.equal(
        g.links.find((l) => l.targetName === n).data.targets.length,
        2,
      );
  }
  const methods = await graph(
    lib(
      `struct W<T>(T);impl<T>W<T>{#[cfg(not(feature="x"))]fn f(&self){}#[cfg(feature="x")]fn f(&self)where T:Copy{}}fn r(w:&W<u8>){w.f();}`,
    ),
  );
  // Bounds on the METHOD require applicability evidence too; neither cfg is selected.
  methods.unknown("w.f");
  assert.equal(
    methods.links.find((l) => l.targetName === "w.f").data.targets.length,
    2,
  );
  const known = await graph(
    lib(
      `struct A;impl A{#[cfg(feature="x")]fn f(&self){}#[cfg(not(feature="x"))]fn f(&self){}}fn r(a:&A){a.f();}`,
    ),
  );
  known.unknown("a.f");
  assert.equal(known.would("a.f")[0].length, 2);
});
test("round 6 cfg namespace alternatives are merged rather than filtered to one view", async () => {
  for (const source of [
    `#[cfg(feature="x")]mod a{pub fn f(){}}#[cfg(not(feature="x"))]mod a{pub fn f(){}}fn r(){a::f();}`,
    `#[cfg(feature="x")]mod a{pub fn f(){}}#[cfg(not(feature="x"))]mod b{pub fn f(){}}#[cfg(feature="x")]use a::f;#[cfg(not(feature="x"))]use b::f;fn r(){f();}`,
    `#[cfg(feature="x")]mod a{pub fn f(){}}#[cfg(not(feature="x"))]mod b{pub fn f(){}}#[cfg(feature="x")]use a::*;#[cfg(not(feature="x"))]use b::*;fn r(){f();}`,
  ]) {
    const g = await graph(lib(source));
    const name = source.includes("a::f();") ? "a::f" : "f";
    assert.equal(g.targets(name)[0].length, 2, source);
  }
  const mods = await graph({
    "src/lib.rs": `#[cfg(feature="x")]#[path="a.rs"]mod m;#[cfg(not(feature="x"))]#[path="b.rs"]mod m;fn r(){m::f();}`,
    "src/a.rs": "pub fn f(){}",
    "src/b.rs": "pub fn f(){}",
  });
  assert.equal(mods.targets("m::f")[0].length, 2);
  const variants = await graph(
    lib(
      `#[cfg(feature="x")]enum E{Unit}#[cfg(not(feature="x"))]enum E{Unit}fn r(){let x=E::Unit;}`,
    ),
  );
  assert.equal(variants.targets("E::Unit", "values")[0].length, 2);
  const structs = await graph(
    lib(
      `#[cfg(feature="x")]struct S{x:u8}#[cfg(not(feature="x"))]struct S{x:u8}fn r(){let s=S{x:1};}`,
    ),
  );
  assert.equal(structs.targets("S", "types")[0].length, 2);
  const konst = await graph(
    lib(`struct A;impl A{const X:u8=1;fn r(){let x=Self::X;}}`),
  );
  konst.unknown("Self::X", "values"); // Associated const / qualified projection lookup remains unsupported, never guessed.
  const qualified = await graph(
    lib(
      `trait Tr{fn f();}struct A;impl Tr for A{fn f(){}}fn r(){<A as Tr>::f();}`,
    ),
  );
  qualified.unknown("<AasTr>::f");
});
test("round 6 cfg_attr module paths keep every layout alternative", async () => {
  const sources = {
    "src/lib.rs": `#[cfg_attr(feature="x",path="other.rs")]mod m;fn r(){m::f();}`,
    "src/m.rs": "pub fn f(){}",
    "src/other.rs": "pub fn f(){}",
  };
  const g = await graph(sources);
  assert.equal(g.targets("m::f")[0].length, 2);
  delete sources["src/other.rs"];
  const missing = await graph(sources);
  missing.unknown("m::f");
  assert.equal(
    missing.links.find((l) => l.targetName === "m::f").data.targets.length,
    1,
  );
});

test("round 6 F7 enclosing module cfg and mod declaration cfg retain unknown impls", async () => {
  for (const gate of [
    '#[cfg(feature="x")]',
    '#[cfg_attr(feature="x",cfg(feature="y"))]',
  ]) {
    const g = await graph(
      lib(
        `struct W<T>(T);${gate}mod a{impl<T>crate::W<T>{pub fn f(&self){}}}#[cfg(not(feature="x"))]mod b{impl<T:Copy>crate::W<T>{pub fn f(&self){}}}fn r(w:&W<u8>){w.f();}`,
      ),
    );
    g.unknown("w.f");
    assert.equal(
      g.links.find((l) => l.targetName === "w.f").data.targets.length,
      2,
    );
  }
  const g = await graph({
    "src/lib.rs": `struct W<T>(T);#[cfg(feature="x")]#[path="a.rs"]mod chosen;#[cfg(not(feature="x"))]#[path="b.rs"]mod chosen;fn r(w:&W<u8>){w.f();}`,
    "src/a.rs": "impl<T>crate::W<T>{pub fn f(&self){}}",
    "src/b.rs": "impl<T:Copy>crate::W<T>{pub fn f(&self){}}",
  });
  g.unknown("w.f");
  assert.equal(
    g.links.find((l) => l.targetName === "w.f").data.targets.length,
    2,
  );
});

test("round 6 cfg named variant literals keep every type-namespace constructor", async () => {
  const g = await graph(
    lib(
      `#[cfg(feature="x")]enum E{V{x:u8}}#[cfg(not(feature="x"))]enum E{V{x:u8}}fn r(){let v=E::V{x:1};}`,
    ),
  );
  assert.equal(g.targets("E::V", "types")[0].length, 2);
  const shadow = await graph(
    lib(`mod a{pub struct S{x:u8}}use a::S;const S:u8=0;fn r(){let x=S{x:1};}`),
  );
  shadow.one("S", "a::S", "types");
});

// All safety snippets have rustc-confirmed trait callees (round6-rustc.mjs).
// D16 does not attempt to prove any of these later-probe calls.
test("safety: hidden standard and custom generated trait methods never prove later probes", async () => {
  for (const [prefix, method, args, receiver] of [
    [
      "#[derive(PartialEq,Eq)]struct A;",
      "assert_receiver_is_total_eq",
      "",
      "A",
    ],
    ["#[derive(Clone)]struct A;", "clone_into", "_t:&mut A", "A"],
    [
      "struct A;impl Clone for A{fn clone(&self)->Self{A}}",
      "clone_into",
      "_t:&mut A",
      "A",
    ],
    ["use std::ops::Deref;struct A;", "deref", "", "&mut A"],
    [
      "use std::fmt::Pointer;struct A;",
      "fmt",
      "_f:&mut std::fmt::Formatter",
      "&mut A",
    ],
    ["use pm::Debug;#[derive(Debug)]struct A;", "f", "", "A"],
    ["use proc::Clone;#[derive(Clone)]struct A;", "f", "", "A"],
  ]) {
    const params = args ? "," + args : "";
    const supplied = args ? ",t:&mut A" : "";
    const call = args ? "t" : "";
    const mutable = ["deref", "fmt"].includes(method) ? "&self" : "&mut self";
    const g = await graph(
      lib(
        `${prefix}impl A{fn ${method}(${mutable}${params}){}}fn r(mut a:${receiver}${supplied}){a.${method}(${call});}`,
      ),
    );
    g.unverified(`a.${method}`, `impl A::${method}`);
  }
  for (const attribute of ["#[pm::gen(A)]", "#[proc::add]"]) {
    const g = await graph(
      lib(
        `struct A;${attribute}impl A{fn f(&self){}}fn r(a:A){a.f();}fn first(a:&A){a.f();}`,
      ),
    );
    assert.deepEqual(
      g.targets("a.f").map((t) => t.map((s) => s.identity)),
      [[], []],
    );
    assert.ok(
      g.would("a.f").every((ts) => ts.some((s) => s.identity === "impl A::f")),
    );
  }
});

test("D16: first probes alone prove dot calls; trait and cfg choices never close", async () => {
  for (const [param, recv] of [
    ["A", "self"],
    ["&A", "&self"],
    ["&mut A", "&mut self"],
  ]) {
    const g = await graph(
      lib(
        `struct A;impl A{fn f(${recv}){}}trait Tr{fn f(self){}}impl<T>Tr for T{}fn r(a:${param}){a.f();}`,
      ),
    );
    g.one("a.f", "impl A::f");
  }
  const later = await graph(
    lib(`struct A;impl A{fn f(&self){}}fn r(a:A){a.f();}`),
  );
  later.unverified("a.f", "impl A::f");
  assert.equal(
    later.links.find((l) => l.targetName === "a.f").data.uncertainty,
    "later-probe-step",
  );
  const trait = await graph(
    lib(`struct A;trait Tr{fn f(&self){}}impl Tr for A{}fn r(a:&A){a.f();}`),
  );
  trait.unverified("a.f", "Tr::f");
  assert.equal(
    trait.links.find((l) => l.targetName === "a.f").data.uncertainty,
    "trait-dispatch",
  );
  const unknown = await graph(
    lib(
      `struct A;impl A{fn f(&self){}}impl missing::Tr for missing::Type{fn f(self){}}fn r(a:A){a.f();}`,
    ),
  );
  unknown.unverified("a.f", "impl A::f");
  unknown.unverified("a.f", "impl missing::Tr for missing::Type::f");
  const inherent = await graph(
    lib(
      `struct A;impl A{fn f(&self){}}impl missing::Type{fn f(&self){}}fn r(a:&A){a.f();A::f(&a);}`,
    ),
  );
  inherent.unknown("a.f");
  inherent.unknown("A::f");
  assert.equal(inherent.would("a.f")[0].length, 2);
});

function failedLink(g, name, files, kind = "calls") {
  g.unknown(name, kind);
  for (const l of g.links.filter(
    (l) => l.targetName === name && l.kind === kind,
  )) {
    assert.equal(l.data.uncertainty, "invalid-code", name);
    assert.deepEqual(l.data.cause, { files });
    assert.equal(Object.hasOwn(l.data, "targets"), false);
  }
}
test("file failure: every syntax error discards the entire file, including intact declarations", async () => {
  for (const bad of [
    "pub fn broken(){let x=;}",
    "pub struct Bad{x:u8",
    "impl A{fn f(&self){}",
    'pub fn g(){let s="abc;}impl A{fn f(self){}}fn h(){let t="x";}',
  ]) {
    const r = await rust.parse({
      path: "src/bad.rs",
      text: `pub struct A;pub fn intact(){}${bad}`,
    });
    assert.equal(r.status, "failed");
    assert.deepEqual(r.symbols, []);
    assert.deepEqual(r.links, []);
    assert.equal(r.diagnostics.length, 1);
  }
});
test("file failure: module paths and absent scope names name broken files, never targets", async () => {
  const sources = {
    "src/lib.rs": "mod broken;mod good;fn r(){broken::intact();good::f();}",
    "src/broken.rs": "pub fn intact(){}fn damaged(){let x=;}",
    "src/good.rs": "pub fn f(){}",
  };
  const g = await graph(sources);
  failedLink(g, "broken::intact", ["src/broken.rs"]);
  failedLink(g, "broken", ["src/broken.rs"], "modules");
  g.one("good::f", "f");
  assert.ok(!g.symbols.some((s) => s.file === "src/broken.rs"));
  sources["src/broken.rs"] = "pub fn intact(){}";
  const fixed = await graph(sources);
  fixed.one("broken::intact", "intact");
  assert.ok(!fixed.links.some((l) => l.data?.cause));
  const scope = await graph({
    "src/lib.rs": "fn r(){maybe();absent::f();}",
    "src/bin/other.rs": "fn main(){let x=;}",
  });
  // A separate binary is a separate scope: missing does not mean broken.
  scope.unknown("maybe");
  assert.equal(
    scope.links.find((l) => l.targetName === "maybe").data.uncertainty,
    undefined,
  );
  const root = await graph({
    "src/lib.rs": "fn bad(){let x=;}",
    "src/bin/run.rs": "fn main(){app::missing();}",
  });
  failedLink(root, "app::missing", ["src/lib.rs"]);
});
test("failed dependency reach and valid unresolved impl targets only add uncertainty", async () => {
  const manifests = {
    "Cargo.toml": '[workspace]\nmembers=["x","y","z"]',
    "x/Cargo.toml": '[package]\nedition="2024"\nname="x"',
    "y/Cargo.toml":
      '[package]\nedition="2024"\nname="y"\n[dependencies]\nx={path="../x"}',
    "z/Cargo.toml":
      '[package]\nedition="2024"\nname="z"\n[dependencies]\nx={path="../x"}\ny={path="../y"}',
  };
  const g = await graph(
    {
      "x/src/lib.rs": "pub struct A;impl A{pub fn f(&self){}}",
      "y/src/lib.rs": "pub trait Tr{fn f(self){}}pub struct Broken{",
      "z/src/lib.rs": "use x::A;fn r(a:A){a.f();}fn first(a:&A){a.f();}",
    },
    manifests,
  );
  assert.deepEqual(
    g.targets("a.f").map((t) => t.map((s) => s.identity)),
    [[], ["impl A::f"]],
  );
  const l = g.links.find((l) => l.targetName === "a.f");
  assert.match(l.data.uncertainty, /failed-file-unseen-declarations/);
  assert.equal(l.data.cause, undefined);
  const caller = await graph({
    "src/lib.rs": "mod bad;struct A;impl A{fn f(&self){}}fn r(a:A){a.f();}",
    "src/bad.rs": "fn missing(){",
  });
  assert.match(
    caller.links.find((l) => l.targetName === "a.f").data.uncertainty,
    /failed-file-unseen-declarations/,
  );
});
test("failed explicit import and missing closing brace cannot salvage targets", async () => {
  const g = await graph({
    "src/lib.rs": "mod bad;mod good;fn r(){bad::f();}",
    "src/bad.rs": "pub use crate::good::{f,",
    "src/good.rs": "pub fn f(){}",
  });
  failedLink(g, "bad::f", ["src/bad.rs"]);
  const method = await graph({
    "src/lib.rs": "mod bad;fn r(a:&bad::A){a.f();}",
    "src/bad.rs": "pub struct A;impl A{pub fn f(&self){}",
  });
  method.unknown("a.f");
  assert.ok(!method.symbols.some((s) => s.file === "src/bad.rs"));
  assert.notEqual(
    method.links.find((l) => l.targetName === "a.f").data.uncertainty,
    "invalid-code",
  );
});
test("failed diagnostics give the first grammar error with deterministic location", async () => {
  for (const [text, message, start, end] of [
    [
      "fn good(){}\nfn broken(){let x=;}",
      "line 2, column 18: unexpected `=`",
      29,
      30,
    ],
    ["fn f(){let x=1}", "line 1, column 15: missing `;`", 14, 14],
  ]) {
    const r = await rust.parse({ path: "src/bad.rs", text });
    assert.equal(r.status, "failed");
    assert.deepEqual(r.diagnostics, [{ message, range: { start, end } }]);
  }
});
test("path metadata is parsed structurally, including raw strings, never from doc text", async () => {
  const raw = await graph({
    "src/lib.rs": '#[path=r#"other.rs"#]mod m;fn r(){m::f();}',
    "src/other.rs": "pub fn f(){}",
    "src/m.rs": "pub fn wrong(){}",
  });
  raw.one("m::f", "f");
  assert.equal(
    raw.links.find((l) => l.targetName === "m::f").data.targets,
    undefined,
  );
  const doc = await graph({
    "src/lib.rs": '#[doc=r#"path = "fake.rs""#]mod m;fn r(){m::f();}',
    "src/m.rs": "pub fn f(){}",
    "src/fake.rs": "pub fn wrong(){}",
  });
  doc.one("m::f", "f");
});
test("opaque item generation guards fallback namespace lookup, not explicit intact bindings", async () => {
  for (const source of [
    "m!();",
    "#[proc::make]fn generated(){}",
    "#![proc::make]",
    '#[cfg_attr(feature="x",proc::make)]fn generated(){}',
  ]) {
    const g = await graph(
      lib(
        `mod good{pub fn f(){}}mod user{${source}use crate::good::*;fn run(){f();}}`,
      ),
    );
    g.unknown("f");
    assert.match(
      g.links.find((l) => l.targetName === "f" && l.kind === "calls").data
        .uncertainty,
      /opaque/,
    );
    const direct = await graph(
      lib(
        `mod good{pub fn f(){}}mod user{${source}use crate::good::f;fn run(){f();}}`,
      ),
    );
    if (source.startsWith("#!")) direct.unverified("f", "good::f");
    else direct.one("f", "good::f");
  }
});

test("failed causes are sorted across conditional module destinations and missing is distinct", async () => {
  const g = await graph({
    "src/lib.rs":
      '#[cfg(feature="x")]#[path="z.rs"]mod broken;#[cfg(not(feature="x"))]#[path="a.rs"]mod broken;mod good;fn r(){broken::f();good::absent();}',
    "src/z.rs": "fn bad(){",
    "src/a.rs": "struct Bad{",
    "src/good.rs": "pub fn fine(){}",
  });
  failedLink(g, "broken::f", ["src/a.rs", "src/z.rs"]);
  g.unknown("good::absent");
  assert.notEqual(
    g.links.find((l) => l.targetName === "good::absent").data.uncertainty,
    "invalid-code",
  );
});

test("failed module-link causes sort conditional layouts, independently of declaration order", async () => {
  const g = await graph({
    "src/lib.rs": '#[cfg_attr(feature="x",path="a.rs")]mod z;',
    "src/z.rs": "fn bad(){",
    "src/a.rs": "struct Bad{",
  });
  failedLink(g, "z", ["src/a.rs", "src/z.rs"], "modules");
});

test("opaque body items cannot shadow signature types and never erase outer would-be targets", async () => {
  const g = await graph(
    lib("struct A;fn outer(){}fn run(a:A)->A{opaque!();outer();let x:A=a;x}"),
  );
  const as = g.links.filter((l) => l.kind === "types" && l.targetName === "A");
  const decisions = new Map(g.decisions.map((d) => [d.linkId, d]));
  assert.equal(as.length, 3);
  assert.ok(decisions.get(as[0].id)?.targetId);
  assert.ok(decisions.get(as[1].id)?.targetId);
  assert.equal(decisions.get(as[2].id), undefined);
  assert.equal(as[2].data.targets.length, 1);
  g.unverified("outer", "outer");
});

test("cfg conditions belong to each impl view, not just its shared source symbol", async () => {
  const g = await graph({
    "src/lib.rs":
      'struct A;#[cfg(feature="x")]#[path="shared.rs"]mod a;#[path="shared.rs"]mod b;fn run(a:&A){a.f();}',
    "src/shared.rs": "impl crate::A{pub fn f(&self){}}",
  });
  g.unverified("a.f", "impl crate::A::f");
  assert.equal(g.would("a.f")[0].length, 1);
  assert.match(
    g.links.find((l) => l.targetName === "a.f").data.uncertainty,
    /applicability/,
  );
});

test("two independently proved module views cannot become a closed dot-call set", async () => {
  const g = await graph({
    "src/lib.rs":
      'mod one{pub struct A;impl A{pub fn f(&self){}}}mod two{pub struct B;impl B{pub fn f(&self){}}}mod a{type T=crate::one::A;#[path="../shared.rs"]mod inner;}mod b{type T=crate::two::B;#[path="../shared.rs"]mod inner;}',
    "src/shared.rs": "fn r(t:&super::T){t.f();}",
  });
  g.unknown("t.f");
  assert.deepEqual(
    g
      .would("t.f")[0]
      .map((s) => s.identity)
      .sort(),
    ["one::impl A::f", "two::impl B::f"],
  );
});

test("a failed impl file cannot hide a seen valid first-step inherent member", async () => {
  const g = await graph({
    "src/lib.rs": "struct A;mod bad;mod good;fn run(a:&A){a.f();}",
    "src/bad.rs": "impl crate::A{fn f(&self){let x=;}}",
    "src/good.rs": "impl crate::A{pub fn f(&self){}}",
  });
  g.one("a.f", "impl crate::A::f");
  assert.equal(
    g.links.find((l) => l.targetName === "a.f").data.cause,
    undefined,
  );
  assert.ok(!g.symbols.some((s) => s.file === "src/bad.rs"));
});

test("helper field attributes and associated item generation cannot shadow lexical names", async () => {
  const g = await graph(
    lib(
      "struct A;#[derive(Helper)]struct S{#[helper]a:A}fn outer(){}macro_rules! m{()=>{fn outer(){}}}struct B;impl B{m!();#[helper::attr]fn f(){outer();}}trait T{m!();fn f(){outer();}}",
    ),
  );
  g.one("A", "A", "types");
  g.one("outer", "outer");
  assert.equal(
    g.links.find((l) => l.kind === "types" && l.targetName === "A").data
      .uncertainty,
    undefined,
  );
});

test("macro_use can shadow standard derive spellings and generate lexical items", async () => {
  for (const attr of ["#[macro_use]", '#[cfg_attr(feature="x",macro_use)]']) {
    const g = await graph(
      lib(
        `${attr}extern crate helper;struct Known;impl Known{fn first(&self){}}fn f(){}fn run(k:&Known){#[derive(Debug)]struct A;f();k.first();}`,
      ),
    );
    g.unverified("f", "f");
    g.unverified("k.first", "impl Known::first");
  }
});

test("absolute module paths cannot be guessed from similarly named relative files", async () => {
  const g = await graph({
    "src/lib.rs": '#[path="/else.rs"]mod m;fn r(){m::f();}',
    "src/else.rs": "pub fn f(){}",
  });
  g.unknown("m", "modules");
  g.unknown("m::f");
  assert.equal(g.would("m::f")[0].length, 0);
});

test("cfg_attr loading the same filename retains ordinary and path child directories", async () => {
  const sources = {
    "src/lib.rs":
      '#[cfg_attr(feature="x",path="m.rs")]mod m;fn run(){m::child::f();m::direct();}',
    "src/m.rs": "pub mod child;pub fn direct(){}",
    "src/m/child.rs": "pub fn f(){}",
    "src/child.rs": "pub fn f(){}",
  };
  const g = await graph(sources);
  assert.deepEqual(
    g
      .targets("m::child::f")[0]
      .map((s) => s.file)
      .sort(),
    ["src/child.rs", "src/m/child.rs"],
  );
  g.one("m::direct", "direct");
  delete sources["src/m/child.rs"];
  const missing = await graph(sources);
  missing.unknown("m::child::f");
  assert.deepEqual(
    missing.would("m::child::f")[0].map((s) => s.file),
    ["src/child.rs"],
  );
  missing.one("m::direct", "direct");
});

test("unverified dot targets include project autoderef bodies without implementing dispatch", async () => {
  // rustc runs B::f, via A's Deref implementation; direct-type filtering loses it.
  const g = await graph(
    lib(
      "struct A(B);struct B;impl B{fn f(&self){}}impl std::ops::Deref for A{type Target=B;fn deref(&self)->&B{&self.0}}fn run(a:A){a.f();}",
    ),
  );
  g.unverified("a.f", "impl B::f");
});
test("unplaced valid impls and inherited defaults are not absent", async () => {
  // rustc include! puts extra.rs in the crate: owned a calls Tr::f, &A calls A::f.
  const g = await graph({
    "src/lib.rs":
      'struct A;impl A{fn f(&self){}}trait Tr{fn f(self);}include!("extra.rs");fn run(a:A){a.f();}fn first(a:&A){a.f();}',
    "src/extra.rs": "impl Tr for A{fn f(self){}}",
  });
  assert.deepEqual(
    g.targets("a.f").map((ts) => ts.map((s) => s.identity)),
    [[], ["impl A::f"]],
  );
  assert.ok(
    g
      .would("a.f")[0]
      .some(
        (s) => s.file === "src/extra.rs" && s.identity === "impl Tr for A::f",
      ),
  );
  const defaults = await graph({
    "src/lib.rs":
      'struct A;trait Tr{fn f(){}}include!("extra.rs");fn run(){A::f();}',
    "src/extra.rs": "impl Tr for A{}",
  });
  defaults.unverified("A::f", "Tr::f");
});
test("ambiguous manifest edges cannot accuse an unproven failed dependency crate", async () => {
  const g = await graph(
    {
      "src/lib.rs":
        "struct A;impl A{fn f(&self){}}fn run(a:A){a.f();}fn first(a:&A){a.f();}",
      "one/src/lib.rs": "fn bad(){",
      "two/src/lib.rs": "pub fn ok(){}",
    },
    {
      "Cargo.toml":
        '[package]\nedition="2024"\nname="app"\n[target.\'cfg(unix)\'.dependencies]\nchoice={path="one",package="one"}\n[target.\'cfg(windows)\'.dependencies]\nchoice={path="two",package="two"}',
      "one/Cargo.toml": '[package]\nedition="2024"\nname="one"',
      "two/Cargo.toml": '[package]\nedition="2024"\nname="two"',
    },
  );
  assert.doesNotMatch(
    g.links.find((l) => l.targetName === "a.f").data.uncertainty,
    /failed-file/,
  );
  assert.equal(g.targets("a.f")[1][0].identity, "impl A::f");
});

test("value items and imports cannot leave shadowed parameter receiver evidence", async () => {
  // rustc returns 2: a hoisted local unit struct or import shadows x:&A.
  for (const inner of [
    "struct x;impl x{fn f(self)->u16{2}}",
    "use crate::other::x;",
    "use crate::other::*;",
  ]) {
    const g = await graph(
      lib(
        `struct A;impl A{fn f(&self)->u8{1}}mod other{pub struct x;impl x{pub fn f(self)->u16{2}}}fn run(x:&A)->u16{${inner} x.f()}`,
      ),
    );
    g.unknown("x.f");
  }
  const named = await graph(
    lib("struct A;impl A{fn f(&self){}}fn run(x:&A){struct x{n:u8}x.f();}"),
  );
  named.one("x.f", "impl A::f");
});
test("conditional names cannot silently fall back to a different value", async () => {
  // rustc calls std::mem::drop without feature x, the project fn with it.
  const g = await graph(
    lib('#[cfg(feature="x")]fn drop(_:u8)->u8{1}fn run(){drop(1u8);}'),
  );
  g.unverified("drop", "drop");
  const u = await graph(
    lib(
      'mod m{pub fn drop(_:u8){}}#[cfg(feature="x")]use m::drop;fn run(){drop(1u8);}',
    ),
  );
  u.unverified("drop", "m::drop");
  const twins = await graph(
    lib(
      '#[cfg(feature="x")]fn f(){}#[cfg(not(feature="x"))]fn f(){}fn run(){f();}',
    ),
  );
  assert.equal(twins.targets("f")[0].length, 2);
});
test("conditional alias alternatives are followed in variant paths", async () => {
  // rustc accepts E::V with either feature setting: different enum variants.
  const g = await graph(
    lib(
      '#[cfg(feature="x")]enum E{V}#[cfg(not(feature="x"))]type E=B;enum B{V}fn run(){let _=E::V;}',
    ),
  );
  assert.deepEqual(
    g
      .targets("E::V", "values")[0]
      .map((s) => s.identity)
      .sort(),
    ["B::V", "E::V"],
  );
});
test("crate and dependency module roots are not value bindings", async () => {
  const g = await graph(lib("fn f(){}fn run(){use crate as f;f();}"));
  g.one("f", "f");
});
test("opaque statement generation cannot preserve a shadowed parameter type", async () => {
  // rustc calls generated x::f, not A::f, even with no identifier in m!().
  const g = await graph(
    lib(
      "struct A;impl A{fn f(&self)->u8{1}}macro_rules! m{()=>{struct x;impl x{fn f(self)->u16{2}}}}fn run(x:&A)->u16{m!();x.f()}",
    ),
  );
  g.unknown("x.f");
});

test("conditional explicit names retain same-scope glob fallback targets", async () => {
  // rustc prints 1 without x and 2 with x; neither branch may be omitted.
  const g = await graph(
    lib(
      'mod m{pub fn f()->u8{1}}mod n{pub fn f()->u8{2}}use m::*;#[cfg(feature="x")]use n::f;fn run(){f();}',
    ),
  );
  g.unknown("f");
  assert.deepEqual(
    g
      .would("f")[0]
      .map((s) => s.identity)
      .sort(),
    ["m::f", "n::f"],
  );
});

test("unsupported associated constants cannot disappear beside cfg variants", async () => {
  const g = await graph(
    lib(
      '#[cfg(feature="x")]enum E{V}#[cfg(not(feature="x"))]struct E;#[cfg(not(feature="x"))]impl E{const V:u8=2;}fn run(){let _=E::V;}',
    ),
  );
  g.unknown("E::V", "values");
  assert.deepEqual(
    g
      .would("E::V", "values")[0]
      .map((s) => s.identity)
      .sort(),
    ["E::V", "impl E::V"],
  );
  const ordinary = await graph(
    lib(
      "struct A;impl A{fn f(){}}struct B;impl B{const f:u8=0;}fn run(){A::f();}",
    ),
  );
  ordinary.one("A::f", "impl A::f");
});

test("opaque nested blocks never expose outer functions through local value bindings", async () => {
  // rustc prints 2, using the enclosing local, not the outer function value.
  const g = await graph(
    lib(
      "fn lower_bound()->u8{1}macro_rules! m{()=>{}}fn run(){let mut lower_bound=2;while lower_bound<3{m!();let _=lower_bound;lower_bound+=1;}}",
    ),
  );
  g.unknown("lower_bound", "values");
  for (const targets of g.would("lower_bound", "values"))
    assert.equal(targets.length, 0);
});

test("cfg complement proof preserves string literal contents", async () => {
  // rustc with --cfg x="ab" calls std::mem::drop: both project items absent.
  const g = await graph(
    lib(
      '#[cfg(x="a b")]fn drop(_:u8){}#[cfg(not(x="ab"))]fn drop(_:u8){}fn run(){drop(1u8);}',
    ),
  );
  g.unknown("drop");
  assert.equal(g.would("drop")[0].length, 2);
});

test("inert attributes and unrelated named imports preserve first-probe evidence", async () => {
  // rustc returns 1; none of these declarations can bind x.
  for (const extra of [
    "#[allow(unused)]let _a=0;",
    "#[cfg(any())]let _a=0;",
    "#[cfg_attr(all(),allow(unused))]let _a=0;",
    "use crate::other::Y;",
  ]) {
    const g = await graph(
      lib(
        `struct A;impl A{fn f(&self)->u8{1}}mod other{pub struct Y;}fn run(x:&A)->u8{${extra}x.f()}`,
      ),
    );
    g.one("x.f", "impl A::f");
  }
});

test("conditional let bindings cannot prove one first-step receiver", async () => {
  // rustc prints 1 without feature x, 2 with x.
  const g = await graph(
    lib(
      'struct A;struct B;impl A{fn f(&self)->u8{1}}impl B{fn f(&self)->u8{2}}fn run(x:&A)->u8{#[cfg(feature="x")]let x:&B=&B;x.f()}',
    ),
  );
  g.unknown("x.f");
  assert.deepEqual(
    g
      .would("x.f")[0]
      .map((s) => s.identity)
      .sort(),
    ["impl A::f", "impl B::f"],
  );
});

test("overflow: retain at most sixteen hints, otherwise count with no truncated list", async () => {
  // Developer rustc control prints 0 (A0::f); metadata policy is tested here without rustc.
  for (const n of [1, 16, 17]) {
    const declarations = Array.from(
      { length: n },
      (_, i) => `struct A${i};impl A${i}{fn f(&self){}}`,
    ).join("");
    const g = await graph(
      lib(declarations + "fn run(a:A0){a.f();}fn first(p:&A0){p.f();}"),
    );
    g.unknown("a.f");
    g.one("p.f", "impl A0::f");
    const d = g.links.find((l) => l.targetName === "a.f").data;
    if (n > 16) {
      assert.equal(d.targetCount, n);
      assert.equal(Object.hasOwn(d, "targets"), false);
      assert.match(d.uncertainty, /too-many-targets/);
    } else {
      assert.equal(d.targets.length, n);
      assert.equal(Object.hasOwn(d, "targetCount"), false);
      assert.equal(d.uncertainty.includes("too-many-targets"), false);
    }
    if (n === 1) {
      const f = g.files[0];
      f.result.links.find((l) => l.targetName === "a.f").data.targetCount = 99;
      const again = await rust.analyze({
        projectId: "review",
        files: g.files,
        contextFiles: g.contextFiles,
        changedFiles: [],
        changedContextFiles: [],
      });
      const clean = again[0].result.links.find(
        (l) => l.targetName === "a.f",
      ).data;
      assert.equal(clean.targets.length, 1);
      assert.equal(Object.hasOwn(clean, "targetCount"), false);
    }
  }
});
