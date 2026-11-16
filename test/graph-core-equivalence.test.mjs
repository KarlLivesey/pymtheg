// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readFile,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SqliteGraphStore,
  indexProject,
  LanguageRegistry,
  checkLanguageConformance,
} from "../dist/graph/index.js";
import { SqliteGraphStore as ReferenceStore } from "./fixtures/graph-core/reference/store.mjs";
import { indexProject as referenceIndex } from "./fixtures/graph-core/reference/indexer.mjs";
import toy from "../dist/graph/languages/toy/index.js";

const snapshot = (store) => ({
  files: store.files(),
  contexts: store.contexts(),
  symbols: store.findSymbols(),
  links: store.links(),
  unresolved: store.unresolved(),
  ambiguous: store.ambiguous(),
});
function generatedModule() {
  return {
    ...toy,
    contextFiles: ["project.cfg"],
    parse(input) {
      if (input.text.includes("!fail")) throw Error("generated parse error");
      return toy.parse(input);
    },
    analyze({ files, contextFiles }) {
      if (contextFiles[0]?.text === "analysis-error")
        throw Error("generated analysis error");
      return files.map((file) => ({ path: file.path, result: file.result }));
    },
    resolve({ symbols, links, contextFiles }) {
      const mode = contextFiles[0]?.text;
      if (mode === "resolver-error") throw Error("generated resolver error");
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
        if (mode === "invalid-target")
          return [{ linkId: link.id, targetId: "absent" }];
        if (!targets.length) return [];
        if (targets.length > 1 && mode !== "definite")
          return [{ linkId: link.id, candidateIds: targets }];
        return [
          {
            linkId: link.id,
            targetId: targets[mode === "definite" ? targets.length - 1 : 0],
          },
        ];
      });
      if (mode === "duplicate" && resolutions.length)
        resolutions.push(resolutions[0]);
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

test("fixed-seed edit sequences match the frozen pre-W2-I indexer, resolution and complete store", async () => {
  let seed = 0x71c09;
  const random = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const modes = [
    "normal",
    "definite",
    "resolver-error",
    "invalid-target",
    "duplicate",
    "analysis-error",
  ];
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-core-equivalence-"));
  try {
    for (let project = 0; project < 24; project++) {
      const root = join(scratch, String(project));
      await mkdir(root);
      const fast = new SqliteGraphStore(
        join(scratch, `fast-${project}.sqlite`),
        "equivalence",
      );
      const slow = new ReferenceStore(
        join(scratch, `slow-${project}.sqlite`),
        "equivalence",
      );
      const registry = new LanguageRegistry([generatedModule()]);
      const compare = async (label) => {
        const expected = await referenceIndex(root, registry, slow);
        const actual = await indexProject(root, registry, fast);
        assert.deepEqual(actual, expected, `${project}: ${label}: reports`);
        assert.deepEqual(
          snapshot(fast),
          snapshot(slow),
          `${project}: ${label}: complete facts`,
        );
        for (const symbol of fast.findSymbols()) {
          assert.deepEqual(
            fast.findSymbols({
              name: symbol.name,
              kind: symbol.kind,
              file: symbol.file,
            }),
            slow.findSymbols({
              name: symbol.name,
              kind: symbol.kind,
              file: symbol.file,
            }),
          );
          for (const kind of [undefined, "calls", "implements", "absent"]) {
            assert.deepEqual(
              fast.outgoing(symbol.id, kind),
              slow.outgoing(symbol.id, kind),
            );
            assert.deepEqual(
              fast.incoming(symbol.id, kind),
              slow.incoming(symbol.id, kind),
            );
          }
        }
        const symbols = fast.findSymbols();
        const sample = [
          ...new Set([...symbols.slice(0, 5), ...symbols.slice(-1)]),
        ];
        for (const symbol of sample)
          for (const depth of [0, 1, 2, 5])
            for (const kind of [undefined, "calls"])
              assert.deepEqual(
                fast.neighbourhood(symbol.id, depth, kind),
                slow.neighbourhood(symbol.id, depth, kind),
                `${project}: ${label}: neighbourhood ${symbol.id}/${depth}/${kind}`,
              );
      };
      try {
        // Guaranteed ambiguity, missing names, repeated identities and partial files.
        await writeFile(
          join(root, "0.toy"),
          "def a\ncall a\ndef a\ncall missing\n",
        );
        for (let i = 1; i < 7; i++)
          await writeFile(
            join(root, `${i}.toy`),
            `# 😀\ndef ${"abc"[random(3)]}\ncall ${["a", "b", "c", "missing"][random(4)]}\n${i === 2 ? "partial syntax\n" : ""}`,
          );
        await writeFile(join(root, "project.cfg"), "normal");
        await compare("initial");
        const bytes = await readFile(join(scratch, `fast-${project}.sqlite`));
        await compare("unchanged");
        assert.deepEqual(
          await readFile(join(scratch, `fast-${project}.sqlite`)),
          bytes,
        );
        await writeFile(join(root, "1.toy"), "\ndef renamed\ncall a\n");
        await compare("rename/edit");
        await rm(join(root, "2.toy"));
        await compare("delete");
        await rename(join(root, "4.toy"), join(root, "moved.toy"));
        await compare("file move");
        await writeFile(join(root, "3.toy"), "!fail");
        await compare("parser error");
        await writeFile(join(root, "3.toy"), "def recovered\ncall b\n");
        for (const mode of modes) {
          await writeFile(join(root, "project.cfg"), mode);
          await compare(`context ${mode}`);
        }
        await rm(join(root, "project.cfg"));
        await compare("context deletion");
        // Direct API invalidation retains surviving candidates without claiming certainty.
        slow.removeFile("0.toy");
        fast.removeFile("0.toy");
        assert.deepEqual(snapshot(fast), snapshot(slow));
        const decisions = fast
          .links()
          .filter((l) => l.origin === "parse")
          .map((l) => ({ linkId: l.id, targetId: null }));
        slow.resolveLinks(decisions);
        fast.resolveLinks(decisions);
        assert.deepEqual(snapshot(fast), snapshot(slow));
      } finally {
        fast.close();
        slow.close();
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

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
  let fast, slow;
  try {
    const root = join(scratch, "project");
    await mkdir(root);
    for (const [path, text] of Object.entries({
      "target.toy": "def target\ndef second\n",
      "caller.toy": "def caller\ncall target\n",
      "survivor.toy": "def survivor\n",
    }))
      await writeFile(join(root, path), text);
    fast = new SqliteGraphStore(join(scratch, "fast.sqlite"), "status");
    slow = new ReferenceStore(join(scratch, "slow.sqlite"), "status");
    const registry = new LanguageRegistry([generatedModule()]);
    await indexProject(root, registry, fast);
    await referenceIndex(root, registry, slow);
    const original = fast.getFile("target.toy");
    const target = fast.findSymbols({ name: "target" })[0];
    const assertEqual = () => {
      assert.deepEqual(snapshot(fast), snapshot(slow));
      for (const symbol of fast.findSymbols())
        for (const kind of [undefined, "calls", "implements", "references"]) {
          assert.deepEqual(
            fast.incoming(symbol.id, kind),
            slow.incoming(symbol.id, kind),
          );
          assert.deepEqual(
            fast.neighbourhood(symbol.id, 2, kind),
            slow.neighbourhood(symbol.id, 2, kind),
          );
        }
    };
    assert.equal(fast.incoming(target.id, "calls").length, 1);
    assert.ok(
      fast
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
      fast.replaceFile(file);
      slow.replaceFile(file);
      // Do not re-index here: resolution must not repair and hide failed-target invalidation.
      assertEqual();
      if (status === "partial") {
        assert.equal(
          fast.incoming(target.id, "calls")[0].targetStatus,
          "partial",
        );
        assert.ok(
          fast
            .incoming(target.id, "implements")
            .every(
              (link) =>
                link.candidates.find((candidate) => candidate.id === target.id)
                  .status === "partial",
            ),
        );
      } else {
        assert.equal(fast.incoming(target.id).length, 0);
        assert.ok(
          fast
            .unresolved()
            .some(
              (link) =>
                link.file === "caller.toy" && link.targetName === "target",
            ),
        );
      }
    }
  } finally {
    fast?.close();
    slow?.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
