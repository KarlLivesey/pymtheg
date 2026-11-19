// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
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
function frozen(input) {
  const x = structuredClone(input);
  function freeze(v) {
    if (v && typeof v === "object" && !Object.isFrozen(v)) {
      for (const c of Object.values(v)) freeze(c);
      Object.freeze(v);
    }
  }
  freeze(x);
  return x;
}
function snapshot(store) {
  const rows = {
    files: store.files(),
    symbols: store.findSymbols(),
    links: store.links(),
  };
  for (const values of Object.values(rows))
    values.sort((a, b) => (a.id ?? a.path).localeCompare(b.id ?? b.path));
  for (const x of [...rows.symbols, ...rows.links])
    if (x.data?.conditions)
      assert.equal(new Set(x.data.conditions).size, x.data.conditions.length);
  return JSON.stringify(rows);
}
test("Rust ecosystem macro identity: captured lock changes re-resolve cached source, and frozen warm facts equal cold", async () => {
  const root = await mkdtemp(join(homedir(), ".cache/pymtheg-c3-cache-"));
  const warm = new SqliteGraphStore(":memory:", "c3-cache");
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
  const lock = (version) =>
    `version=4\n[[package]]\nname="app"\nversion="0.0.0"\ndependencies=["tracing"]\n[[package]]\nname="tracing"\nversion="${version}"\nsource="registry+https://github.com/rust-lang/crates.io-index"\n`;
  try {
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "Cargo.toml"),
      '[package]\nname="app"\nversion="0.0.0"\nedition="2024"\n[dependencies]\ntracing=">=0.1"\n',
    );
    await writeFile(
      join(root, "src/lib.rs"),
      '#[cfg(feature="x")]pub mod child;pub fn helper()->u32{11}pub fn run()->u32{let value=1;tracing::info!("{}",value);helper()}',
    );
    await writeFile(
      join(root, "src/child.rs"),
      '#![cfg(feature="x")] pub fn f(){}',
    );
    for (const version of ["0.1.44", "0.2.0", "0.1.41"]) {
      await writeFile(join(root, "Cargo.lock"), lock(version));
      let r = await indexProject(root, registry, warm);
      assert.deepEqual(
        [...r.errors, ...r.analysisErrors, ...r.resolutionErrors],
        [],
      );
      const helper = warm
        .links()
        .filter((l) => l.kind === "calls" && l.targetName === "helper");
      assert.equal(helper.length, 1);
      if (version === "0.2.0") assert.equal(helper[0].targetId, null);
      else assert.ok(helper[0].targetId);
      assert.deepEqual(helper[0].data.assumes ?? [], []);
      const once = snapshot(warm),
        before = parsed;
      r = await indexProject(root, registry, warm);
      assert.equal(parsed, before);
      assert.equal(snapshot(warm), once);
      const cold = new SqliteGraphStore(":memory:", "c3-cache");
      try {
        r = await indexProject(root, registry, cold);
        assert.deepEqual(
          [...r.errors, ...r.analysisErrors, ...r.resolutionErrors],
          [],
        );
        assert.equal(snapshot(cold), once);
      } finally {
        cold.close();
      }
    }
    // Changing child-file gates must not feed previously derived conditions
    // back into cached parent declarations.
    for (const gate of ["y", "x"]) {
      await writeFile(
        join(root, "src/child.rs"),
        `#![cfg(feature="${gate}")] pub fn f(){}`,
      );
      await indexProject(root, registry, warm);
      const once = snapshot(warm);
      await indexProject(root, registry, warm);
      assert.equal(snapshot(warm), once);
      const cold = new SqliteGraphStore(":memory:", "c3-cache");
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
