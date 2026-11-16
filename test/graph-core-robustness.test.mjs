// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SqliteGraphStore,
  LanguageRegistry,
  indexProject,
} from "../dist/graph/index.js";

const clean = () => ({
  status: "clean",
  diagnostics: [],
  symbols: [],
  links: [],
});
async function project(run) {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-w2-m-"));
  const root = join(scratch, "sources");
  await mkdir(root);
  const database = join(scratch, "graph.sqlite");
  let store = new SqliteGraphStore(database, "robustness");
  const reopen = () => {
    store.close();
    return (store = new SqliteGraphStore(database, "robustness"));
  };
  try {
    await run({ root, database, store, reopen });
  } finally {
    store.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

test("module analysis uses row-sized JSON on writes, equality, reads and reopen", async () => {
  await project(async ({ store, reopen, database }) => {
    store.replaceFile({
      path: "a.x",
      text: "x",
      hash: "hash",
      module: "x",
      version: "1",
      result: {
        ...clean(),
        symbols: [
          {
            key: "target",
            name: "target",
            identity: "target",
            kind: "function",
            range: { start: 0, end: 1 },
          },
        ],
      },
    });
    const links = Array.from({ length: 300 }, (_, i) => ({
      key: String(i),
      file: "a.x",
      sourceId: null,
      kind: "references",
      targetName: `unknown-${i}`,
      range: { start: 0, end: 1 },
      data: { text: '😀\\"'.repeat(30) },
    }));
    const result = { links, resolutions: [] };
    const stringify = JSON.stringify;
    const parse = JSON.parse;
    const limit = 4096;
    assert.ok(stringify(result).length > limit * 10);
    let largest = 0;
    // Inject a small string ceiling at the serialization boundary. A whole-array
    // implementation fails deterministically without allocating V8-limit strings.
    JSON.stringify = (...args) => {
      const body = stringify(...args);
      if (body !== undefined) {
        largest = Math.max(largest, body.length);
        assert.ok(body.length <= limit, `oversized JSON write: ${body.length}`);
      }
      return body;
    };
    JSON.parse = (body, ...args) => {
      assert.ok(body.length <= limit, `oversized JSON read: ${body.length}`);
      return parse(body, ...args);
    };
    try {
      store.replaceAnalysis("x", result);
      const before = await readFile(database);
      store.replaceAnalysis("x", result);
      assert.deepEqual(await readFile(database), before);
      store = reopen();
      assert.equal(store.links().length, links.length);
      const targetId = store.findSymbols()[0].id;
      store.resolveLinks(
        store.links().map((link) => ({ linkId: link.id, targetId })),
      );
      assert.ok(store.links().every((link) => link.targetId === targetId));
      store.resolveLinks(
        store.links().map((link) => ({ linkId: link.id, targetId })),
      );
      store.resolveLinks([]);
      assert.ok(
        store.links().every((link) => link.resolution === "unresolved"),
      );
      store.replaceAnalysis("x", result);
      const changed = {
        ...result,
        links: links
          .slice(1)
          .map((link, i) =>
            i === 0 ? { ...link, targetName: "changed" } : link,
          ),
      };
      store.replaceAnalysis("x", changed);
      const actual = store.links();
      assert.equal(actual.length, 299);
      assert.equal(
        actual.filter((link) => link.targetName === "changed").length,
        1,
      );
      assert.deepEqual(
        actual.map((link) => link.data),
        changed.links.map((link) => link.data),
      );
      assert.throws(
        () =>
          store.replaceAnalysis("x", {
            ...result,
            links: [...links, links[0]],
          }),
        /duplicate/,
      );
      assert.deepEqual(store.links(), actual);
      store.replaceAnalysis("x", { links: [], resolutions: [] });
      assert.deepEqual(store.links(), []);
      assert.ok(largest > 0);
    } finally {
      JSON.stringify = stringify;
      JSON.parse = parse;
    }
  });
});

test("failed parses are cached across unchanged runs and reopen; edits and versions invalidate", async () => {
  await project(async ({ root, database, store, reopen }) => {
    const parsed = [];
    const module = {
      id: "x",
      version: "1",
      extensions: [".x"],
      parse({ path, text }) {
        parsed.push(path);
        if (text === "other-bad")
          return {
            ...clean(),
            status: "failed",
            diagnostics: [{ message: "other broken syntax" }],
          };
        return text === "bad"
          ? {
              ...clean(),
              status: "failed",
              diagnostics: [
                { message: "broken syntax", range: { start: 1, end: 2 } },
              ],
            }
          : clean();
      },
    };
    const registry = () => new LanguageRegistry([module]);
    for (const [path, text] of [
      ["z.x", "other-bad"],
      ["a.x", "bad"],
      ["good.x", "ok"],
    ])
      await writeFile(join(root, path), text);
    let report = await indexProject(root, registry(), store);
    assert.deepEqual(parsed, ["a.x", "good.x", "z.x"]);
    assert.deepEqual(report.failed, ["a.x", "z.x"]);
    const expected = [
      {
        path: "a.x",
        language: "x",
        reason: "broken syntax",
        range: { start: 1, end: 2 },
      },
      { path: "z.x", language: "x", reason: "other broken syntax" },
    ];
    assert.deepEqual(store.failedFiles(), expected);
    const bytes = await readFile(database);
    parsed.length = 0;
    report = await indexProject(root, registry(), store);
    assert.deepEqual(parsed, []);
    assert.equal(report.indexed, 0);
    assert.equal(report.unchanged, 3);
    assert.deepEqual(report.failed, ["a.x", "z.x"]);
    assert.deepEqual(await readFile(database), bytes);
    store = reopen();
    assert.deepEqual(store.failedFiles(), expected);
    const returned = store.failedFiles();
    returned[0].range.start = 0;
    assert.deepEqual(store.failedFiles(), expected);
    await indexProject(root, registry(), store);
    assert.deepEqual(parsed, []);
    await writeFile(join(root, "a.x"), "fixed");
    await indexProject(root, registry(), store);
    assert.deepEqual(parsed, ["a.x"]);
    assert.deepEqual(store.failedFiles(), expected.slice(1));
    parsed.length = 0;
    module.version = "2";
    await indexProject(root, registry(), store);
    assert.deepEqual(parsed, ["a.x", "good.x", "z.x"]);
    await rm(join(root, "z.x"));
    await indexProject(root, registry(), store);
    assert.deepEqual(store.failedFiles(), []);
  });
});

test("project failures remain retryable and cannot be mistaken for cached parse failures", async () => {
  await project(async ({ root, store, reopen }) => {
    await writeFile(join(root, "a.x"), "ok");
    let fail = true;
    let parses = 0;
    const module = {
      id: "x",
      version: "1",
      extensions: [".x"],
      parse() {
        parses++;
        return clean();
      },
      analyze() {
        if (fail) throw Error("project failed");
        return [];
      },
    };
    const registry = new LanguageRegistry([module]);
    assert.equal(
      (await indexProject(root, registry, store)).analysisErrors.length,
      1,
    );
    assert.equal(store.isParseFailure("a.x"), false);
    store = reopen();
    fail = false;
    assert.deepEqual((await indexProject(root, registry, store)).failed, []);
    assert.equal(parses, 2);
  });
});

test("a mutating resolver cannot alter later modules or canonical validation inputs", async () => {
  await project(async ({ root, store }) => {
    await writeFile(join(root, "a.x"), "x");
    await writeFile(join(root, "b.y"), "y");
    await writeFile(join(root, "project.cfg"), "original");
    const parse = () => ({
      ...clean(),
      symbols: [
        {
          key: "s",
          name: "original",
          identity: "s",
          kind: "function",
          range: { start: 0, end: 1 },
          data: { nested: ["original"] },
        },
      ],
      links: [
        {
          sourceKey: "s",
          kind: "calls",
          targetName: "original",
          range: { start: 0, end: 1 },
        },
      ],
    });
    let expected;
    let seen = false;
    const registry = new LanguageRegistry([
      {
        id: "a",
        version: "1",
        extensions: [".x"],
        contextFiles: ["project.cfg"],
        parse,
        resolve(context) {
          expected = structuredClone(context);
          context.files[1].result.symbols[0].data.nested[0] = "corrupt";
          context.files[1].text = "corrupt";
          context.files.reverse();
          context.symbols[0].range.start = 99;
          context.symbols.pop();
          context.links[0].range.start = 99;
          context.contextFiles[0].text = "corrupt";
          return [];
        },
      },
      {
        id: "b",
        version: "1",
        extensions: [".y"],
        contextFiles: ["project.cfg"],
        parse,
        resolve(context) {
          assert.deepEqual(context.files, expected.files);
          assert.deepEqual(context.symbols, expected.symbols);
          assert.deepEqual(context.contextFiles, expected.contextFiles);
          assert.equal(context.links[0].range.start, 0);
          seen = true;
          return [
            { linkId: context.links[0].id, targetId: context.symbols[0].id },
          ];
        },
      },
    ]);
    const report = await indexProject(root, registry, store);
    assert.equal(seen, true);
    assert.deepEqual(report.resolutionErrors, []);
    assert.equal(
      store.links().filter((link) => link.resolution === "resolved").length,
      1,
    );
    assert.equal(store.getFile("b.y").text, "y");
  });
});

test("successful analysis can enrich a failed parse without losing its cache provenance", async () => {
  await project(async ({ root, store, reopen }) => {
    await writeFile(join(root, "a.x"), "bad");
    let parses = 0;
    const registry = new LanguageRegistry([
      {
        id: "x",
        version: "1",
        extensions: [".x"],
        parse() {
          parses++;
          return {
            ...clean(),
            status: "failed",
            diagnostics: [{ message: "syntax" }],
          };
        },
        analyze({ files }) {
          return files.map((file) => ({
            path: file.path,
            result: { ...file.result, data: { analyzed: true } },
          }));
        },
      },
    ]);
    await indexProject(root, registry, store);
    assert.equal(store.isParseFailure("a.x"), true);
    store = reopen();
    const report = await indexProject(root, registry, store);
    assert.equal(parses, 1);
    assert.equal(report.unchanged, 1);
    assert.deepEqual(report.failed, ["a.x"]);
  });
});

test("operational failures and malformed parser output retry unchanged content, including after reopen", async () => {
  const scenarios = [
    ...["parser crash", "timeout", "cancellation", "resource budget"].map(
      (reason) => ({
        reason,
        fail() {
          throw Error(reason);
        },
      }),
    ),
    ...["timeout", "cancellation", "resource budget"].map((reason) => ({
      reason,
      fail() {
        return {
          ...clean(),
          status: "failed",
          failureKind: "transient",
          diagnostics: [{ message: reason }],
        };
      },
    })),
    {
      reason: "invalid facts",
      fail() {
        return {
          ...clean(),
          symbols: [
            {
              key: "x",
              identity: "x",
              name: "x",
              kind: "function",
              range: { start: 0, end: 999 },
            },
          ],
        };
      },
    },
  ];
  for (const scenario of scenarios) {
    await project(async ({ root, store, reopen }) => {
      await writeFile(join(root, "a.x"), "x");
      let parses = 0;
      const registry = new LanguageRegistry([
        {
          id: "x",
          version: "unchanged-version",
          extensions: [".x"],
          parse() {
            return ++parses === 1 ? scenario.fail() : clean();
          },
        },
      ]);
      const first = await indexProject(root, registry, store);
      assert.deepEqual(first.failed, ["a.x"], scenario.reason);
      assert.equal(store.isParseFailure("a.x"), false, scenario.reason);
      store = reopen();
      const second = await indexProject(root, registry, store);
      assert.equal(parses, 2, scenario.reason);
      assert.equal(second.indexed, 1, scenario.reason);
      assert.deepEqual(second.failed, [], scenario.reason);
    });
  }
});
