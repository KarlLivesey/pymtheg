// SPDX-License-Identifier: MIT
// C-15: a Rust file that cannot be read withholds only the links whose answer
// its content could change. Each case pairs a link the failed file could
// change (withheld, with the failed-file reason) with a twin it cannot
// change (resolved, or unresolved for its own visible reason only).
// A failed file here is one the parser rejects; `fn broken( {` is never Rust.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import rust from "../dist/graph/languages/rust/index.js";

const BROKEN = "pub fn broken( {\n";
const FAILED = "failed-file-unseen-declarations";
const crate = (name, deps = "") =>
  `[package]\nname="${name}"\nedition="2024"\nversion="0.1.0"\n${deps}`;

async function index(files) {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-c15-"));
  const store = new SqliteGraphStore(":memory:", "c15");
  try {
    for (const [path, text] of Object.entries({
      "Cargo.toml": crate("app"),
      ...files,
    })) {
      await mkdir(dirname(join(scratch, path)), { recursive: true });
      await writeFile(join(scratch, path), text);
    }
    const report = await indexProject(
      scratch,
      new LanguageRegistry([rust]),
      store,
    );
    const symbols = new Map(store.findSymbols().map((s) => [s.id, s]));
    const links = store.links();
    return { failed: report.failed, links, symbols };
  } finally {
    store.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

/** The single link named `name` of `kind` in `file`, as a plain answer. */
function answer(g, file, name, kind = "calls") {
  const ls = g.links.filter(
    (l) => l.file === file && l.kind === kind && l.targetName === name,
  );
  assert.equal(ls.length, 1, `${file} ${kind} ${name}`);
  const l = ls[0];
  const target = l.targetId ? g.symbols.get(l.targetId) : undefined;
  const reasons = (l.data.uncertainty ?? "").split(/;\s*/).filter(Boolean);
  return {
    resolution: l.resolution,
    target: target ? `${target.file}#${target.identity}` : null,
    failed: reasons.includes(FAILED) || reasons.includes("invalid-code"),
    reasons,
  };
}
const definite = (target) => ({ resolution: "resolved", target });

test("names the failed file declares in its module, inline child modules and `mod` declarations", async () => {
  const g = await index({
    "src/lib.rs": [
      "mod bad; mod good;",
      "fn r() { bad::f(); bad::inner::g(); bad::child::h(); good::f(); good::inner::g(); good::child::h(); }",
    ].join("\n"),
    "src/bad.rs": "pub fn f() {}\npub mod inner { pub fn g() {} }\n" + BROKEN,
    "src/bad/child.rs": "pub fn h() {}",
    "src/good.rs":
      "pub fn f() {}\npub mod inner { pub fn g() {} }\npub mod child;",
    "src/good/child.rs": "pub fn h() {}",
  });
  assert.deepEqual(g.failed, ["src/bad.rs"]);
  for (const name of ["bad::f", "bad::inner::g", "bad::child::h"]) {
    const a = answer(g, "src/lib.rs", name);
    assert.equal(a.resolution, "unresolved", name);
    assert.equal(a.failed, true, name);
  }
  const { resolution, target } = answer(g, "src/lib.rs", "good::f");
  assert.deepEqual({ resolution, target }, definite("src/good.rs#f"));
  assert.equal(
    answer(g, "src/lib.rs", "good::inner::g").target,
    "src/good.rs#inner::g",
  );
  assert.equal(
    answer(g, "src/lib.rs", "good::child::h").target,
    "src/good/child.rs#h",
  );
});

test("the readable lines before a parse error are not read: the whole file fails", async () => {
  const g = await index({
    "src/lib.rs": "mod bad;\nfn r() { bad::early(); }",
    "src/bad.rs": "pub fn early() {}\n" + BROKEN,
  });
  const a = answer(g, "src/lib.rs", "bad::early");
  assert.equal(a.resolution, "unresolved");
  assert.deepEqual(a.reasons, ["invalid-code"]);
});

test("a file below a failed module file has no known module path", async () => {
  const g = await index({
    "src/lib.rs": "mod bad; mod good;",
    "src/bad.rs": "mod child;\npub fn f() {}\n" + BROKEN,
    "src/bad/child.rs": "fn r() { super::f(); }",
    "src/good.rs": "mod child;\npub fn f() {}",
    "src/good/child.rs": "fn r() { super::f(); }",
  });
  assert.equal(
    answer(g, "src/bad/child.rs", "super::f").resolution,
    "unresolved",
  );
  const { resolution, target } = answer(g, "src/good/child.rs", "super::f");
  assert.deepEqual({ resolution, target }, definite("src/good.rs#f"));
});

test("glob imports and re-exports through the failed file", async () => {
  const g = await index({
    "src/lib.rs": "mod bad; mod good; mod m; mod n; mod user;",
    "src/bad.rs": "pub fn h() {}\npub struct Thing;\n" + BROKEN,
    "src/good.rs": "pub fn h() {}\npub struct Thing;",
    // A glob of the failed module could supply `h`; a local item shadows any
    // glob, so `k` is proved even beside the same glob.
    "src/m.rs": "use crate::bad::*;\nfn k() {}\nfn r() { h(); k(); }",
    "src/n.rs":
      "pub use crate::bad::Thing;\npub use crate::good::Thing as Other;",
    "src/user.rs": "use crate::n::{Thing, Other};\nfn r(_: Thing, _: Other) {}",
  });
  const h = answer(g, "src/m.rs", "h");
  assert.equal(h.resolution, "unresolved");
  assert.equal(h.failed, true);
  const k = answer(g, "src/m.rs", "k");
  assert.deepEqual(
    { resolution: k.resolution, target: k.target },
    definite("src/m.rs#k"),
  );
  const thing = answer(g, "src/user.rs", "Thing", "types");
  assert.equal(thing.resolution, "unresolved");
  assert.equal(thing.failed, true);
  const other = answer(g, "src/user.rs", "Other", "types");
  assert.deepEqual(
    { resolution: other.resolution, target: other.target },
    definite("src/good.rs#Thing"),
  );
});

test("an unseen impl cannot change an explicit path to a free function, type, const or module", async () => {
  const g = await index({
    "src/lib.rs": [
      "mod bad; mod good;",
      "fn r() -> good::T { good::make(); let _ = good::LIMIT; good::T }",
    ].join("\n"),
    // The failed file may hold impls for any type of the crate.
    "src/bad.rs": "impl crate::good::T { pub fn make() {} }\n" + BROKEN,
    "src/good.rs": "pub struct T;\npub fn make() {}\npub const LIMIT: u8 = 1;",
  });
  for (const [name, kind, target] of [
    ["good::make", "calls", "src/good.rs#make"],
    ["good::LIMIT", "values", "src/good.rs#LIMIT"],
    ["good::T", "types", "src/good.rs#T"],
  ]) {
    const a = answer(g, "src/lib.rs", name, kind);
    assert.deepEqual(
      { resolution: a.resolution, target: a.target },
      definite(target),
      name,
    );
  }
});

test("method calls: the autoref step needs every crate in reach readable; the first step does not", async () => {
  const files = (broken) => ({
    "Cargo.toml":
      '[workspace]\nmembers=["a","b"]\n[workspace.package]\nedition="2024"\n',
    "a/Cargo.toml": crate("a", '[dependencies]\nb={path="../b"}\n'),
    "b/Cargo.toml": crate("b"),
    "c/Cargo.toml": crate("c"),
    "a/src/lib.rs": [
      broken === "a" ? "mod bad;" : "",
      "pub struct S;",
      "impl S { pub fn m(&self) {} }",
      // `s` is owned: `m` is found at the autoref step, after every by-value
      // trait method an unseen impl could add. `t` is a reference: first step.
      "fn r(s: S, t: &S) { s.m(); t.m(); }",
    ].join("\n"),
    ...(broken === "a" ? { "a/src/bad.rs": BROKEN } : {}),
    "b/src/lib.rs": broken === "b" ? BROKEN : "pub fn ok() {}",
    "c/src/lib.rs": broken === "c" ? BROKEN : "pub fn ok() {}",
  });
  const call = (g, receiver) =>
    g.links.find(
      (l) =>
        l.file === "a/src/lib.rs" &&
        l.kind === "calls" &&
        l.data.method === "m" &&
        l.targetName.startsWith(receiver),
    );
  // A failed file in the caller's crate or in a dependency: autoref withheld.
  for (const broken of ["a", "b"]) {
    const g = await index(files(broken));
    const s = call(g, "s");
    assert.equal(s.resolution, "unresolved", broken);
    assert.ok(s.data.uncertainty.split("; ").includes(FAILED), broken);
    const t = call(g, "t");
    assert.equal(t.resolution, "resolved", broken);
    assert.equal(g.symbols.get(t.targetId).identity, "impl S::m");
  }
  // A failed file in a crate the caller does not depend on: both resolve.
  const g = await index(files("c"));
  assert.deepEqual(g.failed, ["c/src/lib.rs"]);
  for (const receiver of ["s", "t"]) {
    const l = call(g, receiver);
    assert.equal(l.resolution, "resolved", receiver);
    assert.equal(g.symbols.get(l.targetId).identity, "impl S::m");
  }
});

test("an unseen inherent impl must be in the type's crate to explain a miss", async () => {
  const workspace = {
    "Cargo.toml":
      '[workspace]\nmembers=["a","b"]\n[workspace.package]\nedition="2024"\n',
    "a/Cargo.toml": crate("a", '[dependencies]\nb={path="../b"}\n'),
    "b/Cargo.toml": crate("b"),
  };
  // `A::from` is a trait associated function: never definite here. Only an
  // inherent `from` could make it one, and only A's own crate can declare it.
  const own = await index({
    ...workspace,
    "a/src/lib.rs": "mod bad;\npub struct A;\nfn f(a: A) { A::from(a); }",
    "a/src/bad.rs": BROKEN,
    "b/src/lib.rs": "pub fn ok() {}",
  });
  const mine = answer(own, "a/src/lib.rs", "A::from");
  assert.equal(mine.resolution, "unresolved");
  assert.ok(mine.reasons.includes(FAILED));
  const dependency = await index({
    ...workspace,
    "a/src/lib.rs": "pub struct A;\nfn f(a: A) { A::from(a); }",
    "b/src/lib.rs": BROKEN,
  });
  const theirs = answer(dependency, "a/src/lib.rs", "A::from");
  assert.equal(theirs.resolution, "unresolved");
  assert.deepEqual(theirs.reasons, ["trait-dispatch"]);
});

test("receivers: a type declared in the failed file withholds; a closure parameter is its own reason", async () => {
  // From alacritty (display/mod.rs:1441): `self.window` has a type declared
  // in a file the parser rejected (display/window.rs:136, attributes on a
  // parameter), so the chain on it is withheld. The same chain through a
  // readable type resolves. C-21's grammar reads those attributes, so the
  // file is kept unreadable with an empty turbofish (`gap::<>()`), a shape
  // that stays a grammar gap.
  const g = await index({
    "src/lib.rs": "mod display;",
    "src/display/mod.rs": [
      "mod window; mod size;",
      "use window::Window; use size::Size;",
      "struct Display { window: Window, size: Size }",
      "impl Display {",
      "  fn frame(&mut self) { self.window.current_monitor(); self.size.width(); }",
      "  fn each(&self, items: &[Size]) { items.iter().for_each(|x| x.height()); }",
      "}",
    ].join("\n"),
    "src/display/window.rs": [
      "pub struct Window;",
      "impl Window {",
      "  pub fn new(",
      "    title: &str,",
      "    #[rustfmt::skip]",
      '    #[cfg(all(feature = "x11", not(any(target_os = "macos", windows))))]',
      "    x11_visual: Option<u32>,",
      "  ) -> Window { Window }",
      "  pub fn current_monitor(&self) {}",
      "}",
      "fn gap() -> u8 { 1 }",
      "fn use_gap() -> u8 { gap::<>() }",
    ].join("\n"),
    "src/display/size.rs": [
      "#[derive(Clone, Copy)]",
      "pub struct Size;",
      "impl Size { pub fn width(self) -> f32 { 0.0 } pub fn height(&self) -> f32 { 0.0 } }",
    ].join("\n"),
  });
  assert.deepEqual(g.failed, ["src/display/window.rs"]);
  const monitor = g.links.find((l) => l.data.method === "current_monitor");
  assert.equal(monitor.resolution, "unresolved");
  assert.ok(monitor.data.uncertainty.split("; ").includes("invalid-code"));
  const width = g.links.find((l) => l.data.method === "width");
  assert.equal(width.resolution, "resolved");
  assert.equal(g.symbols.get(width.targetId).identity, "impl Size::width");
  // The closure parameter's type is not read from source at all; reading
  // window.rs could not type it, so the failure is not named.
  const height = g.links.find((l) => l.data.method === "height");
  assert.equal(height.resolution, "unresolved");
  assert.equal(height.data.uncertainty.includes(FAILED), false);
});

test("textual macro scope: a module declared after the failed one could see its macros", async () => {
  // A failed file's own `#![macro_use]` or `macro_rules!` cannot be ruled
  // out, so a later sibling's `vec!` could be its macro; an earlier one's
  // cannot. Macro links keep main's wider failed-file label (C-12 owns them).
  const g = await index({
    "src/lib.rs": "mod early;\nmod bad;\nmod late;",
    "src/early.rs": "fn r() -> Vec<u8> { vec![] }",
    "src/bad.rs": BROKEN,
    "src/late.rs": "fn r() -> Vec<u8> { vec![] }",
  });
  const late = answer(g, "src/late.rs", "vec", "macros");
  assert.equal(late.resolution, "unresolved");
  assert.ok(late.reasons.includes(FAILED));
  const early = answer(g, "src/early.rs", "vec", "macros");
  assert.equal(early.resolution, "library");
});

test("a macro exported by name from a readable file is definite beside a failed file", async () => {
  // Two `#[macro_export]` macros of one name in a crate do not compile, so a
  // failed file cannot hold a competitor for a visible exported macro.
  const g = await index({
    "src/lib.rs":
      "mod bad;\nmod good;\nfn r() { crate::shown!(); crate::hidden!(); }",
    "src/bad.rs": "#[macro_export] macro_rules! hidden { () => {} }\n" + BROKEN,
    "src/good.rs": "#[macro_export] macro_rules! shown { () => {} }",
  });
  const shown = answer(g, "src/lib.rs", "crate::shown", "macros");
  assert.deepEqual(
    { resolution: shown.resolution, target: shown.target },
    definite("src/good.rs#shown"),
  );
  const hidden = answer(g, "src/lib.rs", "crate::hidden", "macros");
  assert.equal(hidden.resolution, "unresolved");
  assert.ok(hidden.failed);
});

test("a parameter is a binding unless a constant of its name could be in scope", async () => {
  // `fn r(config: u8)` reads `config` as a path pattern when a constant or
  // unit struct `config` is in scope. A glob of the failed module could
  // supply one; a readable glob cannot; an outside import could, whatever
  // the failed file holds (from alacritty display/mod.rs:784, where the
  // binding was unproved for its own reason but named the failed file).
  const binding = "fn r(config: u8) -> u8 { config }";
  const g = await index({
    "Cargo.toml": crate("app", '[dependencies]\nelsewhere = "1"\n'),
    "src/lib.rs": "mod bad; mod good; mod a; mod b; mod c;",
    "src/bad.rs": BROKEN,
    "src/good.rs": "pub fn other() {}",
    "src/a.rs": "use crate::bad::*;\n" + binding,
    "src/b.rs": "use crate::good::*;\n" + binding,
    "src/c.rs": "use elsewhere::config;\n" + binding,
  });
  const use = (file) => answer(g, file, "config", "values");
  assert.equal(use("src/a.rs").resolution, "unresolved");
  assert.ok(use("src/a.rs").reasons.includes(FAILED));
  assert.deepEqual(
    { resolution: use("src/b.rs").resolution, target: use("src/b.rs").target },
    definite("src/b.rs#r"),
  );
  assert.equal(use("src/c.rs").resolution, "unresolved");
  assert.equal(use("src/c.rs").failed, false);
});

test("an associated call whose only readable impl is cfg-gated keeps the failed file as a reason", async () => {
  // `S::new` exists here only under `cfg(unix)`; the failed file could hold
  // the impl for every other configuration. The twin has two readable
  // impls for different instantiations: a visible doubt no file can settle.
  const g = await index({
    "src/lib.rs": "mod bad; mod gated; mod split;",
    "src/bad.rs": BROKEN,
    "src/gated.rs": [
      "pub struct S;",
      "#[cfg(unix)]",
      "impl S { pub fn new() -> S { S } }",
      "fn r() { S::new(); }",
    ].join("\n"),
    "src/split.rs": [
      "pub struct P<T>(T);",
      "impl P<u8> { pub fn new() -> Self { P(0) } }",
      "impl P<u16> { pub fn new() -> Self { P(0) } }",
      "fn r() { P::new(); }",
    ].join("\n"),
  });
  const gated = answer(g, "src/gated.rs", "S::new");
  assert.equal(gated.resolution, "unresolved");
  assert.ok(gated.reasons.includes(FAILED));
  const split = answer(g, "src/split.rs", "P::new");
  assert.equal(split.resolution, "unresolved");
  assert.equal(split.failed, false);
});

test("a receiver produced by a macro keeps the failed file as a reason", async () => {
  // From rustls (server/tls12.rs:992): `finished` comes from
  // `require_handshake_msg!(…)`, and a failed module declared earlier could
  // define that macro (`#![macro_use]`). A literal receiver cannot change.
  const g = await index({
    "src/lib.rs": "mod bad;\nmod user;",
    "src/bad.rs": BROKEN,
    "src/user.rs": [
      "fn r() -> usize { let finished = make_message!(); finished.len() }",
      'fn s() -> usize { "ab".len() }',
    ].join("\n"),
  });
  const [macro, literal] = g.links
    .filter((l) => l.kind === "calls" && l.data.method === "len")
    .sort((a, b) => a.range.start - b.range.start);
  assert.equal(macro.resolution, "unresolved");
  assert.ok(macro.data.uncertainty.split("; ").includes(FAILED));
  assert.equal(literal.resolution, "unresolved");
  assert.equal(literal.data.uncertainty.includes(FAILED), false);
});
