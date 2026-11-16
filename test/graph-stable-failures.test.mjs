// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeGraph } from "../dist/graph/commands.js";
import {
  discoverLanguages,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import { injectedExtractionFaults } from "../dist/graph/languages/typescript/index.js";

const clean = () => ({
  status: "clean",
  diagnostics: [],
  symbols: [],
  links: [],
});
async function project(files, run) {
  const root = await mkdtemp(join(tmpdir(), "pym-stable-failures-"));
  try {
    for (const [path, text] of Object.entries(files))
      await writeFile(join(root, path), text);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const database = (root) =>
  join(root, ".pymtheg", "rebuildable", "graph.sqlite");
function checkpoint(root) {
  const store = new SqliteGraphStore(database(root));
  try {
    return store.graphCommandState();
  } finally {
    store.close();
  }
}
const answerOnly = ({ sync, ...rest }) => rest;
const broken = {
  "bad.go": "package p\nfunc bad( {",
  "bad.rs": "fn bad( {",
  "bad.js": "function bad( {",
  "bad.ts": "function bad( {",
};

test("warm Go/Rust/JS/TS content failures skip indexing, remain named, and each edit invalidates only that source", async () => {
  await project(
    { ...broken, "good.ts": "export function good() { return 1; }" },
    async (root) => {
      const run = () =>
        executeGraph({ root, command: "search", args: ["good"] });
      let first = await run();
      const paths = Object.keys(broken).sort();
      assert.deepEqual(
        first.failedFiles.map((f) => f.path),
        paths,
      );
      assert.equal(first.sync.complete, true);
      assert.ok(checkpoint(root));
      for (let i = 0; i < 3; i++) {
        const phases = [];
        const warm = await executeGraph(
          { root, command: "search", args: ["good"] },
          { progress: (p) => phases.push(p) },
        );
        assert.equal(warm.sync.mode, "unchanged");
        assert.equal(warm.sync.report, null);
        assert.deepEqual(phases, []);
        assert.equal(
          JSON.stringify(answerOnly(warm)),
          JSON.stringify(answerOnly(first)),
        );
        assert.deepEqual(
          warm.warnings.find((w) => w.code === "failed-files").files,
          paths,
        );
      }
      // A lost marker (e.g. a direct replaceFile) must be recovered even when
      // the module uses its unchanged-snapshot analysis path.
      const store = new SqliteGraphStore(database(root));
      try {
        store.replaceFile(store.getFile("bad.js"));
      } finally {
        store.close();
      }
      const recertified = await run();
      assert.equal(recertified.sync.mode, "updated");
      assert.equal(recertified.sync.report.indexed, 1);
      assert.equal(recertified.sync.complete, true);
      assert.equal((await run()).sync.mode, "unchanged");
      const fixes = {
        "bad.js": "function fixedJS() {}",
        "bad.ts": "function fixedTS() {}",
        "bad.go": "package p\nfunc FixedGo() {}",
        "bad.rs": "fn fixed_rust() {}",
      };
      for (const [path, text] of Object.entries(fixes)) {
        await writeFile(join(root, path), text);
        const fixed = await run();
        assert.equal(fixed.sync.mode, "updated");
        assert.equal(fixed.sync.complete, true);
        assert.equal(fixed.sync.report.indexed, 1);
        assert.equal(fixed.sync.report.unchanged, 4);
        paths.splice(paths.indexOf(path), 1);
        assert.deepEqual(
          fixed.failedFiles.map((f) => f.path),
          paths,
        );
        const warm = await run();
        assert.equal(warm.sync.mode, "unchanged");
        assert.equal(
          JSON.stringify(answerOnly(warm)),
          JSON.stringify(answerOnly(fixed)),
        );
      }
    },
  );
});

test("module-version changes retry stored JS/TS content failures; context changes rebuild analysis", async () => {
  await project(
    {
      "bad.js": broken["bad.js"],
      "bad.ts": broken["bad.ts"],
      "good.ts": "export const good = 1;",
    },
    async (root) => {
      const registry = await discoverLanguages();
      const run = (reg) =>
        executeGraph(
          { root, command: "search", args: ["good"] },
          { registry: reg },
        );
      assert.equal((await run(registry)).sync.complete, true);
      assert.equal((await run(registry)).sync.mode, "unchanged");
      let changed;
      const bumped = new LanguageRegistry(
        registry.modules.map((m) =>
          m.id === "typescript"
            ? {
                ...m,
                version: m.version + "-test",
                analyze(c) {
                  changed = c.changedFiles;
                  return m.analyze(c);
                },
              }
            : m,
        ),
      );
      const retry = await run(bumped);
      assert.deepEqual(changed, ["bad.js", "bad.ts", "good.ts"]);
      assert.equal(retry.sync.report.indexed, 3);
      assert.equal(retry.sync.complete, true);
      assert.equal((await run(bumped)).sync.mode, "unchanged");
      await writeFile(
        join(root, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true } }),
      );
      const context = await run(bumped);
      assert.equal(context.sync.mode, "updated");
      assert.equal(context.sync.complete, true);
      assert.equal((await run(bumped)).sync.mode, "unchanged");
    },
  );
});

test("real TypeScript operational failures are retried and never publish completion", async () => {
  await project(
    { "fault.ts": "export function good() { return 1; }" },
    async (root) => {
      injectedExtractionFaults.add("fault.ts");
      const run = () =>
        executeGraph({ root, command: "search", args: ["good"] });
      try {
        for (let i = 0; i < 2; i++) {
          const result = await run();
          assert.equal(result.sync.mode, "updated");
          assert.equal(result.sync.complete, false);
          assert.equal(result.sync.report.indexed, 1);
          assert.deepEqual(
            result.failedFiles.map((f) => f.path),
            ["fault.ts"],
          );
          assert.match(result.failedFiles[0].reason, /Internal error/);
          assert.equal(checkpoint(root), null);
        }
      } finally {
        injectedExtractionFaults.delete("fault.ts");
      }
      const recovered = await run();
      assert.equal(recovered.sync.complete, true);
      assert.deepEqual(recovered.failedFiles, []);
      assert.equal((await run()).sync.mode, "unchanged");
    },
  );
});

test("unclassified/context-dependent analysis failures, thrown analysis and bad output remain retryable", async () => {
  for (const kind of ["unclassified", "transient", "throw", "invalid"])
    await project({ "a.x": "x" }, async (root) => {
      let calls = 0;
      const registry = new LanguageRegistry([
        {
          id: "x",
          version: "1",
          extensions: [".x"],
          analyze() {
            calls++;
            if (kind === "throw") throw Error("analysis crashed");
            return [
              {
                path: "a.x",
                result: {
                  status: "failed",
                  diagnostics: [{ message: "context-dependent failure" }],
                  symbols: [],
                  links: [],
                  ...(kind === "transient"
                    ? { failureKind: "transient" }
                    : kind === "invalid"
                      ? { failureKind: "Content" }
                      : {}),
                },
              },
            ];
          },
        },
      ]);
      for (let i = 1; i <= 2; i++) {
        const result = await executeGraph(
          { root, command: "search", args: ["x"] },
          { registry },
        );
        assert.equal(calls, i);
        assert.equal(result.sync.mode, "updated");
        assert.equal(result.sync.complete, false);
        assert.equal(checkpoint(root), null);
      }
    });
});

test("only explicit file-local content certification from an analyze-only module is cached", async () => {
  await project({ "a.x": "x" }, async (root) => {
    let calls = 0;
    const registry = new LanguageRegistry([
      {
        id: "x",
        version: "1",
        extensions: [".x"],
        analyze() {
          calls++;
          return [
            {
              path: "a.x",
              result: {
                ...clean(),
                status: "failed",
                failureKind: "content",
                diagnostics: [{ message: "syntax" }],
              },
            },
          ];
        },
      },
    ]);
    const run = () =>
      executeGraph({ root, command: "search", args: ["x"] }, { registry });
    assert.equal((await run()).sync.complete, true);
    assert.equal((await run()).sync.mode, "unchanged");
    assert.equal(calls, 1);
  });
});

test("configuration failures and Program-only JS syntax diagnostics are not certified as per-file content failures", async () => {
  for (const files of [
    { "a.ts": "export const good = 1;", "tsconfig.json": "{ invalid" },
    { "a.js": "const good: number = 1;" },
  ])
    await project(files, async (root) => {
      for (let i = 0; i < 2; i++) {
        const result = await executeGraph({
          root,
          command: "search",
          args: ["good"],
        });
        assert.equal(result.sync.mode, "updated");
        assert.equal(result.sync.complete, false);
        assert.equal(result.failedFiles.length, 1);
        assert.equal(checkpoint(root), null);
      }
    });
});
