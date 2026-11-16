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

test("round 7 B1 inaccessible inherent methods cannot prove dot or path calls", async () => {
  // rustc: all three return u16 from Tr, not the inaccessible inherent u8 methods.
  const g = await graph(
    lib(`mod m { pub struct A; impl A { fn f(self)->u8{1} fn g(&self)->u8{1} }
    pub trait Tr { fn f(self)->u16; fn g(&self)->u16; }
    impl Tr for A { fn f(self)->u16{2} fn g(&self)->u16{2} } }
    use m::Tr; fn run(a:m::A,b:&m::A) {a.f(); b.g();} fn path(a:m::A){ m::A::f(a); }`),
  );
  for (const name of ["a.f", "b.g", "m::A::f"]) {
    g.unknown(name);
    const method = name === "b.g" ? "g" : "f";
    for (const ts of g.would(name)) {
      assert.ok(ts.some((s) => s.identity === `m::impl Tr for A::${method}`));
      assert.ok(!ts.some((s) => s.identity === `m::impl A::${method}`));
    }
  }
});
for (const visibility of ["pub(crate)", "pub(super)", "pub(in crate)"]) {
  test(`round 7 B1 ${visibility} inherent methods are accessible`, async () => {
    // rustc: these methods return u8; the restriction permits the crate root.
    const g = await graph(
      lib(
        `mod m { pub struct A; impl A { ${visibility} fn f(self)->u8{1} } } fn run(a:m::A) {a.f();m::A::f(a);} `,
      ),
    );
    g.one("a.f", "m::impl A::f");
    g.one("m::A::f", "m::impl A::f");
  });
}
test("round 7 B1 private inherent members are visible in descendant modules and Self paths", async () => {
  // rustc: private members are accessible to descendants of their defining module.
  const g = await graph(
    lib(
      `mod m { pub struct A; impl A { fn f(self){} fn run(self){ Self::f(self); } } mod child { fn r(a:super::A){a.f();super::A::f(a);} } }`,
    ),
  );
  g.one("a.f", "m::impl A::f");
  g.one("Self::f", "m::impl A::f");
});
test("round 7 B2 let-chain bindings mask outer receivers in later conditions only", async () => {
  // rustc edition 2024: B::f returns u16 in both chains; before/after use A::f.
  const g = await graph(
    lib(`struct A; impl A {fn f(self)->u8{1}} struct B; impl B {fn f(self)->u16{2}}
    fn r(a:A,o:Option<B>){a.f(); if let Some(a)=o && let x=a.f() && x==2u16 {} a.f();}
    fn s(a:A,o:Option<B>){while let Some(a)=o && a.f()==2u16 {} a.f();}`),
  );
  const links = g.links.filter((l) => l.targetName === "a.f");
  assert.deepEqual(
    g.targets("a.f").map((ts) => ts.map((s) => s.identity)),
    [["impl A::f"], [], ["impl A::f"], [], ["impl A::f"]],
  );
  for (const i of [1, 3])
    assert.ok(
      links[i].data.targets.some(
        (id) => g.symbols.find((s) => s.id === id)?.identity === "impl B::f",
      ),
    );
});
test("round 7 B2 binding scopes cover guards closures labels loops and let-else", async () => {
  // Rust Reference names/scopes: patterns bind in arm guards/body, closure body,
  // for body, labelled block after let; let-else is bound after, not in else.
  const g = await graph(
    lib(`fn f(){} struct S{f:fn()} fn r(s:S,o:Option<S>){
    match o { Some(S{f}) if {f();true} => {f();}, _=>{f();} }
    let c=|S{f}:S|{f();}; f(); 'block:{let S{f}=s;f();} f();
    for S{f} in [] {f();} f();
    let Some(S{f})=o else {f();return;}; f();
  }`),
  );
  assert.deepEqual(
    g.targets("f").map((ts) => ts.length),
    [0, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0],
  );
});
const workspace = {
  "Cargo.toml":
    '[workspace]\nmembers=["a","b"]\n[workspace.package]\nedition="2024"\n',
  "a/Cargo.toml": '[package]\nname="a"\nedition.workspace=true\n',
  "b/Cargo.toml": '[package]\nedition="2024"\nname="b"\n',
};
test("round 7 B3 package workspace inheritance cannot accuse unrelated failures", async () => {
  const g = await graph(
    {
      "a/src/lib.rs": "pub struct A; fn f(a:A){ A::from(a); }",
      "b/src/lib.rs": "pub fn broken( {",
    },
    workspace,
  );
  g.unknown("A::from");
  const l = g.links.find((l) => l.targetName === "A::from");
  assert.equal(l.data.cause, undefined);
  assert.ok(!l.data.uncertainty.includes("failed-file"));
});
test("round 7 B3 S1 reachable failures are uncertainty, never inferred invalid-code", async () => {
  const g = await graph(
    {
      "a/src/lib.rs": "pub struct A; fn f(a:A){ A::from(a); }",
      "b/src/lib.rs": "pub fn broken( {",
    },
    {
      ...workspace,
      "a/Cargo.toml":
        workspace["a/Cargo.toml"] + '[dependencies]\nb={path="../b"}\n',
    },
  );
  const l = g.links.find((l) => l.targetName === "A::from");
  assert.equal(l.data.cause, undefined);
  assert.match(l.data.uncertainty, /failed-file-unseen-declarations/);
});
for (const [caller, callee, definite] of [
  ["a", "a", true],
  ["all(a,b)", "a", true],
  ["a", "all(a,b)", false],
  ["a", "not(a)", false],
  ["a", "b", false],
]) {
  test(`round 7 B4 caller cfg ${caller} implies callee ${callee}: ${definite}`, async () => {
    const g = await graph(
      lib(
        `struct A; impl A {#[cfg(${callee})] fn f(&self){} #[cfg(${caller})] fn r(&self){self.f();Self::f(self);}}`,
      ),
    );
    if (definite) {
      g.one("self.f", "impl A::f");
      g.one("Self::f", "impl A::f");
    } else {
      g.unknown("self.f");
      g.unknown("Self::f");
    }
  });
}
test("round 7 B4 inherited module condition is satisfied inside that module", async () => {
  const g = await graph({
    "src/lib.rs": '#[cfg(feature="x")] mod m;',
    "src/m.rs": "mod config;",
    "src/m/config.rs":
      "pub(super) struct Chan; impl Chan {pub(super) fn get(&self)->u8{1} pub(super) fn run(&self)->u8{self.get()} }",
  });
  g.one("self.get", "impl Chan::get");
});
test("round 7 B5 cfg declaration and import alternatives both survive", async () => {
  const g = await graph(
    lib(
      'mod other {pub fn g()->u16{4}} #[cfg(feature="x")] fn g()->u16{1} #[cfg(not(feature="x"))] use other::g; fn run(){g();}',
    ),
  );
  assert.deepEqual(
    g
      .targets("g")[0]
      .map((s) => s.identity)
      .sort(),
    ["g", "other::g"],
  );
});
test("round 7 S2 shared grammar survives 5000 clean parses in one process", async () => {
  for (let i = 0; i < 5000; i++) {
    const r = await rust.parse({
      path: `src/f${i}.rs`,
      text: `pub fn f${i}() {}`,
    });
    assert.equal(r.status, "clean", String(i));
    assert.equal(r.symbols[0].name, `src/f${i}.rs`);
  }
});
test("round 7 S2 real indexer parses a 2500-file project twice without internal errors", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { indexProject, LanguageRegistry, SqliteGraphStore } = await import(
    "../dist/graph/index.js"
  );
  const root = await mkdtemp(join(tmpdir(), "rust-parser-reuse-"));
  const store = new SqliteGraphStore(":memory:", "reuse");
  try {
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "Cargo.toml"),
      '[package]\nedition="2024"\nname="reuse"\n',
    );
    await writeFile(
      join(root, "src/lib.rs"),
      Array.from({ length: 2499 }, (_, i) => `mod f${i};`).join("\n"),
    );
    for (let i = 0; i < 2499; i++)
      await writeFile(join(root, `src/f${i}.rs`), `pub fn f${i}() {}`);
    const registry = new LanguageRegistry([rust]);
    for (let pass = 0; pass < 2; pass++) {
      // Force reparsing in one process, rather than merely reading cached results.
      if (pass)
        for (let i = 0; i < 2499; i++)
          await writeFile(join(root, `src/f${i}.rs`), `\npub fn f${i}() {}`);
      const report = await indexProject(root, registry, store);
      assert.deepEqual(
        [
          ...report.errors,
          ...report.analysisErrors,
          ...report.resolutionErrors,
        ],
        [],
      );
      assert.equal(store.files().length, 2500);
      assert.ok(store.files().every((f) => f.result.status === "clean"));
    }
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("round 7 B3 workspace dependency inheritance follows only captured edges", async () => {
  const { crates } = await import("../dist/graph/languages/rust/cargo.js");
  const manifests = {
    ...workspace,
    "Cargo.toml":
      workspace["Cargo.toml"] +
      '[workspace.dependencies]\nb={path="b"}\nexternal="1"\n',
    "a/Cargo.toml":
      workspace["a/Cargo.toml"] +
      "[dependencies]\nb.workspace=true\nexternal={workspace=true}\n",
  };
  const cs = crates(
    Object.entries(manifests).map(([path, text]) => ({
      path,
      text,
      status: "clean",
      diagnostics: [],
      hash: contentHash(text),
    })),
    new Set(["a/src/lib.rs", "b/src/lib.rs"]),
  );
  assert.ok(cs.every((c) => c.dependencyGraphKnown));
  assert.equal(cs.find((c) => c.name === "a").deps.get("b"), "b/Cargo.toml");
  const g = await graph(
    {
      "a/src/lib.rs": "struct A; impl A{fn f(&self){}} fn run(a:A){a.f();}",
      "b/src/lib.rs": "fn broken( {",
    },
    manifests,
  );
  assert.match(
    g.links.find((l) => l.targetName === "a.f").data.uncertainty,
    /failed-file/,
  );
});
test("round 7 S1 only a traversed failed module is an invalid-code cause", async () => {
  const g = await graph({
    "src/lib.rs":
      "mod broken; mod good; use broken::f as bad; fn r(){broken::f();bad();good::f();missing();}",
    "src/broken.rs": "pub fn f(){let x = ;}",
    "src/good.rs": "pub fn f(){}",
  });
  for (const name of ["broken::f", "bad"]) {
    g.unknown(name);
    const l = g.links.find((l) => l.kind === "calls" && l.targetName === name);
    assert.deepEqual(l.data.cause, { files: ["src/broken.rs"] });
    assert.equal(l.data.uncertainty, "invalid-code");
    assert.equal(l.data.targets, undefined);
  }
  g.one("good::f", "f");
  const l = g.links.find((l) => l.targetName === "missing");
  assert.equal(l.data.cause, undefined);
  assert.equal(l.data.uncertainty, "failed-file-unseen-declarations");
});
test("round 7 B2 nested or patterns and if-let match guards bind within the arm", async () => {
  // rustc: match guard pattern a masks the outer A; or-pattern f is callable binding.
  const g = await graph(
    lib(
      "struct A;impl A{fn f(self){}}fn f(){} fn r(a:A,o:Option<Option<A>>){match o{Some(x) if let Some(a)=x && {a.f();true}=>{a.f();},_=>{a.f();}} match Ok::<_,(fn(),)>((f as fn(),)){Ok((f,))|Err((f,))=>{f();}}}",
    ),
  );
  assert.equal(g.files[0].result.status, "clean");
  assert.deepEqual(
    g.targets("a.f").map((t) => t.length),
    [0, 0, 1],
  );
  g.unknown("f");
});
for (const visibility of ["pub(super)", "pub(in crate::m)"]) {
  test(`round 7 B1 ${visibility} excludes callers outside its boundary`, async () => {
    // rustc returns u16 via Tr: the method is restricted to m and descendants.
    const g = await graph(
      lib(
        `mod m{mod inner{pub struct A;impl A{${visibility} fn f(self)->u8{1}}pub trait Tr{fn f(self)->u16;}impl Tr for A{fn f(self)->u16{2}}}pub use inner::{A,Tr};}use m::Tr;fn r(a:m::A){a.f();m::A::f(a);}`,
      ),
    );
    g.unverified("a.f", "m::inner::impl Tr for A::f");
    g.unverified("m::A::f", "m::inner::impl Tr for A::f");
    for (const ts of [...g.would("a.f"), ...g.would("m::A::f")])
      assert.ok(ts.every((s) => s.identity !== "m::inner::impl A::f"));
  });
}
test("round 7 B1 enum variant paths respect private modules and public reexports", async () => {
  // rustc rejects a::hidden::E::V as private; a::E::V is valid through reexport.
  const g = await graph(
    lib(
      "mod a{mod hidden{pub enum E{V}}pub use hidden::E;}fn r(){let _=a::hidden::E::V;let _=a::E::V;}",
    ),
  );
  g.unknown("a::hidden::E::V", "values");
  g.one("a::E::V", "a::hidden::E::V", "values");
});
test("round 7 B4 caller cfg_attr and callee cfg predicates compare structurally", async () => {
  const g = await graph(
    lib(
      "struct A;impl A{#[cfg(any(not(a),b))]fn f(&self){}#[cfg_attr(a,cfg(b))]fn r(&self){self.f();}}",
    ),
  );
  g.one("self.f", "impl A::f");
});
test("round 7 B5 a conditional import retains its target without proving coverage", async () => {
  const g = await graph(
    lib(
      "mod other{pub fn g(){}}#[cfg(a)]fn g(){}#[cfg(b)]use other::g;fn r(){g();}",
    ),
  );
  g.unknown("g");
  assert.deepEqual(
    g
      .would("g")[0]
      .map((s) => s.identity)
      .sort(),
    ["g", "other::g"],
  );
});
test("round 7 B5 caller condition selects only the active import alternative", async () => {
  const g = await graph(
    lib(
      "mod other{pub fn g(){}}#[cfg(a)]fn g(){}#[cfg(not(a))]use other::g;#[cfg(not(a))]fn r(){g();}",
    ),
  );
  g.one("g", "other::g");
});
test("round 7 B3 known workspace graph does not import an unrelated unresolved impl", async () => {
  // rustc: the type macro expands to b::B; a neither depends on b nor sees its impl.
  const g = await graph(
    {
      "a/src/lib.rs": "struct A;impl A{fn f(){}}fn r(){A::f();}",
      "b/src/lib.rs":
        "struct B;macro_rules! typ{()=>{B}}impl typ!(){pub fn f(){}}",
    },
    workspace,
  );
  assert.ok(g.files.every((f) => f.result.status === "clean"));
  g.one("A::f", "impl A::f");
});
test("round 7 B2 chain and guard initializers still see the outer binding", async () => {
  // rustc: a.f() in the initializer returns u8 from outer A, before a is bound.
  const g = await graph(
    lib(
      "struct A;impl A{fn f(self)->u8{1}}fn r(a:A,o:Option<A>){if let Some(a)=Some(a.f()) && a==1u8 {} match o{Some(x) if let Some(a)=Some(a.f()) && a==1u8=>{},_=>{}}}",
    ),
  );
  g.one("a.f", "impl A::f");
});

test("round 7 S2 internal parser errors are not syntax causes", async () => {
  const g = await graph(
    {
      "src/lib.rs": "mod broken;fn r(){broken::f();}",
      "src/broken.rs": "pub fn f(){}",
    },
    undefined,
    {
      "src/broken.rs": {
        status: "failed",
        symbols: [],
        links: [],
        diagnostics: [
          { message: "Rust parser internal error: injected failure" },
        ],
      },
    },
  );
  g.unknown("broken::f");
  const l = g.links.find((l) => l.targetName === "broken::f");
  assert.equal(l.data.cause, undefined);
  assert.match(l.data.uncertainty, /parser-internal-error/);
});
test("round 7 B2 safety: signature constants cannot acquire a shadowed outer function", async () => {
  // rustc rejects both signature f() calls as non-constant parameter values.
  // Preserve uncertainty; neither may link to the outer const fn.
  const g = await graph(
    lib(
      "const fn f()->usize{1}fn r(f:[u8;f()]){let _=f;}fn s(){let c=|f:fn([u8;f()])|{f([1]);};f();}",
    ),
  );
  assert.deepEqual(
    g.targets("f").map((ts) => ts.map((s) => s.identity)),
    [[], [], [], ["f"]],
  );
});
test("round 7 B3 workspace dependency definitions do not create unused root edges", async () => {
  const g = await graph(
    {
      "src/lib.rs": "struct A;fn r(a:A){A::from(a);}",
      "b/src/lib.rs": "fn broken( {",
    },
    {
      "Cargo.toml":
        '[package]\nedition="2024"\nname="root"\n[workspace]\nmembers=["b"]\n[workspace.dependencies]\nb={path="b"}\n',
      "b/Cargo.toml": '[package]\nedition="2024"\nname="b"\n',
    },
  );
  const l = g.links.find((l) => l.targetName === "A::from");
  assert.equal(l.data.cause, undefined);
  assert.doesNotMatch(l.data.uncertainty, /failed-file/);
});
test("round 7 B4 feature conditions are independent across crates", async () => {
  // rustc: caller feature x enabled, dependency feature x disabled: trait f returns 2.
  const g = await graph(
    {
      "a/src/lib.rs":
        'use b::Tr;#[cfg(feature="x")]fn r(a:&b::A){a.f();b::m::g();}',
      "b/src/lib.rs":
        'pub struct A;#[cfg(feature="x")]impl A{pub fn f(&self)->u8{1}}pub trait Tr{fn f(&self)->u16;}impl Tr for A{fn f(&self)->u16{2}}pub mod m{mod other{pub fn g()->u16{2}}#[cfg(feature="x")]pub fn g()->u8{1}#[cfg(not(feature="x"))]pub use other::g;}',
    },
    {
      ...workspace,
      "a/Cargo.toml":
        workspace["a/Cargo.toml"] + '[dependencies]\nb={path="../b"}',
    },
  );
  g.unverified("a.f", "impl Tr for A::f");
  assert.deepEqual(
    g
      .targets("b::m::g")[0]
      .map((s) => s.identity)
      .sort(),
    ["m::g", "m::other::g"],
  );
});
for (const nested of [false, true]) {
  test(`round 7 B5 opaque dependency fallback retains every known namespace body (${nested})`, async () => {
    // rustc identity proc-attribute control: dep::f returns 2, S is dep::S.
    // An unexpanded attribute could also create a local dep, so these stay unverified.
    const body =
      "#[pm::keep]struct Marker;use dep::S;fn r(_:S){dep::f();let _:dep::S=dep::S;}";
    const g = await graph(
      {
        "src/lib.rs": nested ? `mod user{${body}}` : body,
        "dep/src/lib.rs": "pub struct S;pub fn f()->u8{2}",
      },
      {
        "Cargo.toml":
          '[package]\nedition="2024"\nname="app"\n[dependencies]\ndep={path="dep"}',
        "dep/Cargo.toml": '[package]\nedition="2024"\nname="dep"',
      },
    );
    g.unverified("dep::f", "f");
    for (const kind of ["imports", "types", "values"])
      g.unverified("dep::S", "S", kind);
  });
}
test("round 7 S1 an opaque dependency alternative is not a proved failed-file cause", async () => {
  const manifests = {
    "Cargo.toml":
      '[package]\nedition="2024"\nname="app"\n[dependencies]\ndep={path="dep"}',
    "dep/Cargo.toml": '[package]\nedition="2024"\nname="dep"',
  };
  const g = await graph(
    {
      "src/lib.rs": "#[pm::keep]struct Marker;fn r(){dep::f();}",
      "dep/src/lib.rs": "pub fn broken( {",
    },
    manifests,
  );
  const l = g.links.find((l) => l.targetName === "dep::f");
  g.unknown("dep::f");
  assert.equal(l.data.cause, undefined);
});
test("round 7 B5 unknown dependency binding can also denote a project type", async () => {
  // rustc identity attribute: dep::f => 2; alias-generating attribute: A::f => 3.
  const g = await graph(
    {
      "src/lib.rs":
        "#[pm::alias]struct Marker;struct A;impl A{pub fn f()->u8{3}}fn r(){dep::f();}",
      "dep/src/lib.rs": "pub fn f()->u8{2}",
    },
    {
      "Cargo.toml":
        '[package]\nedition="2024"\nname="app"\n[dependencies]\ndep={path="dep"}',
      "dep/Cargo.toml": '[package]\nedition="2024"\nname="dep"',
    },
  );
  g.unverified("dep::f", "f");
  g.unverified("dep::f", "impl A::f");
});
