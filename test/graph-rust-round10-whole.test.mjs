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
function noCause(g, name, kind = "calls") {
  const links = g.links.filter((l) => l.targetName === name && l.kind === kind);
  assert.ok(links.length, `${kind} ${name}`);
  for (const l of links) {
    assert.equal(l.data?.cause, undefined, name);
    assert.notEqual(l.data?.uncertainty, "invalid-code", name);
  }
}
const pkg = (name, edition = "2024") =>
  `[package]\nname="${name}"\nversion="0.1.0"\n${edition === null ? "" : `edition="${edition}"\n`}`;
for (const edition of ["2015", "2018", "2021", "2024", null])
  test(`round 10 W1 edition ${edition ?? "default"} import root`, async () => {
    // rustc 2015/default prints 2 (a::f); modern editions print 1 (b::a::f).
    const legacy = edition === null || edition === "2015";
    const g = await graph(
      lib(
        `mod a{pub fn f()->u16{2}}mod b{mod a{pub fn f()->u8{1}}use a::f;pub fn run()->u16{let r:${legacy ? "u16" : "u8"}=f();r as u16}}`,
      ),
      { "Cargo.toml": pkg("app", edition) },
    );
    g.one("f", legacy ? "a::f" : "b::a::f");
    g.one("a::f", legacy ? "a::f" : "b::a::f", "imports");
  });
for (const edition of ["2015", "2024"])
  test(`round 10 W1 inherited edition ${edition}`, async () => {
    // Cargo applies the inherited edition; outputs are the same as the direct manifest controls.
    const g = await graph(
      {
        "app/src/lib.rs":
          "mod a{pub fn f()->u16{2}}mod b{mod a{pub fn f()->u8{1}}use a::f;pub fn run()->u16{f() as u16}}",
      },
      {
        "Cargo.toml": `[workspace]\nmembers=["app"]\n[workspace.package]\nedition="${edition}"\n`,
        "app/Cargo.toml": '[package]\nname="app"\nedition.workspace=true\n',
      },
    );
    g.one("f", edition === "2015" ? "a::f" : "b::a::f");
  });
test("round 10 W1 target edition overrides package edition", async () => {
  // Cargo lib edition=2024 overrides package edition=2015; nested b::a wins (1).
  const g = await graph(
    lib(
      "mod a{pub fn f()->u16{2}}mod b{mod a{pub fn f()->u8{1}}use a::f;pub fn run()->u16{f() as u16}}",
    ),
    { "Cargo.toml": pkg("app", "2015") + '[lib]\nedition="2024"\n' },
  );
  g.one("f", "b::a::f");
});
test("round 10 W1 unknown edition retains both possible import targets", async () => {
  // The same source compiles under both editions, with different callees (2/1).
  const g = await graph(
    lib(
      "mod a{pub fn f()->u16{2}}mod b{mod a{pub fn f()->u8{1}}use a::f;pub fn run()->u16{f() as u16}}",
    ),
    { "Cargo.toml": '[package]\nname="app"\nedition.workspace=true\n' },
  );
  g.unverified("f", "a::f");
  g.unverified("f", "b::a::f");
});
for (const edition of ["2015", "2024"])
  test(`round 10 W1 extern crate versus nested module ${edition}`, async () => {
    // Cargo: 2015 use starts at root extern crate dep (2), modern at b::dep (1).
    const g = await graph(
      {
        "app/src/lib.rs":
          "extern crate dep;mod b{mod dep{pub fn f()->u8{1}}use dep::f;pub fn run()->u16{f() as u16}}",
        "dep/src/lib.rs": "pub fn f()->u16{2}",
      },
      {
        "Cargo.toml": '[workspace]\nmembers=["app","dep"]\n',
        "app/Cargo.toml":
          pkg("app", edition) + '[dependencies]\ndep={path="../dep"}\n',
        "dep/Cargo.toml": pkg("dep"),
      },
    );
    g.one("f", edition === "2015" ? "f" : "b::dep::f");
  });
test("round 10 W1 2015 absolute paths name crate-root items; non-use paths stay lexical", async () => {
  // rustc 2015 prints 2 1: ::a::f is rooted; b's a::f is lexical.
  const g = await graph(
    lib(
      "mod a{pub fn f()->u16{2}}mod b{mod a{pub fn f()->u8{1}}pub fn run(){let _:u16=::a::f();let _:u8=a::f();}}",
    ),
    { "Cargo.toml": pkg("app", "2015") },
  );
  g.one("::a::f", "a::f");
  g.one("a::f", "b::a::f");
});
async function dependencyGraph(section, source, options = {}) {
  return graph(
    {
      "app/src/lib.rs": source,
      ...options.sources,
      "dep/src/lib.rs":
        options.dep ??
        "pub mod mem{pub fn size_of<T>()->u8{1}}pub struct Thing;pub fn f()->u8{3}",
    },
    {
      "Cargo.toml": '[workspace]\nmembers=["app","dep"]\n',
      "app/Cargo.toml": pkg("app") + section,
      "dep/Cargo.toml": pkg("dep"),
      ...options.manifests,
    },
  );
}
for (const [label, cfg, definite] of [
  ["true", "all()", true],
  ["false", "any()", false],
  ["unknown", 'target_os="linux"', false],
])
  test(`round 10 W2 target dependency ${label}`, async () => {
    // Cargo target all() uses dep::f (3); any() does not supply dep. Target OS is unproved in captured source.
    const g = await dependencyGraph(
      `[target.'cfg(${cfg})'.dependencies]\ndep={path="../dep"}\n`,
      "pub fn run()->u8{dep::f()}",
    );
    if (definite) g.one("dep::f", "f");
    else g.unverified("dep::f", "f");
  });
test("round 10 W2 disabled std dependency cannot replace sysroot", async () => {
  // Reviewer's cargo control: size_of::<u16>() returns usize 2 from real std, not fake u8 1.
  const g = await dependencyGraph(
    '[target.\'cfg(any())\'.dependencies]\nstd={package="dep",path="../dep"}\n',
    "pub fn run()->usize{let r:usize=std::mem::size_of::<u16>();r}",
  );
  g.unverified("std::mem::size_of", "mem::size_of");
  noCause(g, "std::mem::size_of");
});
test("round 10 W2 disabled String dependency cannot replace prelude type", async () => {
  // Cargo uses prelude String; a disabled extern-prelude crate cannot bind the annotation.
  const g = await dependencyGraph(
    '[target.\'cfg(any())\'.dependencies]\nString={package="dep",path="../dep"}\n',
    "pub fn run(_:String){}",
  );
  g.unknown("String", "types");
});
for (const gated of [false, true])
  test(`round 10 W2 optional dependency site gate ${gated}`, async () => {
    // Cargo --features dep enables the implicit dep feature; only a matching site cfg proves that edge.
    const g = await dependencyGraph(
      '[dependencies]\ndep={path="../dep",optional=true}\n',
      `${gated ? '#[cfg(feature="dep")]' : ""}pub fn run()->u8{dep::f()}`,
    );
    if (gated) g.one("dep::f", "f");
    else g.unverified("dep::f", "f");
  });
test("round 10 W2 optional dependency custom activation is captured without feature solving", async () => {
  // Cargo --features enabled activates dep:dep directly; the unrelated feature does not.
  const g = await dependencyGraph(
    '[dependencies]\ndep={path="../dep",optional=true}\n[features]\nenabled=["dep:dep"]\nunrelated=[]\n',
    '#[cfg(feature="enabled")]pub fn run()->u8{dep::f()}',
  );
  g.one("dep::f", "f");
});
for (const target of ["src", "tests", "build"])
  test(`round 10 W2 dependency kind ${target}`, async () => {
    // Cargo exposes dev deps to integration tests, build deps only to build.rs; neither is unconditional in src/lib.rs.
    const build = target === "build";
    const source = "fn run()->u8{dep::f()}";
    const g = await dependencyGraph(
      `${build ? "[build-dependencies]" : "[dev-dependencies]"}\ndep={path="../dep"}\n`,
      target === "src" ? source : "pub fn intact(){}",
      {
        sources:
          target === "tests"
            ? { "app/tests/use_dep.rs": source }
            : build
              ? { "app/build.rs": source + "fn main(){}" }
              : {},
      },
    );
    if (target === "src") g.unverified("dep::f", "f");
    else g.one("dep::f", "f");
  });
test("round 10 W2 cfg(test) permits dev dependency only at the gated site", async () => {
  // Cargo test enables test for the library's unit-test code.
  const g = await dependencyGraph(
    '[dev-dependencies]\ndep={path="../dep"}\n',
    "#[cfg(test)]pub fn run()->u8{dep::f()}",
  );
  g.one("dep::f", "f");
});
for (const [label, source, name, kind, identity] of [
  ["function", "#[pm::id]fn f()->u8{1}fn r(){f();}", "f", "calls", "f"],
  [
    "method",
    "struct A;#[pm::replace]impl A{fn f(self)->u8{1}}fn r(a:A){a.f();}",
    "a.f",
    "calls",
    "impl A::f",
  ],
  [
    "associated path",
    "struct A;#[pm::id]impl A{fn f()->u8{1}}fn r(){A::f();}",
    "A::f",
    "calls",
    "impl A::f",
  ],
  [
    "struct",
    "#[pm::id]struct A{x:u8}fn r(_:A){let _=A{x:1};}",
    "A",
    "types",
    "A",
  ],
  [
    "variant",
    "#[pm::id]enum E{V}fn r(){let _=E::V;}",
    "E::V",
    "values",
    "E::V",
  ],
  ["alias", "#[pm::id]type A=u8;fn r(_:A){}", "A", "types", "A"],
  ["constant", "#[pm::id]const A:u8=1;fn r(){let _=A;}", "A", "values", "A"],
  ["static", "#[pm::id]static A:u8=1;fn r(){let _=A;}", "A", "values", "A"],
  [
    "trait",
    "#[pm::id]trait Tr{}struct A;impl Tr for A{}",
    "Tr",
    "implements",
    "Tr",
  ],
  [
    "use",
    "mod m{pub fn f(){}}#[pm::id]use m::f;fn r(){f();}",
    "f",
    "calls",
    "m::f",
  ],
  [
    "inline mod",
    "#[pm::id]mod m{pub fn f(){}}fn r(){m::f();}",
    "m::f",
    "calls",
    "m::f",
  ],
  [
    "inner impl",
    "struct A;impl A{#![pm::id]fn f(self){}}fn r(a:A){a.f();}",
    "a.f",
    "calls",
    "impl A::f",
  ],
  ["inner crate", "#![pm::id]\nfn f(){}fn r(){f();}", "f", "calls", "f"],
  ["cfg_attr", "#[cfg_attr(x,pm::id)]fn f(){}fn r(){f();}", "f", "calls", "f"],
  [
    "instrument",
    "struct A;impl A{#[tracing::instrument]fn f(self){}}fn r(a:A){a.f();}",
    "a.f",
    "calls",
    "impl A::f",
  ],
])
  test(`round 10 W3 opaque presence: ${label}`, async () => {
    // A scratch native identity/replacement attribute demonstrates why opaque input is only a would-be item.
    const g = await graph(lib(source));
    g.unverified(name, identity, kind);
    for (const l of g.links.filter(
      (l) => l.kind === kind && l.targetName === name,
    ))
      assert.match(l.data.uncertainty, /item-under-opaque-attribute/);
  });
test("round 10 W3 file module attribute propagates to clean child targets", async () => {
  const g = await graph({
    "src/lib.rs": "#[pm::id]mod m;fn r(){m::f();}",
    "src/m.rs": "pub fn f(){}",
  });
  g.unverified("m::f", "f");
});
for (const attribute of [
  "#[allow(dead_code)]",
  "#[derive(Debug)]",
  "#[rustfmt::skip]",
  "#[clippy::test]",
  "#[cfg_attr(x,inline)]",
  "#[repr(C)]",
])
  test(`round 10 W3 inert control ${attribute}`, async () => {
    // Builtin/tool attrs leave this struct present; derive cannot remove the input, including a shadowed derive.
    const g = await graph(
      lib(`${attribute}struct A;impl A{fn f(self){}}fn r(a:A){a.f();}`),
    );
    g.one("a.f", "impl A::f");
  });
test("round 10 W3 fixing an opaque declaration clears cached caller evidence", async () => {
  const sources = {
    "src/lib.rs": "mod m;mod user;",
    "src/m.rs": "#[pm::id]pub fn f(){}",
    "src/user.rs": "pub fn run(){crate::m::f();}",
  };
  const first = await graph(sources);
  first.unverified("crate::m::f", "f");
  const fixed = await graph(
    { ...sources, "src/m.rs": "pub fn f(){}" },
    undefined,
    { "src/user.rs": first.files.find((f) => f.path === "src/user.rs").result },
  );
  fixed.one("crate::m::f", "f");
  const l = fixed.links.find(
    (l) => l.kind === "calls" && l.targetName === "crate::m::f",
  );
  assert.equal(l.data.opaqueAttributes, undefined);
});
test("round 10 W2 build-only dependency is not a source-crate binding", async () => {
  const g = await dependencyGraph(
    '[build-dependencies]\ndep={path="../dep"}\n',
    "pub fn run(){dep::f();}",
  );
  g.unknown("dep::f");
});
test("round 10 W3 an opaque module declaration cannot prove a failed-file cause", async () => {
  const g = await graph({
    "src/lib.rs": "#[pm::id]mod m;fn r(){m::f();}",
    "src/m.rs": "pub fn broken( {",
  });
  for (const l of g.links.filter(
    (l) => l.kind === "modules" || l.targetName === "m::f",
  )) {
    assert.notEqual(l.data?.uncertainty, "invalid-code");
    assert.equal(l.data?.cause, undefined);
    assert.match(l.data?.uncertainty ?? "", /opaque/);
  }
});
test("round 10 W3 unsafe and tool builtins preserve items without opaque metadata", async () => {
  // rustc accepts the unsafe wrapper and tool attributes; f returns 3.
  const g = await graph(
    lib("#[unsafe(no_mangle)]#[rustfmt::skip]fn f()->u8{3}fn r(){f();}"),
  );
  g.one("f", "f");
  assert.equal(
    g.links.find((l) => l.kind === "calls" && l.targetName === "f").data
      .opaqueAttributes,
    undefined,
  );
});
test("round 10 W3 contains stays structural and marks symbols including file-module inheritance", async () => {
  const g = await graph({
    "src/lib.rs": "#[pm::replace]mod m;",
    "src/m.rs": "pub struct A;impl A{pub fn f(self){}}",
  });
  for (const s of g.symbols) {
    if (s.file === "src/m.rs" || s.identity === "m") {
      assert.equal(s.data.underOpaqueAttribute, true, s.identity);
      assert.deepEqual(s.data.opaqueAttributes, ["pm::replace"]);
    }
  }
  for (const l of g.links.filter((l) => l.kind === "contains")) {
    const d = g.decisions.find((d) => d.linkId === l.id);
    assert.ok(d?.targetId, l.targetName);
    assert.equal(l.data.uncertainty, undefined);
  }
});
test("round 10 W3 removing a parent attribute clears cached child symbol flags", async () => {
  const source = {
    "src/lib.rs": "#[pm::id]mod m;fn r(){m::f();}",
    "src/m.rs": "pub fn f(){}",
  };
  const first = await graph(source);
  assert.ok(
    first.symbols
      .filter((s) => s.file === "src/m.rs")
      .every((s) => s.data.underOpaqueAttribute === true),
  );
  const fixed = await graph(
    { ...source, "src/lib.rs": "mod m;fn r(){m::f();}" },
    undefined,
    { "src/m.rs": first.files.find((f) => f.path === "src/m.rs").result },
  );
  fixed.one("m::f", "f");
  for (const s of fixed.symbols.filter((s) => s.file === "src/m.rs")) {
    assert.equal(s.data.underOpaqueAttribute, undefined);
    assert.equal(s.data.opaqueAttributes, undefined);
  }
});
test("round 10 W2 an unconditional explicit extern crate alias proves a prelude-name binding", async () => {
  // Cargo: extern crate String as chosen names the dependency explicitly; chosen::f returns 3.
  const g = await dependencyGraph(
    '[dependencies]\nString={package="dep",path="../dep"}\n',
    "extern crate String as chosen;pub fn run()->u8{chosen::f()}",
  );
  g.one("chosen::f", "f");
});
test("round 10 W2 normal dependency remains proved beside same-crate dev route", async () => {
  // Cargo run prints 3. The normal edge supplies dep regardless of cfg(test).
  const g = await dependencyGraph(
    '[dependencies]\ndep={path="../dep"}\n[dev-dependencies]\ndep={path="../dep"}\n',
    "pub fn run()->u8{dep::f()}",
  );
  g.one("dep::f", "f");
});
test("round 10 W2 same-crate target routes prove presence by disjunction", async () => {
  // Cargo selects the host route; at an explicitly unix-gated site the unix edge suffices.
  const g = await dependencyGraph(
    "[target.'cfg(unix)'.dependencies]\ndep={path=\"../dep\"}\n[target.'cfg(windows)'.dependencies]\ndep={path=\"../dep\"}\n",
    "#[cfg(unix)]pub fn run()->u8{dep::f()}",
  );
  g.one("dep::f", "f");
});
