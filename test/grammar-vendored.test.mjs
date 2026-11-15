// W2-S: the vendored grammar files are the ones the manifests record, are
// complete (patches, licence) and load in the installed web-tree-sitter.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { Language, Parser } from "web-tree-sitter";

const require = createRequire(import.meta.url);
const root = new URL("../grammars/", import.meta.url).pathname;
const languages = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
/** A shape only the vendored build reads (the npm build rejects it). */
const SAMPLES = {
  go: "package p\n\nvar P = new(42)\n",
  rust: 'unsafe extern "C" {\n    pub fn abs(x: i32) -> i32;\n}\npub fn f(raw: u8) -> u8 {\n    let r = &raw;\n    *r\n}\n',
};
const manifest = (language) =>
  JSON.parse(readFileSync(join(root, language, "manifest.json"), "utf8"));

test("every vendored grammar has a manifest; Go is vendored", () => {
  assert.ok(languages.includes("go"));
  for (const language of languages)
    assert.ok(existsSync(join(root, language, "manifest.json")), language);
});

for (const language of languages) {
  const recorded = manifest(language);
  test(`${language}: the checked-in .wasm matches the recorded sha256`, () => {
    const bytes = readFileSync(join(root, language, recorded.output));
    assert.match(recorded.sha256, /^[0-9a-f]{64}$/);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      recorded.sha256,
    );
  });

  test(`${language}: provenance is complete (pinned commit, patches, PR heads, tools, licence)`, () => {
    assert.match(recorded.upstream.repository, /^https:\/\/github\.com\//);
    assert.match(recorded.upstream.commit, /^[0-9a-f]{40}$/);
    assert.ok(recorded.upstream.tag);
    for (const patch of recorded.patches) {
      assert.ok(existsSync(join(root, language, patch.file)), patch.file);
      // Upstream patches name their pull request and head commit; our own
      // patches say so and describe what they change.
      if (patch.origin === "pymtheg") {
        assert.match(patch.author, /not upstream/);
        assert.ok(patch.what.length > 20, patch.file);
        assert.match(patch.file, /-own-/);
      } else {
        assert.ok([undefined, "upstream"].includes(patch.origin), patch.file);
        assert.match(patch.headCommit, /^[0-9a-f]{40}$/);
        assert.match(patch.pullRequest, /\/pull\/\d+$/);
      }
    }
    for (const tool of ["tree-sitter-cli", "wasi-sdk", "binaryen"])
      assert.ok(recorded.tools[tool], tool);
    const licence = readFileSync(join(root, language, "LICENSE"), "utf8");
    assert.match(licence, /MIT License|Permission is hereby granted/);
  });

  test(`${language}: loads in the installed web-tree-sitter with the recorded ABI`, async () => {
    await Parser.init({
      locateFile: () => require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
    });
    const grammar = await Language.load(join(root, language, recorded.output));
    assert.equal(grammar.abiVersion, recorded.abi);
    const parser = new Parser();
    try {
      parser.setLanguage(grammar);
      const tree = parser.parse(SAMPLES[language] ?? "");
      assert.equal(tree.rootNode.hasError, false);
      tree.delete();
    } finally {
      parser.delete();
    }
  });
}

test("every vendored language has a sample only its vendored build reads", () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), languages);
});

test("rust: the module loads the vendored grammar, not the npm one", async () => {
  const rust = (await import("../dist/graph/languages/rust/index.js")).default;
  const result = await rust.parse({ path: "src/lib.rs", text: SAMPLES.rust });
  assert.equal(result.status, "clean");
  await Parser.init({
    locateFile: () => require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
  });
  const npm = new Parser();
  npm.setLanguage(
    await Language.load(
      require.resolve("tree-sitter-rust/tree-sitter-rust.wasm"),
    ),
  );
  const tree = npm.parse(SAMPLES.rust);
  assert.equal(tree.rootNode.hasError, true);
  tree.delete();
  npm.delete();
});

test("go: the build does not reach the npm grammar (the vendored file is what parses)", async () => {
  // Only the patched grammar reads Go 1.26 `new(expr)`; the npm 0.25.0 build
  // rejects it. So a clean parse through the Go module proves which file loads.
  const go = (await import("../dist/graph/languages/go/index.js")).default;
  const result = await go.parse({
    path: "a.go",
    text: "package p\n\nvar P = new(42)\n",
  });
  assert.equal(result.status, "clean");
  await Parser.init({
    locateFile: () => require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
  });
  const npm = new Parser();
  npm.setLanguage(
    await Language.load(require.resolve("tree-sitter-go/tree-sitter-go.wasm")),
  );
  const tree = npm.parse("package p\n\nvar P = new(42)\n");
  assert.equal(tree.rootNode.hasError, true);
  tree.delete();
  npm.delete();
});
