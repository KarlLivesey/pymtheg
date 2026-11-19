// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  fileFacts,
  contentHash,
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
  validateResult,
} from "../dist/graph/index.js";
import rust from "../dist/graph/languages/rust/index.js";

const manifest = (edition = "2021", body = "") =>
  `[package]\nname="app"\nversion="0.1.0"\nedition="${edition}"\n${body}`;
async function graph(sources, manifests = { "Cargo.toml": manifest() }) {
  const files = await Promise.all(
    Object.entries(sources).map(async ([path, text]) => {
      const result = await rust.parse({ path, text });
      validateResult(text, result);
      assert.equal(result.status, "clean", JSON.stringify(result.diagnostics));
      return {
        path,
        text,
        result,
        hash: contentHash(text),
        module: "rust",
        version: rust.version,
      };
    }),
  );
  const contextFiles = Object.entries(manifests).map(([path, text]) => ({
    path,
    text,
    hash: contentHash(text),
    status: "clean",
    diagnostics: [],
  }));
  const ctx = { projectId: "library", files, contextFiles };
  for (const { path, result } of await rust.analyze(ctx)) {
    files.find((f) => f.path === path).result = result;
  }
  const facts = files.map((f) => fileFacts(ctx.projectId, f));
  const links = facts.flatMap((f) => f.links);
  const symbols = facts.flatMap((f) => f.symbols);
  const result = await rust.resolve({ ...ctx, symbols, links });
  const decisions = new Map(
    (Array.isArray(result) ? result : result.resolutions).map((d) => [
      d.linkId,
      d,
    ]),
  );
  return (kind, name) => {
    const sites = links.filter((l) => l.kind === kind && l.targetName === name);
    assert.ok(sites.length, `${kind}: ${name}`);
    return sites.map((l) => {
      const decision = decisions.get(l.id);
      return (
        decision?.library ??
        symbols.find((s) => s.id === decision?.targetId)?.identity ??
        null
      );
    });
  };
}

async function indexFixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), "pymtheg-rust-library-"));
  const store = new SqliteGraphStore(":memory:", "library-fixture");
  const dirs = new Set([root]);
  const written = [];
  t.after(async () => {
    store.close();
    for (const file of written) await unlink(file);
    for (const dir of [...dirs].reverse()) await rmdir(dir);
  });
  for (const [relative, content] of Object.entries(files)) {
    const segments = relative.split("/");
    for (let i = 1; i < segments.length; i++) {
      const dir = join(root, ...segments.slice(0, i));
      if (dirs.has(dir)) continue;
      await mkdir(dir);
      dirs.add(dir);
    }
    const file = join(root, relative);
    assert.ok(dirs.has(dirname(file)));
    await writeFile(file, content);
    written.push(file);
  }
  const report = await indexProject(root, new LanguageRegistry([rust]), store);
  assert.deepEqual(
    [...report.errors, ...report.analysisErrors, ...report.resolutionErrors],
    [],
  );
  return store;
}

test("library paths, imports, preludes, Cargo aliases and version sources", async () => {
  const lookup = await graph(
    {
      "src/lib.rs": `
    use std::collections::HashMap;
    use serialization::Serialize;
    extern crate any_how as errors;
    // From ripgrep, crates/ignore/src/gitignore.rs.
    use regex_automata::{meta::Regex, util::syntax};
    fn bounds<T: Serialize + TryInto<u8>>() {}
    fn run() {
      let mut map = HashMap::new();
      std::mem::swap(&mut map, &mut HashMap::new());
      let vector: Vec<u8> = vec![1];
      println!("hi");
      drop(Some(vector));
      let _ = <u8 as Into<u32>>::into(1);
    }
    fn fail() -> Result<(), errors::Error> { let _ = errors::bail!("missing"); Ok(()) }
    mod with_derive {
      use serialization::Serialize;
      #[derive(Serialize)]
      struct Example;
    }
    mod with_attribute {
      #[tokio::main]
      async fn main() {}
    }
  `,
    },
    {
      "Cargo.toml": manifest(
        "2021",
        `
    [dependencies]
    serialization={package="serde",version="=1.0.219",features=["derive"]}
    any-how={package="anyhow",version="1"}
    regex-automata="0.4"
    tokio={version="1",features=["macros","rt-multi-thread"]}
  `,
      ),
    },
  );
  const standard = (symbol, evidence) => ({
    ecosystem: "rust-std",
    unit: "std",
    symbol,
    evidence,
  });
  assert.deepEqual(lookup("imports", "std::collections::HashMap"), [
    standard("collections::HashMap", "qualified-path"),
  ]);
  assert.deepEqual(
    lookup("calls", "HashMap::new"),
    Array(2).fill(standard("collections::HashMap::new", "import-binding")),
  );
  assert.deepEqual(lookup("calls", "std::mem::swap"), [
    standard("mem::swap", "qualified-path"),
  ]);
  assert.deepEqual(lookup("types", "Vec"), [
    standard("vec::Vec", "declared-builtin"),
  ]);
  assert.deepEqual(lookup("calls", "Some"), [
    standard("option::Option::Some", "declared-builtin"),
  ]);
  assert.deepEqual(lookup("calls", "drop"), [
    standard("mem::drop", "declared-builtin"),
  ]);
  assert.deepEqual(lookup("calls", "<u8asInto<u32>>::into"), [
    standard("convert::Into::into", "explicit-trait"),
  ]);
  assert.deepEqual(lookup("macros", "println"), [
    standard("println!", "declared-builtin"),
  ]);
  assert.deepEqual(lookup("macros", "vec"), [
    standard("vec!", "declared-builtin"),
  ]);
  assert.deepEqual(lookup("macros", "errors::bail"), [
    {
      ecosystem: "cargo",
      unit: "anyhow",
      symbol: "bail!",
      evidence: "import-binding",
    },
  ]);
  assert.deepEqual(lookup("imports", "any_how"), [
    { ecosystem: "cargo", unit: "anyhow", evidence: "import-path" },
  ]);
  assert.deepEqual(lookup("imports", "regex_automata::meta::Regex"), [
    {
      ecosystem: "cargo",
      unit: "regex-automata",
      symbol: "meta::Regex",
      evidence: "qualified-path",
    },
  ]);
  const serde = (symbol) => ({
    ecosystem: "cargo",
    unit: "serde",
    symbol,
    version: "1.0.219",
    versionSource: "Cargo.toml",
    evidence: "import-binding",
  });
  assert.deepEqual(lookup("types", "Serialize"), [serde("Serialize")]);
  assert.deepEqual(lookup("macros", "Serialize"), [
    serde("#[derive(Serialize)]"),
  ]);
  assert.deepEqual(lookup("macros", "tokio::main"), [
    {
      ecosystem: "cargo",
      unit: "tokio",
      symbol: "#[main]",
      evidence: "qualified-path",
    },
  ]);
  assert.deepEqual(lookup("types", "TryInto"), [
    standard("convert::TryInto", "declared-builtin"),
  ]);
});

test("extension methods, a type alias, and a local enum do not become library member links", async () => {
  const fixture = new URL("./fixtures/graph-rust-library/", import.meta.url);
  const text = await readFile(new URL("src/lib.rs", fixture), "utf8");
  const cargo = await readFile(new URL("Cargo.toml", fixture), "utf8");
  const lookup = await graph({ "src/lib.rs": text }, { "Cargo.toml": cargo });
  assert.deepEqual(lookup("calls", "std::path::Path::into"), [null]);
  assert.deepEqual(lookup("calls", "path.into"), [null]);
  assert.deepEqual(lookup("calls", "keccak::State1600::iter"), [null]);
  assert.deepEqual(lookup("calls", "state.iter"), [null]);
  assert.deepEqual(lookup("calls", "RopeSlice::starts_with"), [null]);
  assert.deepEqual(lookup("calls", "self.chars"), [null]);
  assert.deepEqual(lookup("calls", "query"), [null]);
  assert.deepEqual(lookup("types", "Error"), ["error_shape::Error"]);
  assert.deepEqual(lookup("values", "Error::Missing"), [
    "error_shape::Error::Missing",
  ]);
});

test("prelude credit requires the edition and a clear lexical namespace", async () => {
  const older = await graph(
    { "src/lib.rs": "fn f<T: TryInto<u8>>() {}" },
    { "Cargo.toml": manifest("2018") },
  );
  assert.deepEqual(older("types", "TryInto"), [null]);
  const lookup = await graph(
    {
      "src/lib.rs": `
    mod local {
      struct Vec;
      fn f(_: Vec) { let Some = |x:u8| x; Some(1); }
    }
    mod glob {
      use serde::*;
      fn f(_: Option<u8>) {}
    }
    mod opaque {
      unknown!();
      fn f(_: String) { println!("unknown"); }
    }
    mod configured {
      #[cfg(feature="x")]
      struct Box;
      fn f(_: Box<u8>) {}
    }
    mod type_alias {
      type FilePath = std::path::Path;
      fn f() { FilePath::new("file"); }
    }
  `,
    },
    { "Cargo.toml": manifest("2024", '[dependencies]\nserde="1"\n') },
  );
  assert.deepEqual(lookup("types", "Vec"), ["local::Vec"]);
  assert.deepEqual(lookup("calls", "Some"), [null]);
  for (const name of ["Option", "String", "Box"])
    assert.deepEqual(lookup("types", name), [null]);
  assert.deepEqual(lookup("macros", "println"), [null]);
  assert.deepEqual(lookup("calls", "FilePath::new"), [null]);
  for (const attribute of ["no_std", "no_implicit_prelude"]) {
    const configured = await graph({
      "src/lib.rs": `#![${attribute}]\nfn f(_: Option<u8>) {}`,
    });
    assert.deepEqual(configured("types", "Option"), [null]);
  }
});

test("workspace dependencies select versions only on a proven Cargo edge", async () => {
  const sources = {
    "app/src/lib.rs":
      "fn bound<T: Serial::Serialize>() {} fn f() { helper::local(); }",
    "helper/src/lib.rs": "pub fn local() {}",
  };
  const manifests = {
    "Cargo.toml": `[workspace]\nmembers=["app", "helper"]\n[workspace.dependencies]\nSerial={package="serde",version="1"}`,
    "app/Cargo.toml": manifest(
      "2024",
      `[dependencies]\nSerial={workspace=true}\nhelper={path="../helper"}`,
    ),
    "helper/Cargo.toml": manifest().replace('"app"', '"helper"'),
  };
  const source = "registry+https://github.com/rust-lang/crates.io-index";
  const lockfile = (edges) => `version=4
    [[package]]
    name="app"
    version="0.1.0"
    dependencies=${JSON.stringify(edges)}
    [[package]]
    name="serde"
    version="1.0.218"
    source="${source}"
    [[package]]
    name="serde"
    version="1.0.219"
    source="${source}"
  `;
  const named = {
    ecosystem: "cargo",
    unit: "serde",
    symbol: "Serialize",
    evidence: "qualified-path",
  };
  const first = await graph(sources, {
    ...manifests,
    "Cargo.lock": lockfile(["serde 1.0.219"]),
  });
  assert.deepEqual(first("types", "Serial::Serialize"), [
    { ...named, version: "1.0.219", versionSource: "Cargo.lock" },
  ]);
  assert.deepEqual(first("calls", "helper::local"), ["local"]);
  const both = await graph(sources, {
    ...manifests,
    "Cargo.lock": lockfile(["serde 1.0.218", "serde 1.0.219"]),
  });
  assert.deepEqual(both("types", "Serial::Serialize"), [named]);
});

test("sysroot names keep their written crate and a no_std crate withholds the std prelude", async () => {
  const lookup = await graph({
    "src/lib.rs": `#![no_std]
    extern crate alloc as heap;
    fn f(_: Option<heap::vec::Vec<u8>>, x: &mut u8, y: &mut u8) { core::mem::swap(x, y); }
  `,
  });
  assert.deepEqual(lookup("types", "Option"), [null]);
  assert.deepEqual(lookup("types", "heap::vec::Vec"), [
    {
      ecosystem: "rust-std",
      unit: "alloc",
      symbol: "vec::Vec",
      evidence: "import-binding",
    },
  ]);
  assert.deepEqual(lookup("calls", "core::mem::swap"), [
    {
      ecosystem: "rust-std",
      unit: "core",
      symbol: "mem::swap",
      evidence: "qualified-path",
    },
  ]);
});

test("exact library queries include imports and invocations of known macros", async (t) => {
  const store = await indexFixture(t, {
    "src/lib.rs": `
    // From RustCrypto/hashes, sha1/src/compress/loongarch64_asm.rs.
    use core::arch::asm;
    use core::assert_eq as check;
    // As in Serde's derive crate, import through an explicit crate binding.
    extern crate syn;
    use syn::parse_macro_input as parse;
    use thiserror::Error as Query;
    use unknown::Export;
    fn assembly() { unsafe { let _ = asm!("nop"); } }
    fn parse(input: proc_macro::TokenStream) { let _ = parse!(input as syn::DeriveInput); }
    fn check() { let _ = check!(1, 1); }
    mod mixed {
      use core::panic;
      fn panic() { let _ = core::panic!("example"); }
    }
    mod derived {
      use thiserror::Error as Query;
      #[derive(Query)]
      struct Example;
    }
    mod attributed {
      use tokio::main as launch;
      #[launch]
      async fn entry() {}
    }
  `,
    "Cargo.toml": manifest(
      "2024",
      '[dependencies]\nsyn="3"\nthiserror="2"\ntokio={version="1",features=["macros","rt-multi-thread"]}\nunknown="1"\n',
    ),
  });
  for (const [unit, symbol, expected] of [
    ["core", "arch::asm!", ["imports", "macros"]],
    ["core", "assert_eq!", ["imports", "macros"]],
    ["core", "panic!", ["macros"]],
    ["core", "panic", []],
    ["syn", "parse_macro_input!", ["imports", "macros"]],
    ["thiserror", "#[derive(Error)]", ["imports", "imports", "macros"]],
    ["tokio", "#[main]", ["imports", "macros"]],
    ["unknown", "Export", []],
  ]) {
    assert.deepEqual(
      store
        .libraryUses(unit, symbol, 10)
        .map(({ kind }) => kind)
        .sort(),
      expected,
      `${unit} ${symbol}`,
    );
    assert.deepEqual(store.libraryUseCounts(unit, symbol), {
      library: expected.length,
      candidateSet: 0,
    });
  }
});

test("opaque module items cannot replace a known explicit import in its namespace", async () => {
  const lookup = await graph({
    "src/lib.rs": `
    mod explicit {
      use std::collections::HashMap;
      macro_rules! items { () => { fn other() {} }; }
      items!();
      fn yes(_: HashMap<String, String>) {}
      fn block() {
        macro_rules! inner { () => { struct HashMap; }; }
        inner!();
        let _: HashMap;
      }
    }
    mod glob {
      use std::collections::*;
      macro_rules! items { () => { struct HashMap; }; }
      items!();
      fn no(_: HashMap) {}
    }
  `,
  });
  assert.deepEqual(lookup("types", "HashMap"), [
    {
      ecosystem: "rust-std",
      unit: "std",
      symbol: "collections::HashMap",
      evidence: "import-binding",
    },
    null,
    null,
  ]);
  assert.deepEqual(
    lookup("types", "String"),
    Array(2).fill({
      ecosystem: "rust-std",
      unit: "std",
      symbol: "string::String",
      evidence: "declared-builtin",
    }),
  );
});

test("a directory source resolves a versioned vendor crate and withholds an uncaptured one", async (t) => {
  const config =
    '[source.crates-io]\nreplace-with="vendored-sources"\n[source.vendored-sources]\ndirectory="vendor"\n';
  const store = await indexFixture(t, {
    "Cargo.toml": manifest("2021", '[dependencies]\nitoa="1"\nmissing="1"\n'),
    "Cargo.lock": `version=4
      [[package]]
      name="app"
      version="0.1.0"
      dependencies=["itoa", "missing"]
      [[package]]
      name="itoa"
      version="1.0.18"
      source="registry+https://github.com/rust-lang/crates.io-index"
      [[package]]
      name="missing"
      version="1.0.0"
      source="registry+https://github.com/rust-lang/crates.io-index"
    `,
    "src/lib.rs": "fn f(_: itoa::Buffer, _: missing::Type) {}",
    "vendor/itoa-1.0.18/src/lib.rs": "pub struct Buffer;",
    ".cargo/config.toml": config,
    "vendor/itoa-1.0.18/Cargo.toml":
      '[package]\nname="itoa"\nversion="1.0.18"\nedition="2021"\n',
  });
  const types = store.links().filter(({ kind }) => kind === "types");
  const buffer = types.find(({ targetName }) => targetName === "itoa::Buffer");
  assert.equal(buffer.resolution, "resolved");
  assert.equal(store.findSymbols({ name: "Buffer" })[0].id, buffer.targetId);
  assert.equal(
    types.find(({ targetName }) => targetName === "missing::Type").resolution,
    "unresolved",
  );
});

test("Cargo vendor uses the locked Git source and selector", async (t) => {
  const git = "https://github.com/dtolnay/itoa";
  const tag = `git+${git}?tag=1.0.18`;
  const branch = `git+${git}?branch=other`;
  const hash = "1234567890abcdef1234567890abcdef12345678";
  const store = await indexFixture(t, {
    "Cargo.toml": manifest(
      "2021",
      `
      [dependencies]
      itoa = { git = "${git}.git/", tag = "1.0.18" }
      other = { package = "itoa", git = "${git}", branch = "other" }
      missing = { git = "${git}", tag = "1.0.18" }
      unlocked = { git = "${git}", tag = "1.0.18", version = "=1.0.18" }
    `,
    ),
    ".cargo/config.toml": `
      [source."${tag}"]
      git = "${git}"
      tag = "1.0.18"
      replace-with = "vendored-sources"
      [source.vendored-sources]
      directory = "vendor"
    `,
    "Cargo.lock": `version = 4
      [[package]]
      name = "app"
      version = "0.1.0"
      dependencies = ["itoa 1.0.18 (${tag})", "itoa 1.0.18 (${branch})", "missing"]
      [[package]]
      name = "itoa"
      version = "1.0.18"
      source = "${tag}#${hash}"
      [[package]]
      name = "itoa"
      version = "1.0.18"
      source = "${branch}#${hash}"
      [[package]]
      name = "missing"
      version = "1.0.18"
      source = "${tag}#${hash}"
    `,
    "src/lib.rs":
      "fn f(_: itoa::Buffer, _: other::Buffer, _: missing::Type, _: unlocked::Type) {}",
    "vendor/itoa/Cargo.toml":
      '[package]\nname="itoa"\nversion="1.0.18"\nedition="2021"\n',
    "vendor/itoa/src/lib.rs": "pub struct Buffer;",
    "vendor/unlocked/Cargo.toml":
      '[package]\nname="unlocked"\nversion="1.0.18"\nedition="2021"\n',
    "vendor/unlocked/src/lib.rs": "pub struct Type;",
  });
  const links = new Map(
    store
      .links()
      .filter(({ kind }) => kind === "types")
      .map((link) => [link.targetName, link]),
  );
  assert.equal(
    links.get("itoa::Buffer").targetId,
    store.findSymbols({ name: "Buffer" })[0].id,
  );
  assert.equal(links.get("other::Buffer").resolution, "library");
  assert.equal(links.get("missing::Type").resolution, "unresolved");
  assert.equal(links.get("unlocked::Type").resolution, "unresolved");
});

test("directory replacement tracks the alternate registry index and lock version", async (t) => {
  const index = "sparse+https://packages.example/index/";
  const store = await indexFixture(t, {
    "Cargo.toml": manifest(
      "2021",
      `
      [dependencies]
      chosen = { registry = "alternate", version = "1" }
      missing = { registry = "alternate", version = "1" }
      external = "1"
    `,
    ),
    ".cargo/config.toml": `
      [registries.alternate]
      index = "${index}"
      [source."${index}"]
      registry = "${index}"
      replace-with = "vendored-sources"
      [source.vendored-sources]
      directory = "vendor"
    `,
    "Cargo.lock": `version = 4
      [[package]]
      name = "app"
      version = "0.1.0"
      dependencies = ["chosen", "missing"]
      [[package]]
      name = "chosen"
      version = "1.0.2"
      source = "${index}"
      [[package]]
      name = "missing"
      version = "1.0.2"
      source = "registry+https://github.com/rust-lang/crates.io-index"
    `,
    "src/lib.rs":
      "fn f(_: chosen::Correct, _: missing::Wrong, _: external::Export) {}",
    "vendor/chosen/Cargo.toml":
      '[package]\nname="chosen"\nversion="1.0.2"\nedition="2021"\n',
    "vendor/chosen/src/lib.rs": "pub struct Correct;",
    "vendor/chosen-older/Cargo.toml":
      '[package]\nname="chosen"\nversion="1.0.1"\nedition="2021"\n',
    "vendor/chosen-older/src/lib.rs": "pub struct Correct;",
    "vendor/missing/Cargo.toml":
      '[package]\nname="missing"\nversion="1.0.2"\nedition="2021"\n',
    "vendor/missing/src/lib.rs": "pub struct Wrong;",
  });
  const links = new Map(
    store
      .links()
      .filter(({ kind }) => kind === "types")
      .map((link) => [link.targetName, link]),
  );
  const correct = store
    .findSymbols({ name: "Correct" })
    .find(({ file }) => file === "vendor/chosen/src/lib.rs");
  assert.equal(links.get("chosen::Correct").targetId, correct.id);
  assert.equal(links.get("missing::Wrong").resolution, "unresolved");
  assert.equal(links.get("external::Export").resolution, "library");
});

test("an independent type reference is credited without claiming its unproven associated member", async () => {
  const lookup = await graph(
    {
      "src/lib.rs":
        'use serde_test::Token; fn token() -> Token { Token::Str("sample") }',
    },
    { "Cargo.toml": manifest("2021", '[dependencies]\nserde_test="1"\n') },
  );
  assert.deepEqual(lookup("types", "Token"), [
    {
      ecosystem: "cargo",
      unit: "serde_test",
      symbol: "Token",
      evidence: "import-binding",
    },
  ]);
  assert.deepEqual(lookup("calls", "Token::Str"), [null]);
});

test("workspace overrides only withhold the named dependency", async () => {
  for (const override of [
    '[patch.crates-io]\npatched={path="../unreadable"}\n',
    '[replace]\n"https://github.com/rust-lang/crates.io-index#patched@1.0.0"={path="../unreadable"}\n',
  ]) {
    const lookup = await graph(
      {
        "src/lib.rs":
          "fn f(_: other::Type, _: patched::Type, _: std::path::PathBuf) {}",
      },
      {
        "Cargo.toml": manifest(
          "2021",
          '[workspace]\n[dependencies]\nother="1"\npatched="1"\n' + override,
        ),
      },
    );
    assert.deepEqual(lookup("types", "other::Type"), [
      {
        ecosystem: "cargo",
        unit: "other",
        symbol: "Type",
        evidence: "qualified-path",
      },
    ]);
    assert.deepEqual(lookup("types", "patched::Type"), [null]);
    assert.deepEqual(lookup("types", "std::path::PathBuf"), [
      {
        ecosystem: "rust-std",
        unit: "std",
        symbol: "path::PathBuf",
        evidence: "qualified-path",
      },
    ]);
  }
});
