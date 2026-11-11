import assert from "node:assert/strict";
import { test } from "node:test";
import { fileFacts, contentHash, validateResult } from "../dist/graph/index.js";
import rust from "../dist/graph/languages/rust/index.js";

async function graph(
  sources,
  manifests = { "Cargo.toml": '[package]\nname="rules"\n' },
) {
  const files = [];
  for (const [path, text] of Object.entries(sources)) {
    const result = await rust.parse({ path, text });
    validateResult(text, result);
    files.push({
      path,
      text,
      result,
      module: "rust",
      version: rust.version,
      hash: contentHash(text),
    });
  }
  const facts = files.map((file) => fileFacts("rust-rules", file));
  const symbols = facts.flatMap((f) => f.symbols);
  const links = facts.flatMap((f) => f.links);
  const decisions = await rust.resolve({
    projectId: "rust-rules",
    files,
    symbols,
    links,
    contextFiles: Object.entries(manifests).map(([path, text]) => ({
      path,
      text,
      hash: contentHash(text),
      status: "clean",
      diagnostics: [],
    })),
  });
  const byId = new Map(symbols.map((s) => [s.id, s]));
  const resolutions = new Map(decisions.map((d) => [d.linkId, d]));
  function target(name, kind = "calls") {
    const ls = links.filter((l) => l.targetName === name && l.kind === kind);
    assert.equal(ls.length, 1, `${kind} ${name}`);
    const d = resolutions.get(ls[0].id);
    return d?.targetId
      ? byId.get(d.targetId).identity
      : d?.candidateIds
        ? d.candidateIds.map((id) => byId.get(id).identity).sort()
        : null;
  }
  return { files, symbols, links, target, decisions, byId };
}

test("Rust nested groups, self imports, module aliases and reexports retain local scope", async () => {
  const g = await graph({
    "src/lib.rs": `mod a { pub mod b { pub fn f() {} } pub fn no_import() {} }
use crate::a::{self as api, b::{self, f as renamed}};
fn run(){ api::no_import(); b::f(); renamed(); no_import(); }
mod reexport { pub use crate::a::b::f as exported; }
fn other(){ reexport::exported(); }
`,
  });
  assert.equal(g.target("api::no_import"), "a::no_import");
  assert.equal(g.target("b::f"), "a::b::f");
  assert.equal(g.target("renamed"), "a::b::f");
  assert.equal(g.target("no_import"), null);
  assert.equal(g.target("reexport::exported"), "a::b::f");
});

test("Rust impls of distinct types and traits never conflate their members", async () => {
  const g = await graph({
    "src/lib.rs": `struct A; struct B; trait Speak { fn f(&self) {} }
impl A { fn new() -> Self { A } fn method(&self) {} }
impl B { fn new() -> Self { B } }
impl Speak for A { fn f(&self) {} }
impl Speak for B { fn f(&self) {} }
fn run(a: A, b: B, t: &dyn Speak) { A::new(); B::new(); A::missing(); a.method(); b.method(); t.f(); a.new(); }
`,
  });
  assert.equal(g.target("A::new"), "impl A::new");
  assert.equal(g.target("B::new"), "impl B::new");
  assert.equal(g.target("a.method"), "impl A::method");
  assert.equal(g.target("b.method"), null);
  assert.equal(g.target("t.f"), null);
  assert.equal(g.target("A::missing"), null);
  assert.equal(g.target("a.new"), null);
  assert.deepEqual(
    g.symbols
      .filter((s) => s.name === "f")
      .map((s) => s.identity)
      .sort(),
    ["Speak::f", "impl Speak for A::f", "impl Speak for B::f"],
  );
});

test("Rust macro calls use textual project definitions; token trees are opaque", async () => {
  const g = await graph({
    "src/lib.rs": `fn before() { m!(); }
macro_rules! m { () => { fn generated() {} } }
fn after() { m!(); missing!(); generated(); }
mod inner { macro_rules! local { () => {} } fn run() { local!(); } }
fn outside() { local!(); }
`,
  });
  const invocations = g.links.filter(
    (l) => l.kind === "macros" && l.targetName === "m",
  );
  assert.equal(invocations.length, 2);
  const decision = (id) => g.decisions.find((d) => d.linkId === id);
  assert.equal(decision(invocations[0].id), undefined);
  assert.equal(g.byId.get(decision(invocations[1].id).targetId).identity, "m");
  assert.equal(g.target("missing", "macros"), null);
  assert.equal(g.target("generated"), null);
  assert.equal(
    g.symbols.some((s) => s.name === "generated"),
    false,
  );
  const local = g.links.filter(
    (l) => l.targetName === "local" && l.kind === "macros",
  );
  assert.equal(local.length, 2);
  assert.equal(
    g.byId.get(decision(local[0].id).targetId).identity,
    "inner::local",
  );
  assert.equal(decision(local[1].id), undefined);
});

test("Rust #[path] modules do not claim a similarly named adjacent file", async () => {
  const g = await graph({
    "src/lib.rs":
      '#[path="actual.rs"] mod named; fn run(){named::f(); wrong::f();}',
    "src/actual.rs": "pub fn f() {}",
    "src/named.rs": "pub fn wrong() {}",
    "src/wrong.rs": "pub fn f() {}",
  });
  assert.equal(g.target("named::f"), "f");
  assert.equal(g.target("wrong::f"), null);
  assert.equal(g.target("named", "modules"), "$crate");
});

test("Rust no-toolchain grammar reports partial syntax and retains private constants/types/variants", async () => {
  const g = await graph({
    "src/lib.rs":
      "// 😀\nstruct S; enum E { A, B(S) } type Alias = S; const C: usize = 1; static V: bool = false; fn f() {}\nfn broken( {",
  });
  assert.equal(g.files[0].result.status, "partial");
  assert.ok(g.files[0].result.diagnostics.length);
  for (const [name, kind] of [
    ["S", "struct"],
    ["E", "enum"],
    ["A", "variant"],
    ["B", "variant"],
    ["Alias", "type"],
    ["C", "const"],
    ["V", "static"],
    ["f", "function"],
  ]) {
    const s = g.symbols.find((s) => s.name === name && s.kind === kind);
    assert.ok(s, name);
    assert.equal(
      s.data.visibility,
      kind === "variant" ? "inherited" : "private",
    );
  }
});

test("Rust multiple opaque globs terminate structurally without inventing paths", async () => {
  const g = await graph({
    "src/lib.rs": `use external::prelude::*; use another::prelude::*;
  fn run() { absent(); external::missing(); }`,
  });
  assert.equal(g.target("absent"), null);
  assert.equal(g.target("external::missing"), null);
});

test("Rust blanket generic impl does not attach a method to a same-named concrete type", async () => {
  const g = await graph({
    "src/lib.rs": `struct T; trait Speak { fn f(&self); }
  impl<T> Speak for T { fn f(&self) {} }
  fn run(x: T) { x.f(); }`,
  });
  assert.equal(g.target("x.f"), null);
});

test("Rust bare calls inside impls see free functions, never impl members", async () => {
  const g = await graph({
    "src/lib.rs": `struct A;
  fn same() {} use std::mem::size_of;
  impl A { fn same() { same(); } fn size_of(&self) { size_of::<Self>(); Self::same(); } }
  `,
  });
  assert.equal(g.target("same"), "same");
  assert.equal(g.target("size_of"), null);
  assert.equal(g.target("Self::same"), "impl A::same");
});

test("Rust trait associated types are not bare lexical type bindings", async () => {
  const g = await graph({
    "src/lib.rs": `struct T;
  trait Has { type T; fn f(x: T) {} }
  `,
  });
  assert.equal(g.target("T", "types"), "T");
});

test("Rust platform-dependent aliases never pick the last manifest branch", async () => {
  const g = await graph(
    {
      "src/lib.rs": "fn f(){ choice::f(); }",
      "one/src/lib.rs": "pub fn f() {}",
      "two/src/lib.rs": "pub fn f() {}",
    },
    {
      "Cargo.toml": `[package]\nname="app"\n[target.'cfg(unix)'.dependencies]\nchoice={ path="one" }\n[target.'cfg(windows)'.dependencies]\nchoice={ path="two" }\n`,
      "one/Cargo.toml": '[package]\nname="one"\n',
      "two/Cargo.toml": '[package]\nname="two"\n',
    },
  );
  assert.equal(g.target("choice::f"), null);
});

test("Rust parameter receiver types keep their annotation scope under local type shadowing", async () => {
  const g = await graph({
    "src/lib.rs": `struct A; impl A { fn f(&self) {} }
  fn run(x: A) { struct A; impl A { fn f(&self) {} } x.f(); }
  `,
  });
  assert.equal(g.target("x.f"), "impl A::f");
});
