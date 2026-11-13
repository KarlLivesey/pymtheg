import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const result = structuredClone(value);
  function freeze(x) {
    if (x && typeof x === "object" && !Object.isFrozen(x)) {
      for (const v of Object.values(x)) freeze(v);
      Object.freeze(x);
    }
  }
  freeze(result);
  return result;
}
function snapshot(store) {
  const rows = {
    files: store.files(),
    symbols: store.findSymbols(),
    links: store.links(),
  };
  function uniqueConditions(x) {
    if (!x || typeof x !== "object") return;
    for (const [key, value] of Object.entries(x)) {
      if (key === "conditions" && Array.isArray(value))
        assert.equal(
          new Set(value).size,
          value.length,
          "conditions must be canonical",
        );
      uniqueConditions(value);
    }
  }
  uniqueConditions(rows);
  return Object.fromEntries(
    Object.entries(rows).map(([kind, values]) => [
      kind,
      JSON.stringify(values),
    ]),
  );
}
test("Rust cfg conditions: warm and cold store facts are byte-identical with frozen module inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "pymtheg-rust-conditions-"));
  const warm = new SqliteGraphStore(":memory:", "condition-cache");
  let frozenAnalyses = 0,
    frozenResolutions = 0;
  const registry = new LanguageRegistry([
    {
      ...rust,
      analyze(input) {
        frozenAnalyses++;
        return rust.analyze(frozen(input));
      },
      resolve(input) {
        frozenResolutions++;
        return rust.resolve(frozen(input));
      },
    },
  ]);
  const clean = '#![cfg(feature="gate")]\npub fn call(){}\n';
  try {
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "Cargo.toml"),
      '[package]\nname="app"\nedition="2024"\n',
    );
    await writeFile(
      join(root, "src/lib.rs"),
      '#[cfg(feature="gate")] pub mod child;\n#[cfg(feature="gate")] pub fn run(){child::call();}\n',
    );
    for (const child of [
      clean,
      clean.replace('feature="gate"', 'feature="changed"'),
      clean + "pub fn review_broken(",
      clean,
    ]) {
      await writeFile(join(root, "src/child.rs"), child);
      const first = await indexProject(root, registry, warm);
      assert.deepEqual(
        [...first.errors, ...first.analysisErrors, ...first.resolutionErrors],
        [],
      );
      const once = snapshot(warm);
      const second = await indexProject(root, registry, warm);
      assert.ok(
        second.indexed <= second.failed.length,
        "clean files must reuse cached parse facts; failed files may be retried",
      );
      assert.deepEqual(
        [
          ...second.errors,
          ...second.analysisErrors,
          ...second.resolutionErrors,
        ],
        [],
      );
      assert.deepEqual(
        snapshot(warm),
        once,
        "warm analysis must be idempotent",
      );
      const cold = new SqliteGraphStore(":memory:", "condition-cache");
      try {
        const report = await indexProject(root, registry, cold);
        assert.deepEqual(
          [
            ...report.errors,
            ...report.analysisErrors,
            ...report.resolutionErrors,
          ],
          [],
        );
        assert.deepEqual(
          snapshot(warm),
          snapshot(cold),
          "files, symbols and links must match a cold store byte for byte",
        );
      } finally {
        cold.close();
      }
    }
    assert.ok(
      frozenAnalyses > 0 && frozenResolutions > 0,
      "both module APIs saw deeply frozen inputs",
    );
  } finally {
    warm.close();
    await rm(root, { recursive: true, force: true });
  }
});
