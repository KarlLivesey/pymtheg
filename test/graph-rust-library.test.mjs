// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileFacts, contentHash, validateResult } from "../dist/graph/index.js";
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
  assert.deepEqual(lookup("macros", "Serialize"), [serde("Serialize!")]);
  assert.deepEqual(lookup("macros", "tokio::main"), [
    {
      ecosystem: "cargo",
      unit: "tokio",
      symbol: "main!",
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
