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

const broken =
  "pub fn g()->u8{let raw=1u8;let r=&raw;*r} #[derive(Default,Debug)]pub struct A;";
const own = "#[derive(Default,Debug)]pub struct A;impl A{pub fn new()->A{A}}";
const calls = "pub fn f()->A{A::default()}pub fn n()->A{A::new()}";
function noCause(g, name, kind = "calls") {
  const ls = g.links.filter((l) => l.targetName === name && l.kind === kind);
  assert.ok(ls.length, name);
  for (const l of ls) {
    assert.equal(l.data?.cause, undefined, name);
    assert.notEqual(l.data?.uncertainty, "invalid-code", name);
  }
}
for (const variant of ["local", "explicit", "child"]) {
  test(`round 8 B1 present ${variant} binding excludes failed glob member fallback`, async () => {
    // rustc prints A A 1, including a second A inside broken.rs. Explicit/local A wins.
    const source =
      variant === "explicit"
        ? `mod broken;mod t;#[allow(unused_imports)]use broken::*;use t::A;${calls}`
        : `mod broken;#[allow(unused_imports)]use broken::*;${own}${variant === "child" ? `mod child{use super::*;${calls}}` : calls}`;
    const inputs = {
      "src/lib.rs": source,
      "src/broken.rs": broken,
      ...(variant === "explicit" ? { "src/t.rs": own } : {}),
    };
    const g = await graph(inputs);
    assert.equal(
      g.files.find((f) => f.path === "src/broken.rs").result.status,
      "failed",
    );
    g.one("A::new", "impl A::new");
    g.unknown("A::default");
    for (const name of ["A::new", "A::default"]) noCause(g, name);
    assert.match(
      g.links.find((l) => l.targetName === "A::default").data.uncertainty,
      /trait-dispatch/,
    );
    const fixed = await graph({
      ...inputs,
      "src/broken.rs": broken.replaceAll("raw", "renamed"),
    });
    fixed.one("A::new", "impl A::new");
    fixed.unknown("A::default");
    noCause(fixed, "A::default");
  });
}
test("round 8 B1 failed glob supplies only otherwise unbound names", async () => {
  const g = await graph({
    "src/lib.rs": "mod broken;use broken::*;fn f(){g();}",
    "src/broken.rs": broken,
  });
  g.unknown("g");
  const l = g.links.find((l) => l.targetName === "g");
  assert.equal(l.data.uncertainty, "invalid-code");
  assert.deepEqual(l.data.cause, { files: ["src/broken.rs"] });
  assert.equal(l.data.targets, undefined);
});
test("round 8 B1 conditional binding still retains valid glob alternatives", async () => {
  const g = await graph({
    "src/lib.rs":
      "mod other{pub fn f(){}}use other::*;#[cfg(a)]fn f(){}fn r(){f();}",
  });
  g.unknown("f");
  assert.deepEqual(
    g
      .would("f")[0]
      .map((s) => s.identity)
      .sort(),
    ["f", "other::f"],
  );
});
test("round 8 B1 namespace precedence covers types literals variants imports and macros", async () => {
  const g = await graph({
    "src/lib.rs": `mod broken;use broken::*;struct S{v:u8}enum E{V}macro_rules! local{()=>{1u8}}
    mod local{pub use external::{External,extm};}use local::External;
    fn r(_:S){let _=S{v:1};let _=E::V;let _:Option<local::External>=None;}fn macros(){local!();local::extm!();}`,
    "src/broken.rs": broken,
  });
  g.one("S", "S", "types");
  g.one("E::V", "E::V", "values");
  g.one("local", "local", "macros");
  for (const [name, kind] of [
    ["S", "types"],
    ["E::V", "values"],
    ["local::External", "imports"],
    ["local::External", "types"],
    ["local::extm", "macros"],
  ])
    noCause(g, name, kind);
});
test("round 8 B1 explicit values beat enum globs; type-only imports allow value globs", async () => {
  const g = await graph({
    "src/lib.rs":
      "mod one{pub enum E{V}}mod two{pub enum E{V}}use one::E::*;use two::E::*;use one::E::V;mod t{pub struct f{x:u8}}mod value{pub fn f(){}}use t::f;use value::*;fn r(){let _=V;f();}",
  });
  g.one("V", "one::E::V", "values");
  g.one("f", "value::f");
});
test("round 8 B1 two globs are ambiguous only at a used name", async () => {
  const sources = {
    "src/lib.rs":
      "mod one{pub enum E{V}}mod two{pub enum E{V}}use one::E::*;use two::E::*;",
  };
  const unused = await graph(sources);
  assert.ok(unused.decisions.every((d) => !d.candidateIds));
  assert.ok(unused.files.every((f) => f.result.status === "clean"));
  const used = await graph({
    "src/lib.rs": sources["src/lib.rs"] + "fn r(){let _=V;}",
  });
  assert.deepEqual(
    used
      .targets("V", "values")[0]
      .map((s) => s.identity)
      .sort(),
    ["one::E::V", "two::E::V"],
  );
});
test("round 8 failed cfg-twin scope gives uncertainty, never inferred causes", async () => {
  // rustc --cfg a prints 1: inactive bad.rs is never loaded by the compiler.
  const g = await graph({
    "src/lib.rs":
      '#[cfg(a)]#[path="ok.rs"]mod twin;#[cfg(not(a))]#[path="bad.rs"]mod twin;#[cfg(not(a))]mod unrelated;',
    "src/ok.rs":
      "pub fn kept()->u8{1}pub fn probe()->u8{let _:Vec<u8>=Vec::new();kept()}",
    "src/bad.rs": "pub fn broken( {",
    "src/unrelated.rs": "pub struct Broken {",
  });
  g.one("kept", "kept");
  g.unknown("Vec::new");
  noCause(g, "Vec::new");
  assert.match(
    g.links.find((l) => l.targetName === "Vec::new").data.uncertainty,
    /failed-file-unseen-declarations/,
  );
});
test("round 8 internal module parser failure is a path lookup error, not receiver uncertainty", async () => {
  const g = await graph(
    {
      "src/lib.rs": "mod boom;fn r(){boom::f();}",
      "src/boom.rs": "pub fn f(){}",
    },
    undefined,
    {
      "src/boom.rs": {
        status: "failed",
        symbols: [],
        links: [],
        diagnostics: [
          { message: "Rust parser internal error: injected failure" },
        ],
      },
    },
  );
  g.unknown("boom::f");
  noCause(g, "boom::f");
  const reason = g.links.find((l) => l.targetName === "boom::f").data
    .uncertainty;
  assert.match(reason, /parser-internal-error/);
  assert.doesNotMatch(reason, /receiver-type-unverified/);
});

// Rust controls for these exact fixtures are run separately in round8-rustc.mjs.
// off/on in the fixture records pin the native answer for both feature settings.
import { readFile } from "node:fs/promises";
const cfgFixtures = JSON.parse(
  await readFile(
    new URL("./fixtures/graph-rust/round8-cfg.json", import.meta.url),
    "utf8",
  ),
);
for (const fixture of cfgFixtures)
  test(`round 8 S1 cfg site: ${fixture.name}`, async () => {
    const g = await graph(fixture.sources);
    assert.ok(
      g.files.every((f) => f.result.status === "clean"),
      JSON.stringify(g.files.map((f) => [f.path, f.result.diagnostics])),
    );
    for (const [op, name, a, b] of fixture.checks) {
      if (op === "allTargets")
        assert.deepEqual(
          g.targets(name, a).map((ts) => ts.map((s) => s.identity)),
          b,
        );
      if (op === "candidates")
        assert.deepEqual(
          g
            .targets(name)[0]
            .map((s) => s.identity)
            .sort(),
          [...a].sort(),
        );
      if (op === "unknown") g.unknown(name, a);
      if (op === "one") g.one(name, a, b);
      if (op === "would")
        assert.deepEqual(
          g
            .would(name)[0]
            .map((s) => s.identity)
            .sort(),
          [...a].sort(),
        );
      if (op === "hints") assert.ok(g.would(name)[0].length >= a, name);
      if (op === "reason")
        assert.match(
          g.links.find((l) => l.targetName === name && l.kind === "calls").data
            .uncertainty,
          new RegExp(a),
        );
      if (op === "unconditional")
        assert.deepEqual(
          g.symbols.find((s) => s.name === name).data.conditions,
          [],
        );
      if (op === "condition")
        assert.ok(
          g.links
            .filter((l) => l.targetName === name && l.kind === a)
            .every((l) => l.data.conditions.includes(b)),
          name,
        );
      if (op === "symbolCondition")
        assert.ok(
          g.symbols.find((s) => s.name === name).data.conditions.includes(a),
          name,
        );
      if (op === "unitCondition")
        assert.ok(
          g.symbols.find((s) => s.data.unit).data.conditions.includes(name),
        );
      if (op === "states")
        assert.deepEqual(
          g.links
            .filter((l) => l.targetName === name)
            .map((l) =>
              g.decisions.find((d) => d.linkId === l.id)?.targetId
                ? "resolved"
                : "unresolved",
            )
            .sort(),
          [...a].sort(),
        );
    }
  });
for (const binding of [
  "struct A;impl A{pub fn new()->A{A}}",
  "use crate::t::A;",
])
  test(`round 8 B1 block binding excludes parent glob: ${binding.startsWith("use") ? "use" : "item"}`, async () => {
    const g = await graph({
      "src/lib.rs": `mod broken;use broken::*;mod t{pub struct A;impl A{pub fn new()->A{A}}}fn run(){${binding}let _=A::new();}`,
      "src/broken.rs": broken,
    });
    g.one(
      "A::new",
      binding.startsWith("use") ? "t::impl A::new" : "run::impl A::new",
    );
    noCause(g, "A::new");
  });
test("round 8 S1 unsupported cfg predicate never proves a link", async () => {
  const g = await graph(lib("#[cfg(unsupported(a))]fn f(){}fn r(){f()}"));
  g.unknown("f");
  g.unverified("f", "f");
});
test("round 8 S1 crate root gates are inherited but dependency features are independent", async () => {
  const manifests = {
    "Cargo.toml": '[workspace]\nmembers=["app","dep"]\n',
    "app/Cargo.toml":
      '[package]\nname="app"\nedition="2024"\n[dependencies]\ndep={path="../dep"}\n',
    "dep/Cargo.toml": '[package]\nname="dep"\nedition="2024"\n',
  };
  const g = await graph(
    {
      "app/src/lib.rs": '#[cfg(feature="x")]pub fn run(){dep::f();}',
      "dep/src/lib.rs": '#![cfg(feature="x")]pub fn f(){}pub fn inside(){f();}',
    },
    manifests,
  );
  g.unknown("dep::f");
  g.unverified("dep::f", "f");
  g.one("f", "f");
});
test("round 8 S1 cfg on a parameter does not prove its binding present at an ungated use", async () => {
  // rustc: x off run() calls outer f (2); x on run(g) calls parameter g (1).
  const g = await graph(
    lib(
      'fn f()->u16{2}fn g()->u16{1}fn run(#[cfg(feature="x")]f:fn()->u16)->u16{f()}',
    ),
  );
  g.unknown("f");
  g.unverified("f", "f");
});
test("round 8 S1 inner module cfg_attr and enclosing function cfg are inherited", async () => {
  // rustc: x on prints 1, x off prints 2 (the gated module/caller disappear).
  const g = await graph(
    lib(
      'mod m{#![cfg_attr(not(feature="x"),cfg(any()))]pub fn f()->u8{1}pub fn run()->u8{f()}}#[cfg(feature="x")]fn run(){m::f();}fn probe(){m::f();}',
    ),
  );
  g.one("f", "m::f");
  const calls = g.links.filter((l) => l.targetName === "m::f");
  assert.equal(
    calls.filter((l) =>
      g.decisions.some((d) => d.linkId === l.id && d.targetId),
    ).length,
    1,
  );
  assert.equal(calls.filter((l) => l.data.uncertainty).length, 1);
});
test("round 8 S1 caller conjunct proof does not expand unrelated cfg combinations", async () => {
  // rustc with --cfg a0 --cfg b0 --cfg x: prints 1; without x prints 2.
  const many = (prefix) =>
    `any(${Array.from({ length: 20 }, (_, i) => prefix + i).join(",")})`;
  const g = await graph(
    lib(
      `#[cfg(all(${many("a")},${many("b")}))]mod m{#![cfg(x)]pub fn f()->u16{g()}fn g()->u16{1}}#[cfg(x)]fn r(){m::f();}`,
    ),
  );
  g.one("g", "m::g");
  g.unknown("m::f");
  const { implies } = await import("../dist/graph/languages/rust/cfg.js");
  const large = [many("a"), many("b"), 'feature="logs"'];
  assert.equal(implies(large, large[0]), true);
  assert.equal(implies(large, 'any(feature="logs",feature="metrics")'), true);
  assert.equal(implies(large, 'not(feature="logs")'), false);
});
