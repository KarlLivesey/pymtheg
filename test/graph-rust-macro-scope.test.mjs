// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { contentHash, fileFacts, validateResult } from "../dist/graph/index.js";
import rust from "../dist/graph/languages/rust/index.js";

async function observations(text, dependencies = "") {
  const path = "src/lib.rs";
  const projectId = "macro-scope";
  const result = await rust.parse({ path, text });
  validateResult(text, result);
  assert.equal(result.status, "clean", JSON.stringify(result.diagnostics));
  const file = {
    path,
    text,
    result,
    module: "rust",
    version: rust.version,
    hash: contentHash(text),
  };
  const manifest = `[package]\nname="app"\nversion="0.0.0"\nedition="2021"\n[dependencies]\n${dependencies}`;
  const contextFiles = [
    {
      path: "Cargo.toml",
      text: manifest,
      status: "clean",
      hash: contentHash(manifest),
      diagnostics: [],
    },
  ];
  const ctx = { projectId, files: [file], contextFiles };
  [file.result] = (await rust.analyze(ctx)).map((f) => f.result);
  const { links, symbols } = fileFacts(projectId, file);
  const resultSet = await rust.resolve({ ...ctx, links, symbols });
  const decisions = new Map(
    (Array.isArray(resultSet) ? resultSet : resultSet.resolutions).map((d) => [
      d.linkId,
      d,
    ]),
  );
  return (kind, target, lineMarker) => {
    const lineStart = text.lastIndexOf("\n", text.indexOf(lineMarker)) + 1;
    const lineEnd = text.indexOf("\n", text.indexOf(lineMarker));
    const link = links.find(
      (l) =>
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
    mod generated_names {
      use paste::paste as build;
      build! { struct [<Opt ion>]; }
      fn missing() -> Option { Option } // pasted
    }
  `,
    'slotmap="1"\nautomod="1"\npaste="1"',
  );
  assert.deepEqual(at("calls", "outside", "// checkout"), assumed("outside"));
  assert.deepEqual(
    at("types", "Option", "// library"),
    assumed("option::Option"),
  );
  assert.deepEqual(at("types", "Option", "// input"), proved(null));
  assert.deepEqual(at("types", "Option", "// glob"), proved(null));
  assert.deepEqual(at("types", "Option", "// layout"), proved(null));
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
