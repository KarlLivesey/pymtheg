// SPDX-License-Identifier: MIT
// C-22: a re-index killed at any write boundary — after each committed store
// write in turn — is repaired by ONE normal re-index to exactly a cold index
// of the same tree, and the killed store never reports itself complete.
// Before C-22, a TypeScript re-index killed during its analysis writes left
// files that matched their source hashes but carried stale analysis, and the
// next run reused them for ever. The technique is C-6's: a child process
// that kills itself (test/graph-reindex-kill-child.mjs).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { executeGraph } from "../dist/graph/commands.js";
import {
  discoverLanguages,
  indexProject,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import { compareRows, storeRows } from "../scripts/reindex/dump.mjs";

const child = new URL("graph-reindex-kill-child.mjs", import.meta.url).pathname;
const registry = await discoverLanguages();
const graph = (root) => join(root, ".pymtheg/rebuildable/graph.sqlite");
const write = (root, files) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
};
const killAt = (root, n) =>
  new Promise((resolve) => {
    const process_ = spawn(process.execPath, [child, root, String(n)], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    process_.stdout.on("data", (data) => (out += data));
    process_.on("exit", (code, signal) => resolve({ code, signal, out }));
  });

/**
 * Indexes `files`, applies `edit`, and for n = 1, 2, … kills the re-index
 * after its nth write on a fresh copy, then checks one normal re-index
 * against a cold index. Returns the number of write boundaries tried and
 * the number of scoped TypeScript analyses the unkilled re-index made.
 */
async function everyKillPoint(files, edit) {
  const base = mkdtempSync(join(tmpdir(), "c22-kill-"));
  try {
    const start = join(base, "start");
    write(start, files);
    assert.equal(
      (await executeGraph({ command: "index", root: start })).sync.complete,
      true,
    );
    write(start, edit);
    const project = storeRows(graph(start)).project[0];
    const coldPath = join(base, "cold.sqlite");
    const coldStore = new SqliteGraphStore(coldPath, project);
    try {
      await indexProject(start, registry, coldStore, {
        excludeDirectories: [".pymtheg"],
      });
    } finally {
      coldStore.close();
    }
    const cold = storeRows(coldPath);
    // How many writes the re-index makes when nothing kills it.
    const whole = join(base, "whole");
    cpSync(start, whole, { recursive: true });
    const unkilled = await killAt(whole, 0);
    const writes = Number(/^not killed (\d+)/.exec(unkilled.out)?.[1]);
    const scoped = Number(/ scoped (\d+)/.exec(unkilled.out)?.[1]);
    assert.ok(writes > 0, unkilled.out);
    assert.deepEqual(compareRows(storeRows(graph(whole)), cold), []);
    for (let n = 1; n <= writes; n++) {
      const root = join(base, `kill-${n}`);
      cpSync(start, root, { recursive: true });
      const killed = await killAt(root, n);
      assert.equal(killed.signal, "SIGKILL", `kill ${n}: ${killed.out}`);
      // Only a run whose completion record committed (its last write) is
      // reported complete.
      const status = await executeGraph({ command: "status", root });
      assert.equal(status.sync.complete, n === writes, `kill ${n}: status`);
      const repaired = await executeGraph({ command: "index", root });
      assert.equal(repaired.sync.complete, true, `kill ${n}: repaired`);
      assert.deepEqual(
        compareRows(storeRows(graph(root)), cold),
        [],
        `kill ${n} of ${writes}: one re-index after the kill equals a cold index`,
      );
      rmSync(root, { recursive: true, force: true });
    }
    return { writes, scoped };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

const tsA = `export function hello(): string {
  return "hello";
}

export function other(): number {
  return 1;
}
`;
test("TypeScript: a re-index killed after any write is repaired by the next one", async (t) => {
  const { writes: tried } = await everyKillPoint(
    {
      "package.json": JSON.stringify({ name: "fixture", private: true }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true },
        include: ["src"],
      }),
      "src/a.ts": tsA,
      "src/b.ts":
        'import { hello, other } from "./a";\n\nexport const b = hello() + other();\n',
      "src/c.ts":
        'import { other } from "./a";\n\nexport const c = other() + 1;\n',
    },
    // Moves every declaration of a.ts: the other files' recorded facts change.
    { "src/a.ts": "// moved\n" + tsA },
  );
  assert.ok(tried >= 6, `write boundaries tried: ${tried}`);
  t.diagnostic(`write boundaries: ${tried}`);
});

test("TypeScript: a killed scoped re-index is repaired by the next one", async (t) => {
  const { writes, scoped } = await everyKillPoint(
    {
      "package.json": JSON.stringify({ name: "fixture", private: true }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true },
        include: ["src"],
      }),
      "src/a.ts": tsA,
      "src/b.ts":
        'import { hello, other } from "./a";\n\nexport const b = hello() + other();\n',
      "src/c.ts":
        'import { other } from "./a";\n\nexport const c = other() + 1;\n',
      "src/d.ts": "export const unrelated = 1;\n",
    },
    // A body edit below a new leading comment: only a.ts is extracted, and
    // b.ts and c.ts keep their facts with a.ts's moved keys (C-38).
    {
      "src/a.ts":
        "// moved\n" + tsA.replace("  return 1;", "  void 0;\n  return 1;"),
    },
  );
  assert.equal(scoped, 1, "the unkilled re-index took the scoped path");
  assert.ok(writes >= 3, `write boundaries tried: ${writes}`);
  t.diagnostic(`write boundaries: ${writes}`);
});

test("Go: a re-index killed after any write is repaired by the next one", async (t) => {
  const { writes: tried } = await everyKillPoint(
    {
      "go.mod": "module example.com/m\n\ngo 1.22\n",
      "a/a.go": "package a\n\nfunc Hello() error { return nil }\n",
      "b/b.go":
        'package b\n\nimport "example.com/m/a"\n\nfunc B() error { return a.Hello() }\n',
      "b/c.go": "package b\n\nfunc C() error { return B() }\n",
    },
    // A package-level declaration shadows `error` in both files of b.
    { "b/shadow.go": "package b\n\ntype error = int\n" },
  );
  assert.ok(tried >= 6, `write boundaries tried: ${tried}`);
  t.diagnostic(`write boundaries: ${tried}`);
});

test("Go: a killed scoped re-index is repaired by the next one", async (t) => {
  const { writes: tried } = await everyKillPoint(
    {
      "go.mod": "module example.com/m\n\ngo 1.22\n",
      "a/a.go": "package a\nfunc Existing() {}\n",
      "b/b.go":
        'package b\nimport "example.com/m/a"\nfunc Use() { a.Added() }\n',
      "independent/other.go": "package independent\nfunc Unrelated() {}\n",
    },
    { "a/a.go": "package a\nfunc Existing() {}\nfunc Added() {}\n" },
  );
  assert.ok(tried >= 3, `write boundaries tried: ${tried}`);
  t.diagnostic(`write boundaries: ${tried}`);
});

test("Go: a killed body edit with promoted method facts is repaired by one index", async (t) => {
  const body = "package p\nfunc Call(c Carrier) int { return c.M() }\n";
  const { writes: tried } = await everyKillPoint(
    {
      "a.go": body,
      "b.go":
        "package p\ntype I interface{ M() int }\ntype Base struct{}\nfunc (Base) M() int { return 1 }\ntype Carrier struct { Base }\ntype Empty struct{}\n",
    },
    { "a.go": body.replace("return c.M()", "return c.M() + 1") },
  );
  assert.ok(tried >= 3, `write boundaries tried: ${tried}`);
  t.diagnostic(`write boundaries: ${tried}`);
});

test("Rust: a re-index killed after any write is repaired by the next one", async (t) => {
  const { writes: tried } = await everyKillPoint(
    {
      "Cargo.toml":
        '[package]\nname = "fixture"\nversion = "0.1.0"\nedition = "2021"\n',
      "src/lib.rs": "pub mod a;\npub mod b;\npub mod c;\n",
      "src/a.rs": "pub fn hello() -> u32 {\n    1\n}\n",
      "src/b.rs":
        "use crate::a::hello;\n\npub fn b() -> u32 {\n    hello()\n}\n",
      "src/c.rs":
        "use crate::a::*;\n\npub fn c() -> u32 {\n    hello() + 1\n}\n",
    },
    // The target moves behind a cfg: both callers' facts change.
    {
      "src/a.rs": '#[cfg(feature = "x")]\npub fn hello() -> u32 {\n    1\n}\n',
    },
  );
  assert.ok(tried >= 6, `write boundaries tried: ${tried}`);
  t.diagnostic(`write boundaries: ${tried}`);
});
