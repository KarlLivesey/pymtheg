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
import { macroLock } from "./graph-rust-macro-lock.mjs";

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

test("core inherent dot calls need a proven receiver and first probe", async () => {
  const fixture = new URL("./fixtures/rust-c31/", import.meta.url);
  const source = await readFile(new URL("src/lib.rs", fixture), "utf8");
  const cargo = await readFile(new URL("Cargo.toml", fixture), "utf8");
  const lookup = await graph({ "src/lib.rs": source }, { "Cargo.toml": cargo });
  for (const [call, symbol] of [
    ["read(&[]).unwrap", "option::Option::unwrap"],
    ["write().unwrap", "result::Result::unwrap"],
    ["borrowed.is_some", "option::Option::is_some"],
    ["text.len", "str::len"],
    ['r"words".as_bytes', "str::as_bytes"],
    ["'a'.is_alphabetic", "char::is_alphabetic"],
    ["2u32.pow", "u32::pow"],
    ["count.to_le_bytes", "u32::to_le_bytes"],
    ["text.parse", "str::parse"],
    ['"standard".len', "str::len"],
    ['"core".len', "str::len"],
    ["value.unwrap", "option::Option::unwrap"],
  ])
    assert.deepEqual(
      lookup("calls", call),
      [
        {
          ecosystem: "rust-std",
          unit: "core",
          symbol,
          evidence: "declaring-owner",
        },
      ],
      call,
    );
  assert.equal(lookup("calls", "custom.unwrap")[0]?.unit, undefined);
  for (const call of [
    "changed.len",
    "text.parse().unwrap",
    '"words".to_string',
    'b"words".len',
    'br"words".len',
    'c"words".as_ptr',
    "b'a'.is_alphabetic",
    "1.max",
    "probe.choose",
    "reference.single",
    "blanket.blanketed",
    "wrapped.selected",
    "other.earlier",
    "option.len",
    "mutable.is_some",
  ])
    assert.deepEqual(lookup("calls", call), [null], call);
  assert.deepEqual(lookup("calls", "switching.choose"), [null, null]);
});

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
      "Cargo.lock": macroLock(
        [
          ["serde", "1.0.219", ["serde_derive", "1.0.219"]],
          ["tokio", "1.54.1", ["tokio-macros", "2.7.2"]],
          ["anyhow", "1.0.104"],
          ["regex-automata", "0.4.14"],
        ],
        "0.1.0",
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
      version: "1.0.104",
      versionSource: "Cargo.lock",
      evidence: "import-binding",
    },
  ]);
  assert.deepEqual(lookup("imports", "any_how"), [
    {
      ecosystem: "cargo",
      unit: "anyhow",
      evidence: "import-path",
      version: "1.0.104",
      versionSource: "Cargo.lock",
    },
  ]);
  assert.deepEqual(lookup("imports", "regex_automata::meta::Regex"), [
    {
      ecosystem: "cargo",
      unit: "regex-automata",
      symbol: "meta::Regex",
      version: "0.4.14",
      versionSource: "Cargo.lock",
      evidence: "qualified-path",
    },
  ]);
  const serde = (symbol) => ({
    ecosystem: "cargo",
    unit: "serde",
    symbol,
    version: "1.0.219",
    versionSource: "Cargo.lock",
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
      version: "1.54.1",
      versionSource: "Cargo.lock",
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
    assert.deepEqual(configured("types", "Option"), [
      attribute === "no_std"
        ? {
            ecosystem: "rust-std",
            unit: "core",
            symbol: "option::Option",
            evidence: "declared-builtin",
          }
        : null,
    ]);
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

test("sysroot names keep their written crate and no_std uses the core prelude", async () => {
  const lookup = await graph({
    "src/lib.rs": `#![no_std]
    extern crate alloc as heap;
    fn f(_: Option<heap::vec::Vec<u8>>, x: &mut u8, y: &mut u8) { core::mem::swap(x, y); }
  `,
  });
  assert.deepEqual(lookup("types", "Option"), [
    {
      ecosystem: "rust-std",
      unit: "core",
      symbol: "option::Option",
      evidence: "declared-builtin",
    },
  ]);
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

test("no_core withholds implicit sysroot and ordinary prelude names", async (t) => {
  const store = await indexFixture(t, {
    "Cargo.toml": manifest("2024", "[features]\nbare=[]\n"),
    "src/lib.rs": `
    #![feature(no_core)]
    #![cfg_attr(feature = "bare", no_core)]
    use std::cell::RefCell;
    use core::cell::Cell;
    extern crate core as explicit;
    use explicit::cell::Cell as ExplicitCell;
    fn bare(_: Option<u8>) {}
    #[cfg(not(feature = "bare"))]
    fn hosted(_: Result<(), ()>) {}
    `,
    "src/bin/standalone.rs": `
    #![feature(no_core)]
    #![no_core]
    use std::cell::RefCell;
    use core::cell::Cell;
    fn bare(_: Option<u8>) {}
    fn main() {}
    `,
  });
  const links = store.links();
  for (const file of ["src/lib.rs", "src/bin/standalone.rs"]) {
    for (const [kind, spelling] of [
      ["imports", "std::cell::RefCell"],
      ["imports", "core::cell::Cell"],
      ["types", "Option"],
    ]) {
      const link = links.find(
        (l) => l.file === file && l.kind === kind && l.targetName === spelling,
      );
      assert.equal(link.resolution, "unresolved", spelling);
      assert.equal(
        link.data.uncertainty,
        "core-prelude-availability-unverified",
      );
    }
  }
  assert.equal(
    store.libraryUses("core", "cell::Cell", 10)[0].targetName,
    "explicit::cell::Cell",
  );
  assert.equal(
    store.libraryUses("std", "result::Result", 10)[0].targetName,
    "Result",
  );
});

test("bare macro_use imports report the unverified exports at a derive", async (t) => {
  const store = await indexFixture(t, {
    "Cargo.toml": manifest("2024", '[dependencies]\nhelper={path="helper"}\n'),
    "src/lib.rs":
      "#[macro_use] extern crate helper; #[derive(Default)] struct Item;",
    "helper/Cargo.toml": manifest().replace('"app"', '"helper"'),
    "helper/src/lib.rs": "#[macro_export] macro_rules! ping { () => {} }",
  });
  const derive = store
    .links()
    .find((l) => l.kind === "macros" && l.targetName === "Default");
  assert.equal(derive.resolution, "unresolved");
  assert.equal(derive.data.uncertainty, "macro-use-exports-unverified");
});

test("Rust links name shared prelude and known imports or explain the blocker", async (t) => {
  const store = await indexFixture(t, {
    "Cargo.toml": manifest(
      "2024",
      '[features]\nbare=[]\n[dependencies]\nwire={package="bytes",version="1.11.1"}\n',
    ),
    "Cargo.lock": macroLock([["bytes", "1.11.1"]], "0.1.0"),
    "src/lib.rs": `
    #![cfg_attr(feature = "bare", no_std)]
    use core::cell::RefCell;
    use wire::Bytes;
    extern crate wire as byte_crate;

    // After redb's LRU cache.
    fn get_mut(cached: Option<&mut (u8, bool, u8)>) {
        assert_eq!(1, 1);
        if let Some((value, second_chance, _)) = cached {
            *value = 1;
            *second_chance = true;
        }
    }
    mod shadow {
        struct Some(u8);
        type Result<T> = Option<T>;
        fn f(input: Result<Some>) { if let Option::Some(Some(_)) = input {} }
    }
    mod disabled {
        #![no_implicit_prelude]
        fn f(_: Option<u8>) {}
    }
    mod opaque {
        unknown!();
        fn f(_: Option<u8>) {}
    }
    mod glob {
        use wire::*;
        fn f(_: Option<u8>) {}
    }
    fn no_alloc_prelude(_: String) {}
    `,
    // The actix-web pin contains an AnyOrSome file without a mod entry.
    "src/any_or_some.rs": `
    enum AnyOrSome<T> { Any, Item(T) }
    fn item<T>(value: AnyOrSome<T>) -> Option<T> {
        match value { AnyOrSome::Any => None, AnyOrSome::Item(v) => Some(v) }
    }
    `,
    "admin/threads-seq.rs": "fn elapsed() -> i32 { let end = 1; end }",
  });
  const links = store.links();
  for (const link of links) {
    if (
      link.resolution !== "resolved" &&
      !link.libraries?.some(({ symbol }) => symbol)
    )
      assert.ok(link.data?.uncertainty?.trim(), JSON.stringify(link));
  }
  const ref = (kind, targetName, scope = "", file = "src/lib.rs") => {
    const hits = links.filter(
      (link) =>
        link.kind === kind &&
        link.targetName === targetName &&
        link.data?.scope === scope &&
        link.file === file,
    );
    assert.equal(hits.length, 1, `${file} ${scope} ${kind} ${targetName}`);
    return hits[0];
  };
  const target = (...args) =>
    ref(...args).libraries?.map(({ unit, symbol }) => [unit, symbol]);
  assert.deepEqual(target("patterns", "Some", "get_mut"), [
    ["core", "option::Option::Some"],
  ]);
  assert.deepEqual(target("patterns", "Option::Some", "shadow::f"), [
    ["core", "option::Option::Some"],
  ]);
  assert.deepEqual(target("macros", "assert_eq", "get_mut"), [
    ["core", "assert_eq!"],
  ]);
  assert.deepEqual(target("imports", "core::cell::RefCell"), [
    ["core", "cell::RefCell"],
  ]);
  assert.deepEqual(target("imports", "wire::Bytes"), [["bytes", "Bytes"]]);
  assert.equal(ref("patterns", "Some", "shadow::f").resolution, "resolved");
  assert.equal(ref("types", "Result", "shadow").resolution, "resolved");
  for (const [scope, reason] of [
    ["disabled", "no-implicit-prelude-binding-unverified"],
    ["opaque", "opaque-item-may-shadow-name"],
    [
      "glob",
      "glob-import-unverified|namespace/import/alias structure is unknown",
    ],
  ]) {
    const link = ref("types", "Option", scope);
    assert.equal(link.resolution, "unresolved");
    assert.match(link.data.uncertainty, new RegExp(reason));
  }
  assert.equal(
    ref("types", "String").data.uncertainty,
    "shared-core-prelude-binding-unavailable",
  );
  assert.equal(
    ref("values", "None", "item", "src/any_or_some.rs").data.uncertainty,
    "crate-placement-unavailable",
  );
  assert.equal(
    ref("values", "end", "elapsed", "admin/threads-seq.rs").data.uncertainty,
    "crate-placement-unavailable",
  );
  assert.equal(ref("imports", "wire").data.uncertainty, "whole-crate-import");
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
    "Cargo.lock": macroLock(
      [
        ["syn", "3.0.10"],
        ["thiserror", "2.0.18", ["thiserror-impl", "2.0.18"]],
        ["tokio", "1.54.1", ["tokio-macros", "2.7.2"]],
        ["unknown", "1.0.0"],
      ],
      "0.1.0",
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

test("a guessed placement does not put a cfg on a known module declaration", async (t) => {
  const store = await indexFixture(t, {
    "Cargo.toml": manifest(),
    "src/lib.rs": "mod chosen; mod elsewhere; use crate::chosen as kept;",
    "src/chosen.rs": "pub fn known() {}",
    "src/elsewhere.rs": '#[path="./alternate/chosen.rs"] mod chosen;',
    "src/alternate/chosen.rs": "pub fn alternate() {}",
  });
  const chosen = store
    .links()
    .find(
      (link) => link.kind === "imports" && link.targetName === "crate::chosen",
    );
  assert.equal(chosen.resolution, "resolved");
  assert.equal(
    store.findSymbols().find(({ id }) => id === chosen.targetId).identity,
    "chosen",
  );
  assert.equal(chosen.data.uncertainty, undefined);
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
