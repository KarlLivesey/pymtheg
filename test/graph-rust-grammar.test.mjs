// W2-V: Rust shapes the vendored grammar (tree-sitter-rust v0.24.2 + PRs
// #319, #271, #317, #312, #283, #281) reads, the ones it still cannot read,
// and the known regression of v0.24.x. Every fixture is valid Rust: checked
// with rustc below when the toolchain is installed (edition from the
// fixture's first line; output also in evidence/w2-v/fixtures-rustc.txt).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
      for (const dir of ["fixed", "remaining", "limits"])
        for (const name of files(dir)) {
          const path = join(fixture, dir, name);
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
            { encoding: "utf8" },
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

for (const [dir, label] of [
  ["remaining", "still rejected by the vendored grammar"],
  ["limits", "known regression of v0.24.x (`raw` as a type name or `raw @`)"],
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
