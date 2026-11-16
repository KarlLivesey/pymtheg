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

const pkg = (name) =>
  `[package]\nname="${name}"\nedition="2024"\nversion="0.1.0"\n`;
for (const name of ["derive", "global_allocator"]) {
  test(`known limit E4: unseen macro_use exports do not shadow ${name}`, async () => {
    // rustc accepts pm's replacement macro and returns u16 (2). E4 deliberately
    // assumes an UNCAPTURED crate does not bind this head: captured f stays definite.
    const g = await graph(
      lib(
        `#[macro_use]extern crate pm;pub struct A;pub trait Tr{fn f(self)->u16;}#[${name}]impl A{pub fn f(self)->u8{1}}fn run(a:A){a.f();}`,
      ),
    );
    g.one("a.f", "impl A::f");
    assert.equal(
      g.symbols.find((s) => s.identity === "impl A::f").data
        .underOpaqueAttribute,
      undefined,
    );
  });
  test(`E4: named unseen macro_use visibly shadows ${name}`, async () => {
    // rustc accepts the replacement attribute and calls Tr::f (u16), not the input f.
    const g = await graph(
      lib(
        `#[macro_use(${name})]extern crate pm;pub struct A;pub trait Tr{fn f(self)->u16;}impl Tr for A{fn f(self)->u16{2}}#[${name}${name === "derive" ? "(Clone)" : ""}]impl A{pub fn f(self)->u8{1}}pub fn run(a:A)->u16{a.f()}`,
      ),
    );
    g.unverified("a.f", "impl A::f");
    assert.equal(
      g.symbols.find((s) => s.identity === "impl A::f").data
        .underOpaqueAttribute,
      true,
    );
  });
  test(`E4 policy: unseen item output does not shadow ${name}`, async () => {
    // A captured replacement export itself is not assumed to be an expansion.
    const g = await graph(
      lib(
        `make_import!();struct A;#[${name}]impl A{pub fn f(self)->u8{1}}fn run(a:A){a.f();}`,
      ),
    );
    g.one("a.f", "impl A::f");
  });
  test(`E4 explicit captured import still shadows ${name}`, async () => {
    const g = await graph(
      lib(
        `use pm::${name};struct A;#[${name}]impl A{pub fn f(self)->u8{1}}fn run(a:A){a.f();}`,
      ),
    );
    g.unverified("a.f", "impl A::f");
  });
  test(`E4 local macro still shadows ${name}`, async () => {
    const g = await graph(
      lib(
        `macro_rules! ${name}{()=>{}}struct A;#[${name}]impl A{pub fn f(self)->u8{1}}fn run(a:A){a.f();}`,
      ),
    );
    g.unverified("a.f", "impl A::f");
  });
  for (const named of [false, true])
    test(`E4 readable macro_use ${name} named=${named}`, async () => {
      const g = await graph(
        {
          "src/lib.rs": `#[macro_use${named ? "(" + name + ")" : ""}]extern crate pm;struct A;#[${name}]impl A{pub fn f(self)->u8{1}}fn run(a:A){a.f();}`,
          "pm/src/lib.rs": `use proc_macro::TokenStream;#[proc_macro_attribute]pub fn ${name}(_:TokenStream,_:TokenStream)->TokenStream{TokenStream::new()}`,
        },
        {
          "Cargo.toml": pkg("app") + '[dependencies]\npm={path="pm"}\n',
          "pm/Cargo.toml": pkg("pm") + "[lib]\nproc-macro=true",
        },
      );
      g.unverified("a.f", "impl A::f");
      assert.ok(
        g.symbols
          .find((s) => s.identity === "impl A::f")
          .data.opaqueAttributes.includes(name),
      );
    });
  test(`E4 readable crate without ${name} does not shadow it`, async () => {
    const g = await graph(
      {
        "src/lib.rs": `#[macro_use]extern crate pm;struct A;#[${name}]impl A{pub fn f(self)->u8{1}}fn run(a:A){a.f();}`,
        "pm/src/lib.rs":
          "use proc_macro::TokenStream;#[proc_macro_attribute]pub fn other(_:TokenStream,x:TokenStream)->TokenStream{x}",
      },
      {
        "Cargo.toml": pkg("app") + '[dependencies]\npm={path="pm"}\n',
        "pm/Cargo.toml": pkg("pm") + "[lib]\nproc-macro=true",
      },
    );
    g.one("a.f", "impl A::f");
  });
}
for (const name of ["test", "bench"])
  test(`E4 ${name} remains strict for unseen output`, async () => {
    for (const source of ["#[macro_use]extern crate pm;", "make_import!();"]) {
      const g = await graph(
        lib(
          `${source}struct A;#[${name}]impl A{pub fn f(self)->u8{1}}fn run(a:A){a.f();}`,
        ),
      );
      g.unverified("a.f", "impl A::f");
    }
  });
test("E4 captured macro_use named exports reach child modules", async () => {
  const g = await graph(
    {
      "src/lib.rs":
        "#[macro_use]extern crate pm;mod child;fn run(a:child::A){a.f();}",
      "src/child.rs":
        "pub struct A;#[derive(Debug)]impl A{pub fn f(self)->u8{1}}",
      "pm/src/lib.rs":
        "use proc_macro::TokenStream;#[proc_macro_attribute]pub fn derive(_:TokenStream,x:TokenStream)->TokenStream{x}",
    },
    {
      "Cargo.toml": pkg("app") + '[dependencies]\npm={path="pm"}\n',
      "pm/Cargo.toml": pkg("pm") + "[lib]\nproc-macro=true",
    },
  );
  g.unverified("a.f", "impl A::f");
});
test("E4 readable explicit macro reexport counts as a seen export", async () => {
  const g = await graph(
    {
      "src/lib.rs":
        "#[macro_use]extern crate bridge;struct A;#[derive(Debug)]impl A{pub fn f(self)->u8{1}}fn run(a:A){a.f();}",
      "bridge/src/lib.rs": "pub use pm::replace as derive;",
      "pm/src/lib.rs":
        "use proc_macro::TokenStream;#[proc_macro_attribute]pub fn replace(_:TokenStream,x:TokenStream)->TokenStream{x}",
    },
    {
      "Cargo.toml": pkg("app") + '[dependencies]\nbridge={path="bridge"}\n',
      "bridge/Cargo.toml":
        pkg("bridge") + '[dependencies]\npm={path="../pm"}\n',
      "pm/Cargo.toml": pkg("pm") + "[lib]\nproc-macro=true",
    },
  );
  g.unverified("a.f", "impl A::f");
});

for (const name of ["derive", "global_allocator"])
  test(`E4 policy: opaque attribute output does not shadow ${name}`, async () => {
    // Native pm::imports emits an explicit use of its replacement attribute.
    const g = await graph(
      lib(
        `#[pm::imports]struct Marker;struct A;#[${name}]impl A{pub fn f(self)->u8{1}}fn run(a:A){a.f();}`,
      ),
    );
    g.one("a.f", "impl A::f");
  });

test("E4 readable captured glob reexports expose actual macro names", async () => {
  const g = await graph(
    {
      "src/lib.rs":
        "#[macro_use]extern crate bridge;struct A;#[derive(Debug)]impl A{pub fn f(self)->u8{1}}fn run(a:A){a.f();}",
      "bridge/src/lib.rs": "pub use pm::*;",
      "pm/src/lib.rs":
        "use proc_macro::TokenStream;#[proc_macro_attribute]pub fn derive(_:TokenStream,x:TokenStream)->TokenStream{x}",
    },
    {
      "Cargo.toml": pkg("app") + '[dependencies]\nbridge={path="bridge"}\n',
      "bridge/Cargo.toml":
        pkg("bridge") + '[dependencies]\npm={path="../pm"}\n',
      "pm/Cargo.toml": pkg("pm") + "[lib]\nproc-macro=true",
    },
  );
  g.unverified("a.f", "impl A::f");
});

for (const name of ["derive", "global_allocator"])
  test(`E4 raw captured export ${name} is still visible`, async () => {
    const g = await graph(
      {
        "src/lib.rs": `#[macro_use]extern crate pm;struct A;#[${name}]impl A{pub fn f(self)->u8{1}}fn run(a:A){a.f();}`,
        "pm/src/lib.rs": `use proc_macro::TokenStream;#[proc_macro_attribute]pub fn r#${name}(_:TokenStream,x:TokenStream)->TokenStream{x}`,
      },
      {
        "Cargo.toml": pkg("app") + '[dependencies]\npm={path="pm"}\n',
        "pm/Cargo.toml": pkg("pm") + "[lib]\nproc-macro=true",
      },
    );
    g.unverified("a.f", "impl A::f");
  });

for (const route of ["module-glob", "private-alias", "nonexported"])
  test(`E4 captured export graph ${route}`, async () => {
    const main =
      route === "nonexported"
        ? "#[macro_use]extern crate bridge;#[derive(Debug)]struct A;impl A{pub fn f(self)->u8{1}}fn run(a:A){a.f();}"
        : "#[macro_use]extern crate bridge;struct A;#[derive]impl A{pub fn f(self)->u8{1}}fn run(a:A){a.f();}";
    const bridge =
      route === "module-glob"
        ? "pub mod a{pub use pm::derive;}pub use a::*;"
        : route === "private-alias"
          ? "use pm as p;mod a{pub use super::p::*;}pub use a::*;"
          : "pub mod a{pub use pm::derive;}pub mod b{}pub use b::*;";
    const g = await graph(
      {
        "src/lib.rs": main,
        "bridge/src/lib.rs": bridge,
        "pm/src/lib.rs":
          "use proc_macro::TokenStream;#[proc_macro_attribute]pub fn derive(_:TokenStream,x:TokenStream)->TokenStream{x}",
      },
      {
        "Cargo.toml": pkg("app") + '[dependencies]\nbridge={path="bridge"}\n',
        "bridge/Cargo.toml":
          pkg("bridge") + '[dependencies]\npm={path="../pm"}\n',
        "pm/Cargo.toml": pkg("pm") + "[lib]\nproc-macro=true",
      },
    );
    if (route === "nonexported") g.one("a.f", "impl A::f");
    else g.unverified("a.f", "impl A::f");
  });

test("E4 function-local import is not a module export with the same name", async () => {
  const g = await graph(
    {
      "src/lib.rs":
        "#[macro_use]extern crate bridge;#[derive(Debug)]struct A;impl A{pub fn f(self)->u8{1}}fn run(a:A){a.f();}",
      "bridge/src/lib.rs": "fn a(){pub use pm::derive;}mod a{}pub use a::*;",
      "pm/src/lib.rs":
        "use proc_macro::TokenStream;#[proc_macro_attribute]pub fn derive(_:TokenStream,x:TokenStream)->TokenStream{x}",
    },
    {
      "Cargo.toml": pkg("app") + '[dependencies]\nbridge={path="bridge"}\n',
      "bridge/Cargo.toml":
        pkg("bridge") + '[dependencies]\npm={path="../pm"}\n',
      "pm/Cargo.toml": pkg("pm") + "[lib]\nproc-macro=true",
    },
  );
  g.one("a.f", "impl A::f");
});

test("E4 unproven conditional macro export is not absent", async () => {
  // With --cfg feature="enabled", rustc exports this attribute and calls Tr::f (2).
  const g = await graph(
    {
      "src/lib.rs":
        "#[macro_use]extern crate pm;struct A;#[derive]impl A{pub fn f(self)->u8{1}}fn run(a:A){a.f();}",
      "pm/src/lib.rs":
        'use proc_macro::TokenStream;#[cfg_attr(feature="enabled",proc_macro_attribute)]pub fn derive(_:TokenStream,x:TokenStream)->TokenStream{x}',
    },
    {
      "Cargo.toml":
        pkg("app") + '[dependencies]\npm={path="pm",features=["enabled"]}\n',
      "pm/Cargo.toml":
        pkg("pm") + "[lib]\nproc-macro=true\n[features]\nenabled=[]",
    },
  );
  g.unverified("a.f", "impl A::f");
});

test("E4 captured export alias expansion is bounded by import edges", async () => {
  // Semantically invalid self-expansion still must terminate; no elapsed-time assertion.
  const g = await graph(
    {
      "src/lib.rs":
        "#[macro_use]extern crate bridge;struct A;#[derive]impl A{pub fn f(self)->u8{1}}fn run(a:A){a.f();}",
      "bridge/src/lib.rs": "pub use pm::nested as pm;pub use pm::*;",
      "pm/src/lib.rs":
        "use proc_macro::TokenStream;#[proc_macro_attribute]pub fn derive(_:TokenStream,x:TokenStream)->TokenStream{x}",
    },
    {
      "Cargo.toml": pkg("app") + '[dependencies]\nbridge={path="bridge"}\n',
      "bridge/Cargo.toml":
        pkg("bridge") + '[dependencies]\npm={path="../pm"}\n',
      "pm/Cargo.toml": pkg("pm") + "[lib]\nproc-macro=true",
    },
  );
  assert.ok(g.links.length);
});

test("named unseen macro_use(test) is opaque even in cfg(test) caller", async () => {
  // rustc: pm::test can replace this impl; cfg(test) does not prove the input exists.
  const g = await graph(
    lib(
      `#[macro_use(test)]extern crate pm;struct A;#[test]impl A{pub fn f(self)->u8{1}}#[cfg(test)]fn run(a:A){a.f();}`,
    ),
  );
  g.unverified("a.f", "impl A::f");
  assert.equal(
    g.symbols.find((s) => s.identity === "impl A::f").data.underOpaqueAttribute,
    true,
  );
});
test("unsupported TOML datetime leaves inherited edition unverified", async () => {
  const g = await graph(
    {
      "app/src/lib.rs": `mod a{pub fn f()->u16{2}}mod b{mod a{pub fn f()->u8{1}}use a::f;pub fn run(){f();}}`,
    },
    {
      "Cargo.toml":
        '[workspace]\nmembers=["app"]\n[workspace.package]\nedition="2024"\n[workspace.metadata]\ncreated=1979-05-27T07:32:00Z\n',
      "app/Cargo.toml": '[package]\nname="app"\nedition.workspace=true\n',
    },
  );
  g.unknown("f");
  const calls = g.links.filter(
    (l) => l.kind === "calls" && l.targetName === "f",
  );
  assert.ok(calls.length);
  assert.ok(
    calls.every((l) => l.data.uncertainty.includes("edition-unverified")),
  );
});
