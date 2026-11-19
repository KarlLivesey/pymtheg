// SPDX-License-Identifier: MIT
// W2-V, C-21: Rust shapes the vendored grammar (tree-sitter-rust v0.24.2 + PRs
// #319, #271, #317, #312, #283, #281 + our patches 0007 `raw`, 0008 `safe`
// and 0009-0014 from C-21) reads, and the ones it still cannot read. Every
// fixture is valid Rust: checked with rustc below when the toolchain is
// installed (edition from the fixture's first line; a fixture marked
// "nightly" is checked with RUSTC_BOOTSTRAP=1 for its feature gate).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Language, Parser } from "web-tree-sitter";
import {
  LanguageRegistry,
  SqliteGraphStore,
  indexProject,
} from "../dist/graph/index.js";
import rust from "../dist/graph/languages/rust/index.js";

const fixture = new URL("./fixtures/rust-grammar/", import.meta.url).pathname;
const read = (dir, name) => readFileSync(join(fixture, dir, name), "utf8");
const edition = (text) => /^\/\/ edition (\d+)/.exec(text)?.[1] ?? "2024";
const files = (dir) =>
  readdirSync(join(fixture, dir))
    .filter((name) => name.endsWith(".rs"))
    .sort();
const rustc = spawnSync("rustc", ["--version"], { encoding: "utf8" });

/** Index one fixture as src/lib.rs of a crate with the fixture's edition. */
async function index(dir, name) {
  const text = read(dir, name);
  const root = mkdtempSync(join(tmpdir(), "pymtheg-rust-grammar-"));
  const store = new SqliteGraphStore(join(root, "graph.sqlite"), "w2v");
  try {
    mkdirSync(join(root, "project", "src"), { recursive: true });
    writeFileSync(
      join(root, "project", "Cargo.toml"),
      `[package]\nname="app"\nedition="${edition(text)}"\nversion="0.1.0"\n`,
    );
    writeFileSync(join(root, "project", "src", "lib.rs"), text);
    const report = await indexProject(
      join(root, "project"),
      new LanguageRegistry([rust]),
      store,
    );
    const symbols = store.findSymbols();
    const name = (id) => {
      const symbol = symbols.find((item) => item.id === id);
      return symbol ? `${symbol.kind}:${symbol.identity}` : null;
    };
    const links = store.links().map((link) => ({
      kind: link.kind,
      at: text.slice(link.range.start, link.range.end),
      target: name(link.targetId),
    }));
    return { report, symbols, links };
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}
const own = (symbols) =>
  symbols
    .filter((symbol) => !["file", "module"].includes(symbol.kind))
    .map((symbol) => `${symbol.kind}:${symbol.identity}`)
    .sort();
const targets = (links, kind, at) =>
  links
    .filter((link) => link.kind === kind && link.at === at)
    .map((link) => link.target);

test(
  "every grammar fixture is valid Rust (rustc, its edition)",
  { skip: rustc.status !== 0 && "rustc not installed" },
  () => {
    const out = mkdtempSync(join(tmpdir(), "pymtheg-rustc-"));
    try {
      for (const dir of ["fixed", "remaining", "ordinary"])
        for (const name of files(dir)) {
          const path = join(fixture, dir, name);
          const nightly = /^\/\/ [^\n]*\bnightly\b/.test(
            readFileSync(path, "utf8"),
          );
          const run = spawnSync(
            "rustc",
            [
              "--edition",
              edition(readFileSync(path, "utf8")),
              "--crate-type",
              "lib",
              "--emit=metadata",
              "-A",
              "warnings",
              "--crate-name",
              "fixture",
              "--out-dir",
              out,
              path,
            ],
            {
              encoding: "utf8",
              env: nightly
                ? { ...process.env, RUSTC_BOOTSTRAP: "1" }
                : process.env,
            },
          );
          assert.equal(run.status, 0, `${dir}/${name}: ${run.stderr}`);
        }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  },
);

test("`&raw` on a variable named raw is read; raw borrows still are", async () => {
  const { report, symbols, links } = await index("fixed", "raw_variable.rs");
  assert.deepEqual(report.failed, []);
  assert.deepEqual(own(symbols), [
    "function:borrows",
    "function:checksum",
    "function:decode",
    "function:frame_len",
    "function:text_len",
    "struct:Frame",
  ]);
  // checksum(&raw) and checksum(&raw[offset..]) both reach the local fn.
  assert.deepEqual(targets(links, "calls", "checksum"), [
    "function:checksum",
    "function:checksum",
  ]);
  assert.deepEqual(targets(links, "types", "Frame"), ["struct:Frame"]);
});

test("edition-2024 FFI: unsafe extern blocks with #[link] and variadic declarations", async () => {
  const { report, symbols, links } = await index("fixed", "unsafe_extern.rs");
  assert.deepEqual(report.failed, []);
  assert.deepEqual(own(symbols), [
    "function:cos",
    "function:cosine",
    "function:length",
    "function:printf",
    "function:shout",
    "function:strlen",
    "static:errno",
  ]);
  assert.deepEqual(targets(links, "calls", "printf"), ["function:printf"]);
  assert.deepEqual(targets(links, "calls", "strlen"), ["function:strlen"]);
  assert.deepEqual(targets(links, "calls", "cos"), ["function:cos"]);
});

test("#[cfg] on struct-pattern fields: let, match arm, field: pattern, parameter pattern", async () => {
  const { report, symbols, links } = await index(
    "fixed",
    "cfg_pattern_fields.rs",
  );
  assert.deepEqual(report.failed, []);
  assert.deepEqual(own(symbols), [
    "enum:Event",
    "function:count",
    "function:id",
    "function:retries",
    "function:summary",
    "struct:Config",
    "variant:Event::Open",
  ]);
  assert.deepEqual(targets(links, "calls", "count"), ["function:count"]);
  assert.deepEqual(targets(links, "patterns", "Config"), [
    "struct:Config",
    "struct:Config",
  ]);
  assert.deepEqual(targets(links, "patterns", "Event::Open"), [
    "variant:Event::Open",
  ]);
});

test("unit struct where clause, ~ in macros, `as T <=`, \\u{4_e}, foreign types", async () => {
  const { report, symbols, links } = await index("fixed", "small_shapes.rs");
  assert.deepEqual(report.failed, []);
  assert.deepEqual(own(symbols), [
    "const:N",
    "function:fits",
    "function:same",
    "macro:approx",
    "struct:AssertSend",
    "type:Opaque",
    "type:size_t",
  ]);
  assert.deepEqual(targets(links, "macros", "approx"), ["macro:approx"]);
  assert.deepEqual(targets(links, "types", "size_t"), ["type:size_t"]);
  // The foreign type keeps its extern block's cfg, like a foreign fn does.
  const opaque = symbols.find((symbol) => symbol.identity === "Opaque");
  assert.deepEqual(opaque.data.conditions, ["any()"]);
});

test("patch 0007: `raw` as a type name and in `raw @ pattern` is read again", async () => {
  const typed = await index("fixed", "raw_type_name.rs");
  assert.deepEqual(typed.report.failed, []);
  assert.deepEqual(own(typed.symbols), [
    "function:f",
    "function:p",
    "struct:raw",
  ]);
  // `Option<raw>` and `p::<raw>()` both reach the struct named raw.
  assert.deepEqual(targets(typed.links, "types", "raw"), [
    "struct:raw",
    "struct:raw",
  ]);
  const bound = await index("fixed", "raw_at_binding.rs");
  assert.deepEqual(bound.report.failed, []);
  assert.deepEqual(own(bound.symbols), ["function:f"]);
});

test("patch 0008: `safe fn` / `safe static` in unsafe extern blocks; `safe` stays a name", async () => {
  const { report, symbols, links } = await index("fixed", "safe_items.rs");
  assert.deepEqual(report.failed, []);
  assert.deepEqual(own(symbols), [
    "function:abs",
    "function:magnitude",
    "function:safe",
    "function:strlen",
    "function:zone",
    "macro:safe",
    "static:timezone",
    "struct:Options",
  ]);
  assert.deepEqual(targets(links, "calls", "abs"), ["function:abs"]);
  assert.deepEqual(targets(links, "values", "timezone"), ["static:timezone"]);
  assert.deepEqual(targets(links, "calls", "self::safe"), ["function:safe"]);
  assert.deepEqual(targets(links, "macros", "safe"), ["macro:safe"]);
  const minimal = await index("fixed", "safe_fn_in_extern.rs");
  assert.deepEqual(minimal.report.failed, []);
  assert.deepEqual(own(minimal.symbols), [
    "function:abs",
    "function:strlen",
    "static:errno",
  ]);
});

test("patch 0009: `str![…]` is an ordinary macro invocation; `str<…>` in macro input", async () => {
  const { report, symbols, links } = await index(
    "fixed",
    "primitive_named_macro.rs",
  );
  assert.deepEqual(report.failed, []);
  assert.deepEqual(own(symbols), [
    "function:check",
    "function:expected",
    "macro:keep",
    "macro:str",
  ]);
  // Both invocations reach the local macro named `str`, not the type.
  assert.deepEqual(targets(links, "macros", "str"), ["macro:str", "macro:str"]);
  assert.deepEqual(targets(links, "calls", "expected"), ["function:expected"]);
  assert.deepEqual(targets(links, "macros", "keep"), ["macro:keep"]);
});

test("patch 0010: a lifetime first in dyn bounds keeps the trait reference", async () => {
  const { report, symbols, links } = await index(
    "fixed",
    "dyn_lifetime_first.rs",
  );
  assert.deepEqual(report.failed, []);
  assert.deepEqual(own(symbols), [
    "function:boxed",
    "function:run",
    "impl:impl Code for Diagnostic",
    "method:Code::code",
    "method:impl Code for Diagnostic::code",
    "struct:Diagnostic",
    "trait:Code",
    "type:Handler",
  ]);
  // `dyn 'a + Code` and the impl's trait both name the trait.
  assert.deepEqual(targets(links, "types", "Code"), [
    "trait:Code",
    "trait:Code",
  ]);
  assert.deepEqual(targets(links, "calls", "boxed"), ["function:boxed"]);
  assert.deepEqual(targets(links, "types", "Handler"), ["type:Handler"]);
});

test("patch 0011: attributes on parameters hide neither pattern nor type", async () => {
  const two = await index("fixed", "param_two_attributes.rs");
  assert.deepEqual(two.report.failed, []);
  assert.deepEqual(own(two.symbols), [
    "function:depth_of",
    "function:f",
    "struct:Visual",
  ]);
  assert.deepEqual(targets(two.links, "types", "Visual"), [
    "struct:Visual",
    "struct:Visual",
  ]);
  assert.deepEqual(targets(two.links, "calls", "depth_of"), [
    "function:depth_of",
  ]);
  // Parameters behind stacked attributes are bindings of the function.
  assert.deepEqual(targets(two.links, "values", "visual"), ["function:f"]);
  assert.deepEqual(targets(two.links, "values", "extra"), ["function:f"]);

  const closure = await index("fixed", "attr_closure_param.rs");
  assert.deepEqual(closure.report.failed, []);
  // `unused_variables` inside `#[allow(unused_variables)]` binds nothing: the
  // call in the closure body reaches the function, not a closure parameter.
  assert.deepEqual(targets(closure.links, "calls", "unused_variables"), [
    "function:unused_variables",
  ]);
  // The attributed closure parameter keeps its type and binding.
  assert.deepEqual(targets(closure.links, "types", "Client"), [
    "struct:Client",
    "struct:Client",
    "struct:Client",
  ]);
  assert.deepEqual(targets(closure.links, "calls", "c.native"), [
    "method:impl Client::native",
  ]);
  assert.deepEqual(targets(closure.links, "values", "redirects"), [
    "function:build",
  ]);
});

test("patch 0012 (nightly): box patterns bind their inner pattern", async () => {
  const { report, symbols, links } = await index("fixed", "box_patterns.rs");
  assert.deepEqual(report.failed, []);
  assert.deepEqual(own(symbols), [
    "enum:ApiError",
    "enum:CacheError",
    "function:handle",
    "function:message",
    "function:report",
    "variant:ApiError::CacheDisabled",
    "variant:ApiError::Other",
    "variant:CacheError::ApiClientError",
    "variant:CacheError::Mismatch",
  ]);
  // Constructors inside `box` resolve as patterns.
  assert.deepEqual(targets(links, "patterns", "ApiError::CacheDisabled"), [
    "variant:ApiError::CacheDisabled",
  ]);
  assert.deepEqual(targets(links, "patterns", "ApiError::Other"), [
    "variant:ApiError::Other",
  ]);
  assert.deepEqual(targets(links, "calls", "report"), [
    "function:report",
    "function:report",
  ]);
  // `box message` binds `message` in its arm: the receiver is that binding,
  // never the function `message` called in the arm before.
  assert.deepEqual(targets(links, "calls", "message"), ["function:message"]);
  assert.deepEqual(targets(links, "calls", "message.len"), [null]);
});

test("patch 0013: `where dyn Trait: Bound` reads both traits", async () => {
  const { report, symbols, links } = await index("fixed", "where_dyn.rs");
  assert.deepEqual(report.failed, []);
  assert.deepEqual(own(symbols), [
    "function:choose",
    "function:select",
    "method:VersionSelector::pick",
    "trait:Selector",
    "trait:VersionSelector",
  ]);
  assert.deepEqual(targets(links, "types", "Selector"), [
    "trait:Selector",
    "trait:Selector",
  ]);
  assert.deepEqual(targets(links, "types", "VersionSelector"), [
    "trait:VersionSelector",
  ]);
  assert.deepEqual(targets(links, "calls", "choose"), ["function:choose"]);
});

test("patch 0014: a turbofish struct pattern names the struct and binds its fields", async () => {
  const { report, symbols, links } = await index(
    "fixed",
    "turbofish_struct_pattern.rs",
  );
  assert.deepEqual(report.failed, []);
  assert.deepEqual(own(symbols), [
    "function:describe",
    "function:f",
    "struct:Payload",
  ]);
  assert.deepEqual(targets(links, "patterns", "Payload"), ["struct:Payload"]);
  assert.deepEqual(targets(links, "calls", "describe"), ["function:describe"]);
  // `code` in `describe(code)` is the pattern's binding in f.
  assert.deepEqual(targets(links, "values", "code").sort(), [
    "function:describe",
    "function:f",
  ]);
});

test("ordinary Rust keeps exactly the tree the grammar before C-21 gave", async () => {
  // Digests of every node (type, field, named, byte range) written with the
  // grammar before C-21 (sha256 66a1d357…) by evidence/c-21/tree-digests.mjs.
  const golden = JSON.parse(
    readFileSync(join(fixture, "ordinary-trees.json"), "utf8"),
  );
  const require = createRequire(import.meta.url);
  await Parser.init({
    locateFile: () => require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
  });
  const parser = new Parser();
  parser.setLanguage(
    await Language.load(
      new URL("../grammars/rust/tree-sitter-rust.wasm", import.meta.url)
        .pathname,
    ),
  );
  const actual = {};
  try {
    for (const file of Object.keys(golden)) {
      const tree = parser.parse(readFileSync(join(fixture, file), "utf8"));
      const hash = createHash("sha256");
      const c = tree.walk();
      walk: for (;;) {
        const n = c.currentNode;
        hash.update(
          `${c.currentFieldName ?? ""}:${n.type}:${n.isNamed ? 1 : 0}:${n.startIndex}:${n.endIndex};`,
        );
        if (c.gotoFirstChild()) continue;
        while (!c.gotoNextSibling()) if (!c.gotoParent()) break walk;
      }
      c.delete();
      tree.delete();
      actual[file] = hash.digest("hex");
    }
  } finally {
    parser.delete();
  }
  assert.ok(Object.keys(golden).includes("ordinary/adjacent.rs"));
  assert.deepEqual(actual, golden);
});

for (const [dir, label] of [
  ["remaining", "still rejected by the vendored grammar"],
])
  for (const name of files(dir))
    test(`${dir}/${name}: ${label}; the file fails honestly`, async () => {
      const { report, symbols, links } = await index(dir, name);
      assert.deepEqual(report.failed, ["src/lib.rs"]);
      assert.deepEqual(
        symbols.filter(
          (symbol) => symbol.file === "src/lib.rs" && symbol.kind !== "file",
        ),
        [],
      );
      assert.deepEqual(
        links.filter((link) => link.kind !== "contains"),
        [],
      );
    });
