// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SqliteGraphStore,
  indexProject,
  LanguageRegistry,
  checkLanguageConformance,
} from "../dist/graph/index.js";
import toy from "../dist/graph/languages/toy/index.js";

// Toy facts plus resolver-derived links: each function gets a definite
// self-reference and, when there are several functions, a candidate set.
function generatedModule() {
  return {
    ...toy,
    resolve({ symbols, links }) {
      const named = new Map();
      for (const symbol of symbols.filter(
        (s) => s.kind === "function" && s.status !== "failed",
      )) {
        const group = named.get(symbol.name) ?? [];
        group.push(symbol.id);
        named.set(symbol.name, group);
      }
      const resolutions = links.flatMap((link) => {
        const targets = named.get(link.targetName) ?? [];
        if (!targets.length) return [];
        if (targets.length > 1)
          return [{ linkId: link.id, candidateIds: targets }];
        return [{ linkId: link.id, targetId: targets[0] }];
      });
      return {
        resolutions,
        links: symbols
          .filter((s) => s.kind === "function" && s.status !== "failed")
          .flatMap((s) => {
            const pool = [...named.values()].flat();
            return [
              {
                key: `${s.key}:definite`,
                file: s.file,
                sourceId: s.id,
                kind: "references",
                targetName: "implicit-definite",
                range: s.range,
                targetId: s.id,
              },
              {
                key: `${s.key}:possible`,
                file: s.file,
                sourceId: s.id,
                kind: "implements",
                targetName: "implicit-possible",
                range: s.range,
                ...(pool.length >= 2
                  ? { candidateIds: pool }
                  : { targetId: s.id }),
              },
            ];
          }),
      };
    },
  };
}

test("kit rejects offset identities even when the author expects those identities", async () => {
  const text = "def f\ncall missing\n";
  const broken = {
    ...toy,
    parse(input) {
      const result = toy.parse(input);
      for (const symbol of result.symbols)
        if (symbol.kind === "function")
          symbol.identity = `${symbol.name}@${symbol.range.start}`;
      return result;
    },
  };
  const expected = {
    symbols: [
      {
        file: "x.toy",
        name: "x.toy",
        identity: "x.toy",
        kind: "file",
        at: text,
      },
      {
        file: "x.toy",
        name: "f",
        identity: "f@0",
        kind: "function",
        at: "def f",
      },
    ],
    links: [
      {
        file: "x.toy",
        kind: "calls",
        targetName: "missing",
        source: { name: "f", kind: "function" },
        target: null,
        at: "call missing",
      },
    ],
  };
  await assert.rejects(
    checkLanguageConformance(broken, [{ path: "x.toy", text }], expected),
    /IDs survive an edit above every symbol/,
  );
});

test("decoded snapshots are isolated, cold queries avoid source records, and external replacements are visible", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-core-cold-"));
  let store, second;
  try {
    const root = join(scratch, "project");
    await mkdir(root);
    await writeFile(join(root, "x.toy"), "def x\ncall missing\n");
    const database = join(scratch, "graph.sqlite");
    store = new SqliteGraphStore(database, "cold");
    await indexProject(root, new LanguageRegistry([toy]), store);
    const original = structuredClone(store.getFile("x.toy"));
    store.files()[0].result.symbols[0].identity = "mutated";
    store.getFile("x.toy").text = "mutated";
    assert.deepEqual(store.getFile("x.toy"), original);
    second = new SqliteGraphStore(database);
    second.files = () => assert.fail("Queries must not load source records");
    second.getFile = () => assert.fail("Queries must not load source records");
    const symbol = second.findSymbols({ name: "x" })[0];
    assert.equal(second.outgoing(symbol.id).length, 1);
    assert.equal(second.incoming(symbol.id).length, 0);
    assert.equal(second.neighbourhood(symbol.id, 2).links.length, 1);
    assert.equal(second.unresolved().length, 1);
    second.replaceFile({
      ...original,
      text: "def changed\n",
      result: toy.parse({ path: "x.toy", text: "def changed\n" }),
    });
    assert.equal(store.getFile("x.toy").text, "def changed\n");
    assert.equal(store.files()[0].result.symbols[1].identity, "changed");
  } finally {
    second?.close();
    store?.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("direct partial and failed replacements invalidate incoming definite and derived-candidate links", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-core-status-"));
  let store;
  try {
    const root = join(scratch, "project");
    await mkdir(root);
    for (const [path, text] of Object.entries({
      "target.toy": "def target\ndef second\n",
      "caller.toy": "def caller\ncall target\n",
      "survivor.toy": "def survivor\n",
    }))
      await writeFile(join(root, path), text);
    store = new SqliteGraphStore(join(scratch, "store.sqlite"), "status");
    const registry = new LanguageRegistry([generatedModule()]);
    await indexProject(root, registry, store);
    const original = store.getFile("target.toy");
    const target = store.findSymbols({ name: "target" })[0];
    assert.equal(store.incoming(target.id, "calls").length, 1);
    assert.ok(
      store
        .incoming(target.id, "implements")
        .some(
          (link) => link.file === "caller.toy" && link.candidates.length >= 3,
        ),
    );
    for (const status of ["partial", "failed"]) {
      const file = {
        ...original,
        result: {
          ...original.result,
          status,
          diagnostics: [{ message: `direct ${status} qualification` }],
        },
      };
      store.replaceFile(file);
      // Do not re-index here: resolution must not repair and hide failed-target invalidation.
      if (status === "partial") {
        assert.equal(
          store.incoming(target.id, "calls")[0].targetStatus,
          "partial",
        );
        // The caller's candidate link survives with every candidate; the two
        // symbols of the replaced file (target and second) are now partial.
        const callerLink = store
          .incoming(target.id, "implements")
          .find((link) => link.file === "caller.toy");
        assert.ok(callerLink, "the caller's candidate link survives");
        assert.deepEqual(
          callerLink.candidates.map(({ id, status }) => [id, status]),
          [
            [
              "symbol:5f8c8ae4d4c316e22b6c5f5114bcd7d4716e89b05ef101b471470d3cc9704aaa",
              "clean",
            ],
            [
              "symbol:5ffb272fcb1afdc71e6474802e8f602de793caca33db6acb67ee001a5e00dae4",
              "partial",
            ],
            [
              "symbol:684c6601f8447b899bb7dc20ba9394dd5315097a84430e96e82a42ceb83d3489",
              "partial",
            ],
            [
              "symbol:d581d6424c02d95c475d4529e8ef2956a6b5ce113363ac030fdbb435c4c1f7aa",
              "clean",
            ],
          ],
        );
        assert.equal(
          target.id,
          "symbol:684c6601f8447b899bb7dc20ba9394dd5315097a84430e96e82a42ceb83d3489",
        );
      } else {
        assert.equal(store.incoming(target.id).length, 0);
        assert.ok(
          store
            .unresolved()
            .some(
              (link) =>
                link.file === "caller.toy" && link.targetName === "target",
            ),
        );
      }
    }
  } finally {
    store?.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
