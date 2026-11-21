// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { contentHash, fileFacts, validateResult } from "../dist/graph/index.js";
import rust from "../dist/graph/languages/rust/index.js";
import { GraphView } from "../dist/mcp/graph-view.js";
import { macroLock } from "./graph-rust-macro-lock.mjs";

async function observations(text, dependencies = "", support = {}) {
  const path = "src/lib.rs";
  const parts = Object.entries(support);
  const manifest = `[package]\nname="app"\nversion="0.0.0"\nedition="2021"\n[dependencies]\n${dependencies}`;
  return (
    await projectObservations(
      Object.fromEntries([
        [path, text],
        ...parts.filter(([name]) => name.endsWith(".rs")),
      ]),
      manifest,
      parts.filter(([name]) => /Cargo\.(?:toml|lock)$/.test(name)),
    )
  )(path);
}

async function projectObservations(sources, manifest, manifests = []) {
  const projectId = "macro-scope";
  const files = [];
  for (const [path, text] of Object.entries(sources)) {
    const result = await rust.parse({ path, text });
    validateResult(text, result);
    assert.equal(result.status, "clean", JSON.stringify(result.diagnostics));
    files.push({
      path,
      text,
      result,
      module: "rust",
      version: rust.version,
      hash: contentHash(text),
    });
  }
  const contextFiles = [["Cargo.toml", manifest], ...manifests].map(
    ([path, text]) => ({
      path,
      text,
      status: "clean",
      hash: contentHash(text),
      diagnostics: [],
    }),
  );
  const ctx = { projectId, files, contextFiles };
  const analyzed = new Map((await rust.analyze(ctx)).map((f) => [f.path, f]));
  const facts = files.map((file) => {
    file.result = analyzed.get(file.path).result;
    return fileFacts(projectId, file);
  });
  const links = facts.flatMap((file) => file.links);
  const symbols = facts.flatMap((file) => file.symbols);
  const resultSet = await rust.resolve({ ...ctx, links, symbols });
  const decisions = new Map(
    (Array.isArray(resultSet) ? resultSet : resultSet.resolutions).map((d) => [
      d.linkId,
      d,
    ]),
  );
  return (path) => (kind, target, lineMarker) => {
    const text = sources[path];
    const lineStart = text.lastIndexOf("\n", text.indexOf(lineMarker)) + 1;
    const lineEnd = text.indexOf("\n", text.indexOf(lineMarker));
    const link = links.find(
      (l) =>
        l.file === path &&
        l.kind === kind &&
        l.targetName === target &&
        l.range.start >= lineStart &&
        l.range.start < lineEnd,
    );
    assert.ok(link, `${kind} ${target} at ${lineMarker}`);
    const decision = decisions.get(link.id);
    return {
      target:
        decision?.library?.symbol ??
        symbols.find((s) => s.id === decision?.targetId)?.identity ??
        null,
      assumes: link.data?.assumes ?? [],
    };
  };
}

const proved = (target) => ({ target, assumes: [] });
const assumed = (target) => ({ target, assumes: ["rust-external-macro-name"] });

test("Rust macro impls with fixed item boundaries cannot introduce a sibling name", async () => {
  const at = await observations(
    await readFile(
      new URL("fixtures/graph-rust-c34/src/lib.rs", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(
    at("types", "Option", "// generic impls"),
    proved("option::Option"),
  );
  assert.deepEqual(
    at("types", "Option", "// tuple impl"),
    proved("option::Option"),
  );
  for (const marker of [
    "// named sibling",
    "// injected sibling",
    "// opaque separator",
    "// nested export",
    "// exported macro",
  ])
    assert.deepEqual(at("types", "Option", marker), proved(null), marker);
});

test("Rust derive identity follows the macro namespace and its imports", async () => {
  const at = await observations(
    `
    mod trait_import {
      use std::fmt::Debug;
      #[derive(Debug)]
      struct Item;
      fn sibling() -> Option<u8> { None } // trait and derive
    }
    mod type_import {
      mod export { pub struct Debug; }
      use export::Debug;
      #[derive(Debug)]
      struct Item;
      fn sibling() -> Option<u8> { None } // type only
    }
    mod local_glob {
      mod export { pub struct Debug; }
      use export::*;
      #[derive(Debug)]
      struct Item;
      fn sibling() -> Option<u8> { None } // glob has type only
    }
    mod external_import {
      use facade::Debug;
      #[derive(Debug)]
      struct Item;
      fn sibling() -> Option<u8> { None } // foreign explicit derive
    }
  `,
    'facade = "1"',
  );
  for (const marker of [
    "// trait and derive",
    "// type only",
    "// glob has type only",
  ])
    assert.deepEqual(at("types", "Option", marker), proved("option::Option"));
  assert.deepEqual(
    at("types", "Option", "// foreign explicit derive"),
    proved(null),
  );
});

test("standard test and tool attributes have their own lookup rules", async () => {
  const at = await observations(
    `
    mod test_binding {
      macro_rules! test { () => {} }
      #[test]
      fn case() {}
      fn sibling() -> Option<u8> { None } // bang macro named test
    }
    mod test_import {
      use facade::test;
      #[test]
      fn case() {}
      fn sibling() -> Option<u8> { None } // possible external attribute
    }
    mod derive_attribute_import {
      use facade::derive;
      #[derive(Debug)]
      struct Item;
      fn sibling() -> Option<u8> { None } // rebound derive attribute
    }
    mod tool_binding {
      macro_rules! bounded { () => { const OTHER: u8 = 0; } }
      bounded!();
      #[rustfmt::skip]
      struct Item;
      fn sibling() -> Option<u8> { None } // tool name
    }
    mod tool_import {
      use facade as rustfmt;
      #[rustfmt::skip]
      struct Item;
      fn sibling() -> Option<u8> { None } // rebound tool name
    }
  `,
    'facade = "1"',
  );
  assert.deepEqual(
    at("types", "Option", "// bang macro named test"),
    proved("option::Option"),
  );
  assert.deepEqual(
    at("types", "Option", "// possible external attribute"),
    proved(null),
  );
  assert.deepEqual(
    at("types", "Option", "// rebound derive attribute"),
    proved(null),
  );
  assert.deepEqual(
    at("types", "Option", "// tool name"),
    proved("option::Option"),
  );
  assert.deepEqual(at("types", "Option", "// rebound tool name"), proved(null));
});

test("the built-in test attribute is established through a parent glob", async () => {
  const at = await observations(
    `
    mod exported { pub use bangs::test; }
    pub use exported::*;
    mod tests {
      use super::*;
      #[test]
      fn case() {}
      fn sibling() -> Option<u8> { None } // parent glob
    }
    `,
    'bangs = "1"',
  );
  assert.deepEqual(
    at("types", "Option", "// parent glob"),
    proved("option::Option"),
  );
  const files = await projectObservations(
    {
      "src/lib.rs": "pub use bangs::test; mod tests;",
      "src/tests.rs": `
        use super::*;
        #[test]
        fn case() {}
        fn sibling() -> Option<u8> { None } // separate parent glob
      `,
    },
    '[package]\nname="app"\nversion="0.0.0"\nedition="2021"\n[dependencies]\nbangs="1"\n',
  );
  assert.deepEqual(
    files("src/tests.rs")("types", "Option", "// separate parent glob"),
    proved("option::Option"),
  );
});

test("a self-qualified macro can resolve through a captured glob", async () => {
  const at = await observations(`
    mod checks {
      mod exported {
        macro_rules! bounded { () => { const OTHER: u8 = 0; } }
        pub(crate) use bounded as Name;
      }
      use exported::*;
      fn caller() -> u8 {
        self::Name!(); // self-qualified macro
        OTHER
      }
    }
  `);
  assert.deepEqual(
    at("macros", "self::Name", "// self-qualified macro"),
    proved("checks::exported::bounded"),
  );
});

test("an uncaptured glob without an outer macro binding leaves scope open", async () => {
  const at = await observations(
    `
    mod checks {
      use facade::*;
      #[derive(Alternative)]
      struct Item;
      fn sibling() -> Option<u8> { None } // uncaptured glob
    }
  `,
    'facade = "1"',
  );
  assert.deepEqual(at("types", "Option", "// uncaptured glob"), proved(null));
});

test("qualified macros keep the Cargo identity through unrelated globs", async () => {
  const at = await observations(
    `
    mod qualified {
      mod export { pub struct Extra; }
      use export::*;
      fn caller() {
        #[derive(::renamed::Serialize)]
        struct Item;
        let _: Option<u8> = None; // derive across glob
        let _: ItemBuilder; // retains derived-name guard
      }
      fn attribute() {
        #[runtime::test]
        async fn inner() {}
        let _: Option<u8> = None; // attribute across glob
      }
      fn bang() {
        registry::new_key_type! { struct Item; }
        let _: Option<u8> = None; // bang across glob
      }
    }
    mod local_prefix {
      mod renamed { pub struct Serialize; }
      #[derive(renamed::Serialize)]
      struct Item;
      fn sibling() -> Option<u8> { None } // local crate spelling
    }
    mod typo {
      #[derive(::typo::Serialize)]
      struct Item;
      fn sibling() -> Option<u8> { None } // absent Cargo edge
    }
  `,
    'renamed = { package = "serde", version = "1", features = ["derive"] }\nruntime = { package = "tokio", version = "1", features = ["macros", "rt"] }\nregistry = { package = "slotmap", version = "1" }',
    {
      "Cargo.lock": macroLock([
        ["serde", "1.0.229", ["serde_derive", "1.0.229"]],
        ["tokio", "1.54.1", ["tokio-macros", "2.7.2"]],
        ["slotmap", "1.0.7"],
      ]),
    },
  );
  for (const marker of [
    "// derive across glob",
    "// attribute across glob",
    "// bang across glob",
  ])
    assert.deepEqual(at("types", "Option", marker), assumed("option::Option"));
  for (const marker of ["// local crate spelling", "// absent Cargo edge"])
    assert.deepEqual(at("types", "Option", marker), proved(null));
  assert.deepEqual(
    at("types", "ItemBuilder", "// retains derived-name guard"),
    proved(null),
  );
});

test("a captured macro-use reexport has to compete in the attribute namespace", async () => {
  const source = `
    #[macro_use]
    extern crate exports;
    #[derive(Debug)]
    struct Item;
    fn sibling() -> Option<u8> { None } // beside derive
  `;
  const manifest =
    '[package]\nname="exports"\nversion="0.0.0"\nedition="2021"\n';
  const captured = await observations(
    source,
    'exports = { path = "exports" }',
    {
      "exports/Cargo.toml": manifest,
      "exports/src/lib.rs": "#[macro_export] macro_rules! Debug { () => {} }",
    },
  );
  const unknown = await observations(source, 'exports = "1"');
  assert.deepEqual(
    captured("types", "Option", "// beside derive"),
    proved("option::Option"),
  );
  assert.deepEqual(
    unknown("types", "Option", "// beside derive"),
    proved(null),
  );
});

async function tokioMacroOrigin(fixture, options = {}) {
  const directory = new URL(
    `fixtures/graph-rust-macro-identity/${fixture}/`,
    import.meta.url,
  );
  const load = (file) => readFile(new URL(file, directory), "utf8");
  const support = [["Cargo.lock", await load("Cargo.lock")]];
  if (options.config) support.push([".cargo/config.toml", options.config]);
  const file = options.file ?? "src/lib.rs";
  const sources = { [file]: await load("src/lib.rs") };
  if (fixture === "tokio-patched") {
    support.push(["macros/Cargo.toml", await load("macros/Cargo.toml")]);
    sources["macros/src/lib.rs"] = await load("macros/src/lib.rs");
  }
  const manifest = await load("Cargo.toml");
  return (
    await projectObservations(
      sources,
      options.features
        ? manifest.replace('["macros", "rt-multi-thread"]', options.features) +
            (options.devDependencies ?? "")
        : manifest,
      support,
    )
  )(file);
}

test("a renamed Tokio facade needs registry evidence for the macro implementation", async () => {
  const registry = await tokioMacroOrigin("tokio-registry");
  const patched = await tokioMacroOrigin("tokio-patched");
  const configured = await tokioMacroOrigin("tokio-registry", {
    config:
      '[patch.crates-io]\nreplacement = { package = "tokio-macros", path = "macros" }\n',
  });
  for (const marker of [
    "// main by path",
    "// test by import",
    "// test by path",
  ]) {
    assert.deepEqual(
      registry("types", "Option", marker),
      assumed("option::Option"),
    );
    assert.deepEqual(patched("types", "Option", marker), proved(null));
    assert.deepEqual(configured("types", "Option", marker), proved(null));
  }
});

test("written Tokio macro routes retain identity with incomplete feature facts", async () => {
  // With rt alone, this fixture does not compile. The graph assumes written
  // macro paths and named imports compile when registry provenance is known.
  const at = await tokioMacroOrigin("tokio-registry", { features: '["rt"]' });
  assert.deepEqual(
    at("types", "Option", "// test by path"),
    assumed("option::Option"),
  );
  assert.deepEqual(
    at("types", "Option", "// test by import"),
    assumed("option::Option"),
  );
  const options = {
    features: '["rt"]',
    devDependencies:
      '\n[dev-dependencies]\nruntime = {package="tokio", version="=1.54.1", features=["macros"]}\n',
  };
  const normal = await tokioMacroOrigin("tokio-registry", options);
  const test = await tokioMacroOrigin("tokio-registry", {
    ...options,
    file: "tests/runtime.rs",
  });
  assert.deepEqual(
    normal("types", "Option", "// test by path"),
    assumed("option::Option"),
  );
  assert.deepEqual(
    test("types", "Option", "// test by path"),
    assumed("option::Option"),
  );
});

test("an uncatalogued export needs registry provenance through the dependency chain", async () => {
  const source = `
    #[derive(facade::Alternative)]
    struct Item;
    fn sibling() -> Option<u8> { None } // uncatalogued export
  `;
  const registry =
    'source="registry+https://github.com/rust-lang/crates.io-index"\n';
  const lock =
    macroLock([["facade", "1.0.0", ["bridge", "1.0.0"]]]) +
    'dependencies=["implementation"]\n[[package]]\nname="implementation"\nversion="1.0.0"\n';
  const control = await observations(source, 'facade="1"', {
    "Cargo.lock": lock + registry,
  });
  const patched = await observations(source, 'facade="1"', {
    "Cargo.lock": lock,
  });
  assert.deepEqual(
    control("types", "Option", "// uncatalogued export"),
    assumed("option::Option"),
  );
  assert.deepEqual(
    patched("types", "Option", "// uncatalogued export"),
    proved(null),
  );
});

test("the Ratatui bitflags import identifies the namespace of its invocation", async () => {
  const at = await observations(
    `
    use bitflags::bitflags;
    bitflags! {
      #[derive(Default, Clone, Copy, Eq, PartialEq, Hash)]
      pub struct Borders: u8 { const TOP = 1; }
    }
    fn sibling() -> Option<u8> { None } // named bang import
    fn from_macro(_: Borders) {} // name from input
  `,
    'bitflags = "=2.13.2"',
  );
  assert.deepEqual(
    at("types", "Option", "// named bang import"),
    assumed("option::Option"),
  );
  assert.deepEqual(at("types", "Borders", "// name from input"), proved(null));
});

test("the MCP legend describes the restricted Rust macro assumption", () => {
  const view = new GraphView({
    data: {
      links: [{ id: "link", data: { assumes: assumed("outside").assumes } }],
    },
    failedFiles: [],
    staleFiles: [],
    warnings: [],
    modules: [],
    sync: {},
  });
  const [entry] = view.page("legend", 0, 1).items;
  assert.equal(entry.value, "rust-external-macro-name");
  assert.match(entry.description, /must receive an item-name identifier/);
  assert.match(entry.description, /whole case-insensitive components/);
});

async function sharedMacroFixture(name, paths) {
  const dir = new URL(
    `fixtures/graph-rust-macro-scope/${name}/`,
    import.meta.url,
  );
  const sources = Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [
        path,
        await readFile(new URL(path, dir), "utf8"),
      ]),
    ),
  );
  const manifest = await readFile(new URL("Cargo.toml", dir), "utf8");
  return projectObservations(sources, manifest);
}

test("$crate in a macro in a module shared by the library and binary", async () => {
  const at = await sharedMacroFixture("lib-and-bin", [
    "src/lib.rs",
    "src/main.rs",
    "src/shared.rs",
    "src/single_owner.rs",
  ]);
  assert.deepEqual(
    at("src/shared.rs")("types", "Option", "// observed"),
    proved(null),
  );
  assert.deepEqual(
    at("src/single_owner.rs")("types", "Option", "// observed"),
    proved("option::Option"),
  );
});

test("$crate in a macro shared by two integration-test crates", async () => {
  const at = await sharedMacroFixture("integration-tests", [
    "tests/first.rs",
    "tests/second.rs",
    "tests/common/mod.rs",
    "tests/single_owner/mod.rs",
  ]);
  assert.deepEqual(
    at("tests/common/mod.rs")("types", "Option", "// observed"),
    proved(null),
  );
  assert.deepEqual(
    at("tests/single_owner/mod.rs")("types", "Option", "// observed"),
    proved("option::Option"),
  );
});

test("local macro item names include literal and forwarded metavariable names", async () => {
  const at = await observations(
    await readFile(
      new URL("fixtures/graph-rust-macro-scope/src/lib.rs", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(
    at("calls", "outside", "unrelated checkout"),
    proved("outside"),
  );
  assert.deepEqual(
    at("types", "Option", "unrelated library"),
    proved("option::Option"),
  );
  assert.deepEqual(at("types", "Option", "generated type"), proved(null));
  assert.deepEqual(at("calls", "outside", "generated function"), proved(null));
  assert.deepEqual(at("types", "Option", "generated keyword"), proved(null));
  assert.deepEqual(at("types", "Option", "omitted repetition"), proved(null));
  assert.deepEqual(at("calls", "outside", "foreign declaration"), proved(null));
  assert.deepEqual(at("types", "Option", "// absolute include"), proved(null));
  assert.deepEqual(
    at("values", "LAZY", "// wrapped thread-local"),
    proved(null),
  );
  assert.deepEqual(
    at("values", "LAZY", "// direct thread-local"),
    proved(null),
  );
  assert.deepEqual(
    at("types", "Option", "// unrelated thread-local"),
    proved("option::Option"),
  );
  assert.deepEqual(
    at("types", "Option", "// unrelated direct"),
    proved("option::Option"),
  );
  assert.deepEqual(
    at("types", "Option", "// explicit defining crate"),
    proved("option::Option"),
  );
});

test("a file or literal-only external macro input supplies no item-name evidence", async () => {
  const at = await observations(
    `
    mod proto {
      tonic::include_proto!("pkg");
      fn f() -> Option<u8> { None } // proto
    }
    fn sql() {
      sqlx::migrate!();
      let _: Option<u8> = None; // sql
    }
    fn paths() {
      loader::load!(relative/source.rs);
      let _: Option<u8> = None; // path
    }
    fn literals() {
      loader::load!(42, true);
      let _: Option<u8> = None; // literal
    }
  `,
    'tonic="0.14"\nsqlx="0.8"\nloader="1"',
  );
  for (const marker of ["// proto", "// sql", "// path", "// literal"])
    assert.deepEqual(at("types", "Option", marker), proved(null));
});

test("external generator packages stay opaque even with identifier input", async () => {
  const at = await observations(
    `
    mod errors {
      error_chain::error_chain! { errors { BadPath {} } }
      fn generated() -> Result<()> { Ok(()) } // error chain
    }
    mod scaffold {
      uniffi::setup_scaffolding!(Library);
      fn generated() -> Option<u8> { None } // uniffi
    }
    mod bindings {
      wit_bindgen::generate!({ world: Library });
      fn generated() -> Option<u8> { None } // wit
    }
    mod ui {
      slint::include_modules!(Library);
      fn generated() -> Option<u8> { None } // slint
    }
    mod rpc {
      tonic::include_proto!(Library);
      fn generated() -> Option<u8> { None } // tonic
    }
  `,
    'error-chain="0.12"\nuniffi="0.29"\nwit-bindgen="0.51"\nslint="1"\ntonic="0.14"',
  );
  assert.deepEqual(at("types", "Result", "// error chain"), proved(null));
  for (const marker of ["// uniffi", "// wit", "// slint", "// tonic"]) {
    assert.deepEqual(at("types", "Option", marker), proved(null));
  }
});

test("attribute and derive inputs bound whole components of item names", async () => {
  const at = await observations(
    `
    struct ConfigBuilder;
    struct config_builder;
    struct CONFIG_X;
    struct Configuration;
    struct FieldName;
    struct FieldNameBuilder;
    struct VariantNameBuilder;
    fn builders() {
      #[derive(derive_builder::Builder)]
      struct Config { FieldName: u8 }
      let _: ConfigBuilder; // pascal
      let _: config_builder; // snake
      let _: CONFIG_X; // screaming
      let _: Option<u8>; // unrelated
      let _: Configuration; // partial component
      let _: FieldName; // field exact
      let _: FieldNameBuilder; // field suffix
    }
    fn tagged() {
      #[serde_with::serde_as]
      enum Config { VariantName }
      let _: ConfigBuilder; // attr generated
      let _: VariantNameBuilder; // attr variant suffix
    }
  `,
    'derive_builder="0.20"\nserde_with={version="3",features=["macros"]}',
    {
      "Cargo.lock": macroLock([
        ["derive_builder", "0.20.2", ["derive_builder_macro", "0.20.2"]],
        ["serde_with", "3.17.0", ["serde_with_macros", "3.17.0"]],
      ]),
    },
  );
  assert.deepEqual(at("types", "ConfigBuilder", "// pascal"), proved(null));
  assert.deepEqual(at("types", "config_builder", "// snake"), proved(null));
  assert.deepEqual(at("types", "CONFIG_X", "// screaming"), proved(null));
  assert.deepEqual(
    at("types", "Option", "// unrelated"),
    assumed("option::Option"),
  );
  assert.deepEqual(
    at("types", "Configuration", "// partial component"),
    assumed("Configuration"),
  );
  assert.deepEqual(at("types", "FieldName", "// field exact"), proved(null));
  assert.deepEqual(
    at("types", "FieldNameBuilder", "// field suffix"),
    assumed("FieldNameBuilder"),
  );
  assert.deepEqual(
    at("types", "ConfigBuilder", "// attr generated"),
    proved(null),
  );
  assert.deepEqual(
    at("types", "VariantNameBuilder", "// attr variant suffix"),
    assumed("VariantNameBuilder"),
  );
});

test("standard expression macros have no output items, but include stays opaque", async () => {
  const at = await observations(`
    fn pure() {
      std::concat!("a", "b");
      include_str!("notes.txt");
      let _: Option<u8> = None; // proven
    }
    fn included() {
      include!("items.rs");
      let _: Option<u8> = None; // opaque
    }
  `);
  assert.deepEqual(
    at("types", "Option", "// proven"),
    proved("option::Option"),
  );
  assert.deepEqual(at("types", "Option", "// opaque"), proved(null));
});

test("external macros recover unrelated names with an assumption, but keep competing input names and globs", async () => {
  const at = await observations(
    `
    fn outside() {}
    fn call() {
      // The key-item macro also occurs in Helix's workspace.
      slotmap::new_key_type! { struct CursorKey; }
      outside(); // checkout
      let _: Option<u8> = None; // library
    }
    fn generated() {
      slotmap::new_key_type! { struct Option; }
      let _: Option; // input
    }
    mod glob {
      use slotmap::*;
      slotmap::new_key_type! { struct CursorKey; }
      fn missing() -> Option<u8> { None } // glob
    }
    mod generated_modules {
      automod::dir!("src/modules");
      fn missing() -> Option<u8> { None } // layout
    }
    mod forwarded_glob {
      cfg_if::cfg_if! { if #[cfg(unix)] { use slotmap::*; } }
      fn missing() -> Option<u8> { None } // input glob
    }
    mod generated_names {
      use paste::paste as build;
      build! { struct [<Opt ion>]; }
      fn missing() -> Option { Option } // pasted
    }
  `,
    'slotmap="1"\nautomod="1"\npaste="1"\ncfg-if="1"',
  );
  assert.deepEqual(at("calls", "outside", "// checkout"), assumed("outside"));
  assert.deepEqual(
    at("types", "Option", "// library"),
    assumed("option::Option"),
  );
  assert.deepEqual(at("types", "Option", "// input"), proved(null));
  assert.deepEqual(at("types", "Option", "// glob"), proved(null));
  assert.deepEqual(at("types", "Option", "// layout"), proved(null));
  assert.deepEqual(at("types", "Option", "// input glob"), proved(null));
  assert.deepEqual(at("types", "Option", "// pasted"), proved(null));
});

test("attribute inputs include the full item and derive inputs include the type", async () => {
  const at = await observations(
    `
    mod wrapper {
      #[tokio::main]
      async fn start() { let _: Option<u8> = None; } // inside
      fn outside() -> Result<(), ()> { Ok(()) } // outside
      fn same_name() -> Option<u8> { None } // also in input
    }
    mod derives {
      #[derive(Clone, serde::Serialize)]
      struct Records;
      fn len(_: Records) -> Option<u8> { None } // mixed derive
    }
  `,
    'tokio={version="1",features=["macros","rt-multi-thread"]}\nserde={version="1",features=["derive"]}',
    {
      "Cargo.lock": macroLock([
        ["tokio", "1.54.1", ["tokio-macros", "2.7.2"]],
        ["serde", "1.0.229", ["serde_derive", "1.0.229"]],
      ]),
    },
  );
  assert.deepEqual(at("types", "Option", "// inside"), proved(null));
  assert.deepEqual(
    at("types", "Result", "// outside"),
    assumed("result::Result"),
  );
  assert.deepEqual(at("types", "Option", "// also in input"), proved(null));
  assert.deepEqual(
    at("types", "Records", "// mixed derive"),
    proved("derives::Records"),
  );
  assert.deepEqual(
    at("types", "Option", "// mixed derive"),
    assumed("option::Option"),
  );
});
