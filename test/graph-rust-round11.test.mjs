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
const { crates } = await import(
  new URL(
    "./cargo.js",
    new URL(
      process.env.RUST_TEST_MODULE ?? "../dist/graph/languages/rust/index.js",
      import.meta.url,
    ),
  )
);
const { readToml } = await import(
  new URL(
    "./toml.js",
    new URL(
      process.env.RUST_TEST_MODULE ?? "../dist/graph/languages/rust/index.js",
      import.meta.url,
    ),
  )
);
const { attributeEffect, inertAttributes } = await import(
  new URL(
    "./parse.js",
    new URL(
      process.env.RUST_TEST_MODULE ?? "../dist/graph/languages/rust/index.js",
      import.meta.url,
    ),
  )
);
const contexts = (xs) =>
  Object.entries(xs).map(([path, text]) => ({
    path,
    text,
    hash: contentHash(text),
    status: "clean",
    diagnostics: [],
  }));
const facts = (xs, paths = ["src/lib.rs"]) =>
  crates(contexts(xs), new Set(paths));
const editionSource =
  "mod a{pub fn f()->u16{2}}mod b{mod a{pub fn f()->u8{1}}use a::f;pub fn run()->u8{let x:u8=f();x}}";
for (const spelling of [
  "edition.workspace=true",
  "edition={workspace=true}",
  "[package.edition]\nworkspace=true",
])
  test(`round 11 inherited ${spelling}`, async () => {
    // Offline Cargo accepts each spelling; the u8 annotation proves b::a::f.
    const docs = {
      "Cargo.toml":
        '[workspace]\nmembers=["app"]\n[workspace.package]\nedition="2024"',
      "app/Cargo.toml": '[package]\nname="app"\nversion="0.1.0"\n' + spelling,
    };
    (await graph({ "app/src/lib.rs": editionSource }, docs)).one(
      "f",
      "b::a::f",
    );
    assert.equal(facts(docs, ["app/src/lib.rs"])[0].edition, "2024");
  });
for (const key of ["edition", '"edition"', "'edition'", '"edi\\u0074ion"'])
  for (const value of [
    '"2024"',
    "'2024'",
    '"""2024"""',
    "'''2024'''",
    '"20\\u00324"',
  ])
    test(`round 11 edition ${key} ${value}`, async () => {
      // Cargo decodes quoted/escaped keys and basic/literal/multiline strings.
      (
        await graph(lib(editionSource), {
          "Cargo.toml":
            '[package]\nname="app"\nversion="0.1.0"\n' +
            key +
            "=" +
            value +
            " # comment",
        })
      ).one("f", "b::a::f");
    });
for (const [label, manifest] of [
  ["dotted", 'package.name="app"\npackage.edition="2024"'],
  ["quoted dotted", '"package"."name"="app"\n"package"."edition"="2024"'],
  ["inline", 'package={name="app",edition="2024"}'],
  ["table", "['package']\n'name'='app'\n'edition'='2024'"],
])
  test(`round 11 package ${label}`, () => {
    const [c] = facts({ "Cargo.toml": manifest });
    assert.equal(c.name, "app");
    assert.equal(c.edition, "2024");
  });
for (const [label, target] of [
  ["table", '[lib]\nname="library"\npath="custom.rs"\nedition="2018"'],
  ["quoted", "['lib']\n'name'='library'\n'path'='custom.rs'\n'edition'='2018'"],
  ["dotted", 'lib.name="library"\nlib.path="custom.rs"\nlib.edition="2018"'],
  ["inline", 'lib={name="library",path="custom.rs",edition="2018"}'],
])
  test(`round 11 lib ${label}`, () => {
    const [c] = facts(
      { "Cargo.toml": target + '\n[package]\nname="app"\nedition="2024"' },
      ["custom.rs", "src/lib.rs"],
    );
    assert.deepEqual(
      [c.name, c.root, c.edition],
      ["library", "custom.rs", "2018"],
    );
  });
for (const kind of ["bin", "example", "test", "bench"])
  for (const form of ["array tables", "quoted tables", "inline array"])
    test(`round 11 target ${kind} ${form}`, () => {
      const entry = 'name="special",path="special.rs",edition="2018"';
      const t =
        form === "inline array"
          ? kind + "=[{" + entry + '},{name="second",path="second.rs"}]'
          : `[[${form === "quoted tables" ? JSON.stringify(kind) : kind}]]\n` +
            entry.replaceAll(",", "\n") +
            `\n[[${kind}]]\nname="second"\npath="second.rs"`;
      const [a, b] = facts(
        { "Cargo.toml": t + '\n[package]\nname="app"\nedition="2024"' },
        ["special.rs", "second.rs"],
      );
      assert.deepEqual(
        [a.root, a.name, a.kind, a.edition],
        ["special.rs", "special", kind, "2018"],
      );
      assert.equal(b.name, "second");
      assert.equal(b.edition, "2024");
    });
const depManifest = '[package]\nname="real-package"\nedition="2024"';
for (const spelling of [
  '[dependencies]\nalias={package="real-package",path="dep",optional=true}',
  '["dependencies"."alias"]\n"package"="real-package"\n"path"="dep"\n"optional"=true',
  'dependencies.alias.package="real-package"\ndependencies.alias.path="dep"\ndependencies.alias.optional=true',
  'dependencies={alias={package="real-package",path="dep",optional=true}}',
])
  test(`round 11 dependency ${spelling.slice(0, 40)}`, () => {
    const [c] = facts(
      {
        "Cargo.toml": spelling + '\n[package]\nname="app"\nedition="2024"',
        "dep/Cargo.toml": depManifest,
      },
      ["src/lib.rs", "dep/src/lib.rs"],
    );
    const e = c.dependencies.find((e) => e.name === "alias");
    assert.equal(e.manifest, "dep/Cargo.toml");
    assert.ok(e.conditions.some((c) => c.includes('feature="alias"')));
  });
for (const dep of [
  "alias.workspace=true",
  "alias={workspace=true,optional=true}",
  "[dependencies.alias]\nworkspace=true\noptional=true",
])
  test(`round 11 inherited dependency ${dep}`, () => {
    const root =
      '[workspace]\nmembers=["app","dep"]\n[workspace.dependencies.alias]\npackage="real-package"\npath="dep"';
    const member =
      '[package]\nname="app"\n' +
      (dep.startsWith("[") ? dep : "[dependencies]\n" + dep);
    const [c] = facts(
      {
        "Cargo.toml": root,
        "app/Cargo.toml": member,
        "dep/Cargo.toml": depManifest,
      },
      ["app/src/lib.rs", "dep/src/lib.rs"],
    );
    assert.equal(c.dependencies[0].manifest, "dep/Cargo.toml");
    assert.equal(c.dependencies[0].name, "alias");
  });
for (const target of [
  '[target.\'cfg(feature = "gate")\'.dependencies]\nalias={package="real-package",path="dep"}',
  'target.\'cfg(feature = "gate")\'.dependencies.alias={package="real-package",path="dep"}',
])
  test(`round 11 conditioned ${target.slice(0, 30)}`, () => {
    const [c] = facts(
      {
        "Cargo.toml": target + '\n[package]\nname="app"',
        "dep/Cargo.toml": depManifest,
      },
      ["src/lib.rs", "dep/src/lib.rs"],
    );
    assert.deepEqual(c.dependencies[0].conditions, ['feature="gate"']);
  });
for (const members of ['["app-*","lib/**"]', '["app-?","lib/[ab]"]'])
  test(`round 11 members/exclude ${members}`, () => {
    const docs = {
      "Cargo.toml":
        "workspace.members=" +
        members +
        '\nworkspace.exclude=["app-z"]\nworkspace.package.edition="2024"',
    };
    for (const dir of ["app-a", "app-z", "lib/a"])
      docs[dir + "/Cargo.toml"] =
        '[package]\nname="' +
        dir.replaceAll("/", "-") +
        '"\nedition.workspace=true';
    const cs = facts(docs, [
      "app-a/src/lib.rs",
      "app-z/src/lib.rs",
      "lib/a/src/lib.rs",
    ]);
    assert.equal(cs.find((c) => c.root.startsWith("app-a/")).edition, "2024");
    assert.equal(cs.find((c) => c.root.startsWith("app-z/")).edition, null);
    assert.equal(cs.find((c) => c.root.startsWith("lib/a/")).edition, "2024");
  });
for (const override of [
  '[patch.crates-io]\nreal-package={path="patched"}',
  '[replace]\n"real-package:0.1.0"={path="patched"}',
])
  test(`round 11 override ${override.slice(0, 25)}`, () => {
    const [c] = facts(
      {
        "Cargo.toml":
          '[package]\nname="app"\n[dependencies]\nalias={package="real-package",path="dep"}\n' +
          override,
        "dep/Cargo.toml": depManifest,
        "patched/Cargo.toml": depManifest,
      },
      ["src/lib.rs", "dep/src/lib.rs", "patched/src/lib.rs"],
    );
    assert.equal(c.dependencyGraphKnown, false);
    assert.deepEqual(c.dependencies.map((e) => e.manifest).sort(), [
      "dep/Cargo.toml",
      "patched/Cargo.toml",
    ]);
    assert.ok(
      c.dependencies.every((e) => e.conditions.includes("?manifest-override")),
    );
  });
for (const fragment of [
  "edition={workspace=",
  '"edition"="2024',
  "garbage ???",
  'edition="2024"\nedition="2015"',
])
  test(`round 11 unreadable ${fragment}`, async () => {
    const manifest = '[package]\nname="app"\n' + fragment;
    assert.equal(readToml(manifest), null);
    assert.deepEqual(facts({ "Cargo.toml": manifest }), []);
    (await graph(lib(editionSource), { "Cargo.toml": manifest })).unknown("f");
  });
for (const value of ['{workspace="true"}', "2024", "{unexpected=true}"])
  test(`round 11 unread edition ${value}`, async () => {
    const manifest = '[package]\nname="app"\nedition=' + value;
    assert.equal(facts({ "Cargo.toml": manifest })[0].edition, null);
    (await graph(lib(editionSource), { "Cargo.toml": manifest })).unknown("f");
  });
test("round 11 absent edition is 2015", () =>
  assert.equal(
    facts({ "Cargo.toml": '[package]\nname="app"' })[0].edition,
    "2015",
  ));
test("round 11 test is absent in normal build", async () => {
  // rustc --crate-type=lib and --test accept; normal f() is other::f returning u8.
  (
    await graph(
      lib(
        "#[test]fn f(){}mod other{pub fn f()->u8{1}}#[cfg(not(test))]use other::f;#[cfg(not(test))]pub fn run()->u8{let x:u8=f();x}",
      ),
    )
  ).one("f", "other::f");
});
for (const attr of ["test", "bench"])
  test(`round 11 ${attr} implies test`, async () => {
    // Native test accepts; bench uses feature(test) with the correct Bencher signature.
    const header =
        attr === "bench" ? "#![feature(test)]\nextern crate test;" : "",
      param = attr === "bench" ? "_b:&mut test::Bencher" : "",
      caller = attr === "bench" ? "b:&mut test::Bencher" : "",
      arg = attr === "bench" ? "b" : "";
    const g = await graph(
      lib(
        `${header}#[${attr}]fn f(${param}){}#[cfg(test)]mod inside{pub fn run(${caller}){super::f(${arg})}}`,
      ),
    );
    g.one("super::f", "f");
    assert.deepEqual(g.symbols.find((s) => s.name === "f").data.conditions, [
      "test",
    ]);
    (
      await graph(
        lib(
          `${header}#[${attr}]fn f(${param}){}mod other{pub fn f()->u8{1}}#[cfg(not(test))]use other::f;#[cfg(not(test))]fn run()->u8{f()}`,
        ),
      )
    ).one("f", "other::f");
  });
test("round 11 cfg_attr implicit test condition", async () => {
  // Both native modes accept: the test-only item is absent under gate && !test.
  (
    await graph(
      lib(
        "#[cfg_attr(gate,test)]fn f(){}#[cfg(all(gate,not(test)))]use other::f;mod other{pub fn f()->u8{1}}#[cfg(all(gate,not(test)))]fn run()->u8{f()}",
      ),
    )
  ).one("f", "other::f");
});
for (const [attr, name] of [
  ["proc_macro", "f"],
  ["proc_macro_attribute", "f"],
  ["proc_macro_derive(D,attributes(helper))", "D"],
])
  test(`round 11 macro namespace ${attr}`, async () => {
    // Offline Cargo accepts these exports in a proc-macro library, as macros.
    const r = await rust.parse({
      path: "src/lib.rs",
      text: `use proc_macro::TokenStream;#[${attr}]pub fn f(${attr === "proc_macro_attribute" ? "_a:TokenStream," : ""}input:TokenStream)->TokenStream{input}`,
    });
    const s = r.symbols.find((s) => s.data?.sourceFunctionName === "f");
    assert.equal(s.kind, "function");
    assert.equal(s.data.semanticKind, "macro");
    assert.equal(s.data.exportedMacroName, name);
    assert.deepEqual(s.data.conditions, []);
  });
test("round 11 conditional proc macro kind is unverified", async () => {
  const g = await graph(
    lib(
      "#[cfg_attr(gate,proc_macro)]pub fn f(x:TokenStream)->TokenStream{x}fn run(x:TokenStream){f(x);}",
    ),
  );
  g.unknown("f");
  assert.ok(g.symbols.find((s) => s.name === "f").data.namespaceUnverified);
});
test("round 11 builtin effect classification", () => {
  for (const n of ["test", "bench", "cfg", "cfg_attr"])
    assert.equal(attributeEffect(n), "conditional");
  for (const n of ["proc_macro", "proc_macro_derive", "proc_macro_attribute"])
    assert.equal(attributeEffect(n), "macro");
  for (const n of inertAttributes) assert.equal(attributeEffect(n), "inert");
  for (const n of ["cfg_eval", "tokio::test", "pm::replace"])
    assert.equal(attributeEffect(n), "opaque");
  for (const n of ["panic_handler", "global_allocator", "derive"])
    assert.equal(attributeEffect(n), "inert");
});
for (const name of ["test", "bench", "derive", "global_allocator"])
  test(`round 11 explicit prelude attribute shadow ${name}`, async () => {
    // Native proc-macro oracle replaces the inherent impl; a.f() has type u16.
    const g = await graph(
      lib(
        `use pm::${name};pub struct A;pub trait Tr{fn f(self)->u16;}#[${name}]impl A{pub fn f(self)->u8{1}}fn run(a:A)->u16{a.f()}`,
      ),
    );
    g.unverified("a.f", "impl A::f");
    const s = g.symbols.find((s) => s.identity === "impl A::f");
    assert.equal(s.data.underOpaqueAttribute, true);
    assert.ok(s.data.opaqueAttributes.includes(name));
    assert.ok(!s.data.conditions.includes("test"));
  });
for (const tool of ["rustfmt", "clippy", "diagnostic", "miri", "rust_analyzer"])
  test(`round 11 tool path shadow ${tool}`, async () => {
    // Native proc-macro oracle replaces h with a u16-returning function.
    const attr = tool === "diagnostic" ? "on_unimplemented" : "skip";
    const g = await graph(
      lib(
        `mod ${tool}{pub use pm::${attr};}mod m{use super::${tool};#[${tool}::${attr}]pub fn h()->u8{1}}fn run()->u16{m::h()}`,
      ),
    );
    g.unverified("m::h", "m::h");
    assert.ok(
      g.symbols
        .find((s) => s.identity === "m::h")
        .data.opaqueAttributes.includes(`${tool}::${attr}`),
    );
    const control = await graph(
      lib(`mod m{#[${tool}::anything]pub fn h()->u8{1}}fn run()->u8{m::h()}`),
    );
    control.one("m::h", "m::h");
  });
test("round 11 bare opaque attribute remains opaque", async () => {
  // Native proc-macro replace exports a u16 h in place of the written u8 h.
  const g = await graph(
    lib("use pm::replace;#[replace]pub fn h()->u8{1}fn run()->u16{h()}"),
  );
  g.unverified("h", "h");
  assert.deepEqual(
    g.symbols.find((s) => s.name === "h").data.opaqueAttributes,
    ["replace"],
  );
});
test("round 11 glob is not an attribute shadow", async () => {
  // Native accepted control: an empty glob does not shadow standard #[test].
  const g = await graph(
    lib("mod empty{}use empty::*;#[test]fn f(){}#[cfg(test)]fn run(){f()}"),
  );
  g.one("f", "f");
  const f = g.symbols.find((s) => s.name === "f");
  assert.deepEqual(f.data.conditions, ["test"]);
  assert.equal(f.data.underOpaqueAttribute, undefined);
});
test("round 11 inner import cannot shadow an outer function attribute", async () => {
  // rustc --test accepts: import inside f is outside the attribute lookup scope.
  const g = await graph(
    lib("#[test]fn f(){use pm::test;}#[cfg(test)]fn run(){f()}"),
  );
  g.one("f", "f");
  assert.equal(
    g.symbols.find((s) => s.name === "f").data.underOpaqueAttribute,
    undefined,
  );
});
test("round 11 foreign parent explicit binding shadows inner attribute", async () => {
  // Native file-module control: the child explicitly imports the parent macro.
  const g = await graph({
    "src/lib.rs": "use pm::test;mod child;fn run()->u16{child::f()}",
    "src/child.rs": "use super::test;#[test]pub fn f()->u8{1}",
  });
  g.unverified("child::f", "f");
  assert.ok(
    g.symbols
      .find((s) => s.name === "f")
      .data.opaqueAttributes.includes("test"),
  );
});
test("round 11 foreign parent tool binding and inherited attribute origin", async () => {
  const g = await graph({
    "src/lib.rs":
      "mod rustfmt{pub use pm::skip;}mod child;fn run()->u16{child::f()}",
    "src/child.rs": "use super::rustfmt;#[rustfmt::skip]pub fn f()->u8{1}",
  });
  g.unverified("child::f", "f");
  // A binding introduced below a tool attribute's own lookup scope is not a shadow.
  const c = await graph({
    "src/lib.rs": "#[rustfmt::skip]mod child;fn run()->u8{child::leaf::f()}",
    "src/child.rs": "mod rustfmt{}pub mod leaf;",
    "src/child/leaf.rs": "pub fn f()->u8{1}",
  });
  c.one("child::leaf::f", "f");
});
for (const spelling of [
  "#[cfg_attr(any(),pm::keep)]",
  "#[cfg_attr(not(all()),pm::keep)]",
  "#[cfg(not(gate))]#[cfg_attr(gate,pm::keep)]",
])
  test(`round 11 impossible opaque payload ${spelling}`, async () => {
    // Native proc-macro keep control accepts; this predicate cannot apply at h.
    const g = await graph(
      lib(`${spelling}pub fn h()->u8{1}#[cfg(not(gate))]fn run()->u8{h()}`),
    );
    g.one("h", "h");
    assert.equal(
      g.symbols.find((s) => s.name === "h").data.underOpaqueAttribute,
      undefined,
    );
  });
test("round 11 cfg_attr preserves the full opaque path", async () => {
  const g = await graph(
    lib("#[cfg_attr(gate,pm::keep)]pub fn h()->u8{1}fn run()->u8{h()}"),
  );
  g.unverified("h", "h");
  assert.deepEqual(
    g.symbols.find((s) => s.name === "h").data.opaqueAttributes,
    ["pm::keep"],
  );
});
test("round 11 dep syntax suppresses implicit dependency feature", () => {
  const [c] = facts(
    {
      "Cargo.toml":
        '[package]\nname="app"\n[dependencies]\nalias={package="real-package",path="dep",optional=true}\n[features]\nactivate=["dep:alias"]',
      "dep/Cargo.toml": depManifest,
    },
    ["src/lib.rs", "dep/src/lib.rs"],
  );
  assert.deepEqual(c.dependencies[0].conditions, ['any(feature="activate")']);
  assert.ok(!c.dependencies[0].conditions.join().includes('feature="alias"'));
});
for (const name of [
  "std",
  "core",
  "alloc",
  "proc_macro",
  "test",
  "String",
  "drop",
])
  test(`round 11 dependency collision ${name}`, async () => {
    const g = await graph(
      {
        "src/lib.rs": `fn run(){${name}::f();}`,
        "dep/src/lib.rs": "pub fn f(){}",
      },
      {
        "Cargo.toml": `[package]\nname="app"\nedition="2024"\n[dependencies]\n${name}={package="real-package",path="dep"}`,
        "dep/Cargo.toml": depManifest,
      },
    );
    g.unverified(`${name}::f`, "f");
  });
test("round 11 true builtin classification is pinned independently", () => {
  const names = [
    "allow",
    "automatically_derived",
    "cfg",
    "cfg_attr",
    "cold",
    "collapse_debuginfo",
    "coverage",
    "crate_name",
    "crate_type",
    "debugger_visualizer",
    "deny",
    "deprecated",
    "doc",
    "expect",
    "export_name",
    "feature",
    "forbid",
    "ignore",
    "inline",
    "instruction_set",
    "link",
    "link_name",
    "link_ordinal",
    "link_section",
    "macro_export",
    "macro_use",
    "must_use",
    "naked",
    "no_builtins",
    "no_core",
    "no_implicit_prelude",
    "no_link",
    "no_main",
    "no_mangle",
    "no_std",
    "non_exhaustive",
    "optimize",
    "panic_handler",
    "path",
    "proc_macro",
    "proc_macro_attribute",
    "proc_macro_derive",
    "recursion_limit",
    "repr",
    "should_panic",
    "target_feature",
    "track_caller",
    "type_length_limit",
    "used",
    "warn",
    "windows_subsystem",
  ];
  for (const name of names)
    assert.notEqual(attributeEffect(name, true), "opaque", name);
  for (const name of [
    "test",
    "bench",
    "derive",
    "global_allocator",
    "rustfmt::skip",
    "clippy::anything",
    "diagnostic::on_unimplemented",
    "miri::ignore",
    "rust_analyzer::skip",
  ])
    assert.equal(attributeEffect(name, true), "opaque", name);
});
test("round 11 contradictory nested cfg_attr payload is inert", async () => {
  const g = await graph(
    lib(
      "#[cfg_attr(gate,cfg_attr(not(gate),pm::keep))]pub fn h()->u8{1}fn run()->u8{h()}",
    ),
  );
  g.one("h", "h");
  assert.equal(
    g.symbols.find((s) => s.name === "h").data.underOpaqueAttribute,
    undefined,
  );
});
test("round 11 impossible opaque generator does not taint a glob", async () => {
  const g = await graph(
    lib(
      "mod m{#[cfg(not(gate))]#[cfg_attr(gate,pm::keep)]pub fn h()->u8{1}}use m::*;#[cfg(not(gate))]fn run()->u8{h()}",
    ),
  );
  g.one("h", "m::h");
});
test("round 11 crate inner tool attribute has a scope", async () => {
  const g = await graph(
    lib("#![clippy::anything]\npub fn f()->u8{1}fn run()->u8{f()}"),
  );
  g.one("f", "f");
  assert.equal(
    g.symbols.find((s) => s.name === "f").data.underOpaqueAttribute,
    undefined,
  );
});
test("round 11 module body cannot shadow the containing module attribute", async () => {
  const g = await graph(
    lib(
      "mod m{#![rustfmt::skip]\nmod rustfmt{pub use pm::skip;}pub fn h()->u8{1}}fn run()->u8{m::h()}",
    ),
  );
  g.one("m::h", "m::h");
});
const tomlCases = JSON.parse(
  await (
    await import("node:fs/promises")
  ).readFile(
    new URL("./fixtures/graph-rust/round11-toml.json", import.meta.url),
    "utf8",
  ),
);
for (const fixture of tomlCases.cases)
  test(`round 11 all Cargo facts normalize ${fixture.label}`, () => {
    assert.deepEqual(
      JSON.parse(JSON.stringify(readToml(fixture.text))),
      tomlCases.expected,
    );
    const cs = facts(
      {
        "Cargo.toml": fixture.text,
        "dep/Cargo.toml":
          '[package]\nname="dep-pkg"\nversion="0.1.0"\nedition.workspace=true',
      },
      ["custom.rs", "worker.rs", "second.rs", "dep/src/lib.rs"],
    );
    const c = cs.find((c) => c.kind === "lib" && c.manifest === "Cargo.toml");
    assert.deepEqual(
      [c.root, c.name, c.edition],
      ["custom.rs", "library", "2021"],
    );
    assert.equal(cs.find((c) => c.root === "worker.rs").edition, "2018");
    assert.equal(cs.find((c) => c.root === "dep/src/lib.rs").edition, "2024");
    assert.ok(
      c.dependencies.some(
        (e) =>
          e.name === "dep_alias" &&
          e.conditions.includes('any(feature="activate")'),
      ),
    );
    assert.ok(
      c.dependencies.some(
        (e) => e.name === "gated" && e.conditions.includes('feature="gate"'),
      ),
    );
    assert.equal(c.dependencyGraphKnown, false);
  });

test("round 11 type-only local names do not shadow prelude attribute macros", async () => {
  const g = await graph(
    lib("mod test{}#[test]fn f(){}#[cfg(test)]fn run(){f()}"),
  );
  g.one("f", "f");
  assert.equal(
    g.symbols.find((s) => s.name === "f").data.underOpaqueAttribute,
    undefined,
  );
});
test("round 11 a qualified prelude-like name is an opaque path", async () => {
  const g = await graph(
    lib(
      "extern crate pm as test;#[test::replace]pub fn h()->u8{1}fn run()->u16{h()}",
    ),
  );
  g.unverified("h", "h");
  assert.ok(
    g.symbols
      .find((s) => s.name === "h")
      .data.opaqueAttributes.includes("test::replace"),
  );
});

test("round 11 unshadowed prelude derive and allocator preserve input", async () => {
  const g = await graph(
    lib(
      "#[derive(Debug)]struct A;fn f(_:A){}#[global_allocator]static ALLOC:std::alloc::System=std::alloc::System;fn run(){drop(ALLOC);}",
    ),
  );
  g.one("A", "A", "types");
  g.one("ALLOC", "ALLOC", "values");
  assert.equal(
    g.symbols.find((s) => s.name === "A").data.underOpaqueAttribute,
    undefined,
  );
  assert.equal(
    g.symbols.find((s) => s.name === "ALLOC").data.underOpaqueAttribute,
    undefined,
  );
});
test("round 11 parent shadow changes clear in cached child facts", async () => {
  const child = "#[test]pub fn f(){}",
    root = "use pm::test;mod child;#[cfg(test)]fn run(){child::f()}";
  const g = await graph({ "src/lib.rs": root, "src/child.rs": child });
  g.unverified("child::f", "f");
  const f = g.symbols.find((s) => s.name === "f");
  assert.ok(!f.data.conditions.includes("test"));
  const h = await graph(
    { "src/lib.rs": root.replace("use pm::test;", ""), "src/child.rs": child },
    undefined,
    { "src/child.rs": g.files.find((f) => f.path === "src/child.rs").result },
  );
  h.one("child::f", "f");
  const fixed = h.symbols.find((s) => s.name === "f");
  assert.equal(fixed.data.underOpaqueAttribute, undefined);
  assert.deepEqual(fixed.data.conditions, ["test"]);
});
test("round 11 proc-macro exports are not ordinary function calls", async () => {
  // Native Cargo imports the macro; an ordinary pm::f(...) call is E0423, not a function call.
  const g = await graph(
    {
      "src/lib.rs": "use pm::f;fn run(){pm::f();}",
      "pm/src/lib.rs":
        "use proc_macro::TokenStream;#[proc_macro]pub fn f(input:TokenStream)->TokenStream{input}",
    },
    {
      "Cargo.toml":
        '[workspace]\nmembers=["pm"]\n[package]\nname="app"\nedition="2024"\n[dependencies]\npm={path="pm"}',
      "pm/Cargo.toml":
        '[package]\nname="pm"\nversion="0.1.0"\nedition="2024"\n[lib]\nproc-macro=true',
    },
  );
  g.one("pm::f", "f", "imports");
  g.unknown("pm::f");
});

test("round 11 proc-macro source function facet remains local to its crate", async () => {
  // rustc accepts calling the source function inside its defining proc-macro crate.
  const g = await graph(
    lib(
      "use proc_macro::TokenStream;#[proc_macro]pub fn f(x:TokenStream)->TokenStream{x}fn local(x:TokenStream){f(x);}",
    ),
  );
  g.one("f", "f");
});

test("round 11 inner module attribute sees an enclosing extern alias", async () => {
  const g = await graph(
    lib(
      "extern crate pm as rustfmt;mod m{#![rustfmt::skip]pub fn h()->u8{1}}fn run()->u16{m::h()}",
    ),
  );
  g.unverified("m::h", "m::h");
});

for (const name of ["test", "bench"]) {
  test(`round 11 macro_use can shadow prelude ${name}`, async () => {
    // rustc accepts replacement via macro_use, unlike an ambiguous glob use.
    const g = await graph(
      lib(
        `#[macro_use]extern crate pm;struct A;#[${name}]impl A{pub fn f(self)->u8{1}}fn run(a:A){a.f();}`,
      ),
    );
    g.unverified("a.f", "impl A::f");
    assert.equal(
      g.symbols.find((s) => s.identity === "impl A::f").data
        .underOpaqueAttribute,
      true,
    );
  });
}
test("round 11 named macro_use does not shadow unrelated attributes", async () => {
  const g = await graph(
    lib(
      "#[macro_use(other)]extern crate pm;struct A;#[derive(Debug)]impl A{pub fn f(self)->u8{1}}fn run(a:A){a.f();}",
    ),
  );
  g.one("a.f", "impl A::f");
});
test("known limit E4: uncaptured macro_use does not shadow derive in a foreign module", async () => {
  const g = await graph({
    "src/lib.rs":
      "#[macro_use]extern crate pm;mod child;fn run(a:child::A){a.f();}",
    "src/child.rs":
      "pub struct A;#[derive(Debug)]impl A{pub fn f(self)->u8{1}}",
  });
  g.one("a.f", "impl A::f");
});

test("round 11 unread target identity prevents automatic fallback", async () => {
  const { crates } = await import("../dist/graph/languages/rust/cargo.js");
  for (const target of [
    "bin = false",
    "[[bin]]\nname=false",
    '[[bin]]\nname="app"\npath=false',
  ]) {
    const text =
      '[package]\nname="app"\nedition="2024"\n' +
      (target === "bin = false" ? "[bad]\n" : "") +
      target;
    // Top-level malformed bin shape and malformed fields cannot prove a root.
    const manifest =
      target === "bin = false"
        ? text.replace("[bad]\nbin = false", '[\"bin\"]\nname=false')
        : text;
    assert.equal(
      crates(
        [
          {
            path: "Cargo.toml",
            text: manifest,
            status: "clean",
            hash: "",
            diagnostics: [],
          },
        ],
        new Set(["src/main.rs"]),
      ).length,
      0,
    );
  }
});

test("round 11 tool dependency can shadow registered prefix", async () => {
  // rustc --extern rustfmt=libpm.so expands its skip macro: h returns u16 (2).
  const g = await graph(
    lib("#[rustfmt::skip]pub fn h()->u8{1}fn run()->u16{h()}"),
    { "Cargo.toml": pkg("app") + '[dependencies]\nrustfmt="1"' },
  );
  g.unverified("h", "h");
  assert.ok(
    g.symbols
      .find((s) => s.name === "h")
      .data.opaqueAttributes.includes("rustfmt::skip"),
  );
});
