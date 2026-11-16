// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
const rust = (
  await import(
    process.env.RUST_TEST_MODULE ?? "../dist/graph/languages/rust/index.js"
  )
).default;
function frozen(value) {
  const copy = structuredClone(value);
  function walk(x) {
    if (x && typeof x === "object") {
      for (const c of Object.values(x)) walk(c);
      Object.freeze(x);
    }
  }
  walk(copy);
  return copy;
}
function snapshot(store) {
  const result = {
    files: store.files(),
    symbols: store.findSymbols(),
    links: store.links(),
  };
  for (const rows of Object.values(result))
    rows.sort((a, b) => (a.id ?? a.path).localeCompare(b.id ?? b.path));
  return JSON.stringify(result);
}
test("derive helper presence and tail scopes: frozen inputs, changing captured imports, warm equals cold", async () => {
  const root = await mkdtemp(
    join(process.env.PYM_SCRATCH ?? tmpdir(), "pymtheg-c4-cache-"),
  );
  const cases = JSON.parse(
    await readFile(
      new URL("./fixtures/graph-rust/recall-4.json", import.meta.url),
      "utf8",
    ),
  );
  const fixture = cases.find((c) => c.name === "helper item after derive");
  let parsed = 0;
  const registry = new LanguageRegistry([
    {
      ...rust,
      async parse(s) {
        parsed++;
        return rust.parse(s);
      },
      analyze(c) {
        return rust.analyze(frozen(c));
      },
      resolve(c) {
        return rust.resolve(frozen(c));
      },
    },
  ]);
  const warm = new SqliteGraphStore(":memory:", "c4-cache");
  try {
    for (const [path, text] of Object.entries({
      ...fixture.files,
      ...fixture.manifests,
    })) {
      const f = join(root, path);
      await mkdir(join(f, ".."), { recursive: true });
      await writeFile(f, text);
    }
    for (const shadow of [false, true, false]) {
      await writeFile(
        join(root, "src/lib.rs"),
        (shadow ? "use pm::helper;" : "") + fixture.files["src/lib.rs"],
      );
      const result = await indexProject(root, registry, warm);
      assert.deepEqual(
        [
          ...result.errors,
          ...result.analysisErrors,
          ...result.resolutionErrors,
        ],
        [],
      );
      const links = warm
        .links()
        .filter((l) => l.kind === "types" && l.targetName === "crate::A");
      assert.ok(links.length);
      assert.ok(links.every((l) => !!l.targetId === !shadow));
      const once = snapshot(warm),
        before = parsed;
      await indexProject(root, registry, warm);
      assert.equal(parsed, before);
      assert.equal(snapshot(warm), once);
      const cold = new SqliteGraphStore(":memory:", "c4-cache");
      try {
        await indexProject(root, registry, cold);
        assert.equal(snapshot(cold), once);
      } finally {
        cold.close();
      }
    }
  } finally {
    warm.close();
    await rm(root, { recursive: true, force: true });
  }
});
