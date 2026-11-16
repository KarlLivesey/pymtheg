// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { test } from "node:test";
import {
  checkLanguageConformance,
  discoverLanguages,
} from "../dist/graph/index.js";
import go from "../dist/graph/languages/go/index.js";
import { links, symbols } from "./fixtures/graph-go/expected.mjs";

const sample = new URL("./fixtures/graph-go/sample/", import.meta.url);

async function fixtures() {
  const root = sample.pathname;
  const output = [];
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true }))
      .map((item) => item)
      .sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else {
        const name = relative(root, path).split("\\").join("/");
        output.push({
          path: name,
          text: await readFile(path, "utf8"),
          ...(name === "go.mod" ? { context: true } : {}),
          // A file that cannot be read is not valid code: it has failed.
          ...(name === "broken/broken.go" ? { status: "failed" } : {}),
        });
      }
    }
  }
  await walk(root);
  return output;
}

test("Go module passes the conformance kit on the sample project", async () => {
  const files = await fixtures();
  assert.ok(files.some((file) => file.text.includes("😀")));
  await checkLanguageConformance(go, files, { symbols, links });
});

test("Go module is discovered in production and claims only Go sources and context", async () => {
  const registry = await discoverLanguages();
  assert.ok(registry.modules.some((module) => module.id === "go"));
  assert.equal(registry.claim("pkg/a.go")?.id, "go");
  assert.equal(registry.claim("pkg/a_test.go")?.id, "go");
  assert.equal(registry.claim("go.mod"), undefined);
  assert.deepEqual(go.contextFiles, ["go.mod", "go.work"]);
  assert.equal(go.testOnly, undefined);
});

test("Go sample covers every listed hard case", () => {
  const has = (predicate, label) =>
    assert.ok(links.some(predicate) || symbols.some(predicate), label);
  has(
    (l) => l.kind === "calls" && l.targetName === "scale" && l.target,
    "unexported cross-file call",
  );
  has((l) => l.at === 'g "example.com/shapes/geom"' && l.target, "alias");
  has((l) => l.at?.startsWith(". ") && l.target, "dot-import");
  has(
    (l) =>
      l.targetName === "example.com/shapes/geom/internal/calc" &&
      l.file === "cmd/app/main.go" &&
      l.target === null,
    "internal import refused outside its parent",
  );
  has(
    (l) => l.targetName === "fmt.Println" && l.target?.kind === "method",
    "shadowed package name resolves to the local's method",
  );
  has((l) => l.kind === "implements", "implicit interface satisfaction");
  has(
    (l) => l.targetName === "s.Name" && l.candidates?.length === 3,
    "interface call candidates",
  );
  has((s) => s.identity === "(*Square).Area", "pointer receiver");
  has((s) => s.identity === "(Circle).Area", "value receiver");
  has((s) => s.kind === "package" && s.name === "geom_test", "external test");
  assert.equal(symbols.filter((s) => s.identity === "init").length, 2);
});
