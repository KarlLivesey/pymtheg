// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkLanguageConformance,
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import { executeGraph } from "../dist/graph/commands.js";
import { formatGraph } from "../dist/cli/graph.js";
import { GraphView } from "../dist/mcp/graph-view.js";
import toy from "../dist/graph/languages/toy/index.js";

const fixture = new URL("./fixtures/graph-library-targets/", import.meta.url);
const registry = new LanguageRegistry([toy]);
async function project(run) {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-library-targets-"));
  const root = join(scratch, "project");
  await cp(fixture, root, { recursive: true });
  try {
    await run(root, scratch);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
const graph = (root, command, ...args) =>
  executeGraph({ command, args, root }, { registry });
const ids = (text) => text.replace(/symbol:[a-f0-9]{64}/g, "symbol:ID");
const zodString =
  "library:e238bc0bfc0620108b21fe4ed43154516d67b90d35ba24f3e0b9fb31385a539d";
const lodashMap =
  "library:844c979480a71108c5e6e42bd3fe8c520b85ab2ce83f304fb40d4753934e0c50";

test("conformance kit: library import, library symbol, unprovable use and mixed candidate set", async () => {
  const text = await readFile(new URL("a.toy", fixture), "utf8");
  const main = { name: "main", kind: "function" };
  await checkLanguageConformance(toy, [{ path: "a.toy", text }], {
    symbols: [
      {
        file: "a.toy",
        name: "a.toy",
        identity: "a.toy",
        kind: "file",
        at: text,
      },
      {
        file: "a.toy",
        name: "main",
        identity: "main",
        kind: "function",
        at: "def main",
      },
      {
        file: "a.toy",
        name: "map",
        identity: "map",
        kind: "function",
        at: "def map",
      },
    ],
    links: [
      {
        file: "a.toy",
        kind: "imports",
        targetName: "zod",
        source: null,
        target: null,
        libraries: [{ ecosystem: "npm", unit: "zod", evidence: "import-path" }],
        at: "use npm:zod",
      },
      {
        file: "a.toy",
        kind: "imports",
        targetName: "lodash",
        source: null,
        target: null,
        libraries: [
          { ecosystem: "npm", unit: "lodash", evidence: "import-path" },
        ],
        at: "use npm:lodash *",
      },
      {
        file: "a.toy",
        kind: "calls",
        targetName: "zod.string",
        source: main,
        target: null,
        libraries: [
          {
            ecosystem: "npm",
            unit: "zod",
            symbol: "string",
            evidence: "import-binding",
          },
        ],
        at: "call zod.string",
      },
      {
        file: "a.toy",
        kind: "calls",
        targetName: "nothere.thing",
        source: main,
        target: null,
        at: "call nothere.thing",
      },
      {
        file: "a.toy",
        kind: "calls",
        targetName: "map",
        source: main,
        target: null,
        candidates: [{ file: "a.toy", name: "map", kind: "function" }],
        libraries: [
          {
            ecosystem: "npm",
            unit: "lodash",
            symbol: "map",
            evidence: "glob-import",
          },
        ],
        at: "call map",
      },
    ],
  });
});

test("CLI and MCP show library targets as outside the project and answer uses", async () => {
  await project(async (root) => {
    const index = await graph(root, "index");
    assert.deepEqual(index.counts, {
      files: 2,
      symbols: 5,
      links: 6,
      failed: 0,
      partial: 0,
      unresolved: 1,
      ambiguous: 1,
      library: 3,
    });
    assert.equal(index.sync.report.library, 3);

    const unit = await graph(root, "uses", "zod");
    assert.equal(unit.status, "ok");
    assert.deepEqual(unit.data.classCounts, { library: 2, candidateSet: 0 });
    // Link order follows link ids, which depend on the project id.
    assert.deepEqual(
      unit.data.links
        .map((link) => [link.certainty, link.targetName, link.libraries])
        .sort((a, b) => (a[1] < b[1] ? -1 : 1)),
      [
        [
          "library",
          "zod",
          [
            {
              id: "library:91067ac286c2964801b10009b40334c7c2abda63ced247c6c20a916628210f2e",
              ecosystem: "npm",
              unit: "zod",
              evidence: "import-path",
              place: "outside-project",
            },
          ],
        ],
        [
          "library",
          "zod.string",
          [
            {
              id: zodString,
              ecosystem: "npm",
              unit: "zod",
              symbol: "string",
              evidence: "import-binding",
              place: "outside-project",
            },
          ],
        ],
      ],
    );
    assert.deepEqual(
      ids(formatGraph(await graph(root, "uses", "zod", "string")))
        .split("\n")
        .slice(1),
      [
        "2 files, 5 symbols, 6 links; 1 unresolved, 1 candidate sets, 3 to libraries outside the project",
        "Sync: unchanged",
        "Failed files (0):",
        "Warning [unresolved-coverage]: Unresolved links may hide additional callers or paths; returned routes are observations, not a completeness proof.",
        'Uses of library "zod" symbol "string" (outside this project): {"library":1,"candidateSet":0}',
        '  library calls: "main" (function) a.toy:3:1-3:9 [UTF-16 29..37] symbol:ID -> library npm "zod" symbol "string" (outside this project; import-binding) at a.toy:4:1-4:16 [UTF-16 38..53]',
        "",
      ],
    );

    const mixed = await graph(root, "uses", "lodash", "map");
    assert.deepEqual(mixed.data.classCounts, { library: 0, candidateSet: 1 });
    assert.match(
      ids(formatGraph(mixed)),
      /candidate-set calls: "main" .* -> one of \["map" \(function\) a\.toy:7:1-7:8 \[UTF-16 82\.\.89\] symbol:ID; library npm "lodash" symbol "map" \(outside this project; glob-import\)\]/,
    );
    const none = await graph(root, "uses", "nothere");
    assert.deepEqual(
      [none.status, none.data.links, none.data.classCounts],
      ["ok", [], { library: 0, candidateSet: 0 }],
    );

    // MCP projection: link rows name the library; candidates mix both kinds.
    const view = new GraphView(await graph(root, "callees", "main"));
    assert.deepEqual(
      view
        .page("links", 0, 20)
        .items.map((row) => [
          row.certainty,
          row.targetName,
          row.target,
          row.candidateCount,
          row.library ?? null,
        ])
        .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
      [
        ["candidate-set", "map", null, 2, null],
        [
          "library",
          "zod.string",
          null,
          0,
          {
            ref: zodString,
            ecosystem: "npm",
            unit: "zod",
            symbol: "string",
            evidence: "import-binding",
            place: "outside-project",
          },
        ],
        ["unresolved", "nothere.thing", null, 0, null],
      ],
    );
    assert.deepEqual(
      view
        .page("candidates", 0, 20)
        .items.map((row) => row.library ?? "symbol"),
      [
        "symbol",
        {
          ref: lodashMap,
          ecosystem: "npm",
          unit: "lodash",
          symbol: "map",
          evidence: "glob-import",
          place: "outside-project",
        },
      ],
    );
    assert.deepEqual(new GraphView(mixed).page("answer", 0, 5).items, [
      {
        type: "library",
        unit: "lodash",
        symbol: "map",
        place: "outside-project",
      },
    ]);
    await assert.rejects(
      graph(root, "uses", "zod", "string", "extra"),
      /argument count/,
    );
  });
});

/** A module that records one deliberately invalid decision on the first call. */
const recording = (decision) => ({
  ...toy,
  resolve(context) {
    const link = context.links.find((item) => item.kind === "calls");
    return [{ linkId: link.id, ...decision }];
  },
});
const zod = { ecosystem: "npm", unit: "zod" };
for (const [label, decision, message] of [
  [
    "without evidence",
    { library: { ...zod, symbol: "string" } },
    /evidence kind/,
  ],
  [
    "with a receiver-type guess",
    { library: { ...zod, symbol: "string", evidence: "receiver-type" } },
    /evidence kind/,
  ],
  [
    "naming a symbol from an import path",
    { library: { ...zod, symbol: "string", evidence: "import-path" } },
    /names a unit, not a symbol/,
  ],
  [
    "as definite from a glob import",
    { library: { ...zod, symbol: "string", evidence: "glob-import" } },
    /only supports a candidate set/,
  ],
  [
    "beside a checkout target",
    {
      targetId: "symbol:x",
      library: { ...zod, evidence: "import-path" },
    },
    /excludes other targets/,
  ],
  [
    "as a one-member candidate set",
    {
      candidateIds: [],
      libraries: [{ ...zod, symbol: "string", evidence: "glob-import" }],
    },
    /at least two distinct targets/,
  ],
  [
    "from a declaring owner without the member",
    { library: { ...zod, evidence: "declaring-owner" } },
    /needs the member's symbol/,
  ],
  [
    "with an invalid ecosystem",
    { library: { ...zod, ecosystem: "NPM", evidence: "import-path" } },
    /ecosystem/,
  ],
])
  test(`the store refuses a library target ${label}`, async () => {
    await project(async (root, scratch) => {
      const store = new SqliteGraphStore(join(scratch, "g.sqlite"), "p");
      try {
        const report = await indexProject(
          root,
          new LanguageRegistry([recording(decision)]),
          store,
        );
        assert.equal(report.resolutionErrors.length, 1);
        assert.match(report.resolutionErrors[0].message, message);
        assert.deepEqual(
          [store.counts().library, store.counts().ambiguous],
          [0, 0],
        );
      } finally {
        store.close();
      }
    });
  });

/** The schema-3 (0.1.0) triggers, as that release created them. */
const schema3Triggers = `CREATE TRIGGER graph_target_changed AFTER UPDATE OF target ON graph_links
  WHEN OLD.target IS NOT NEW.target BEGIN
    UPDATE graph_links SET resolution=CASE WHEN NEW.target IS NOT NULL THEN 'resolved'
      WHEN EXISTS(SELECT 1 FROM graph_candidates WHERE link=NEW.id) THEN 'ambiguous' ELSE 'unresolved' END WHERE id=NEW.id;
  END;
  CREATE TRIGGER graph_candidate_removed AFTER DELETE ON graph_candidates BEGIN
    UPDATE graph_links SET resolution=CASE WHEN target IS NOT NULL THEN 'resolved'
      WHEN EXISTS(SELECT 1 FROM graph_candidates WHERE link=OLD.link) THEN 'ambiguous' ELSE 'unresolved' END
      WHERE id=OLD.link AND resolution IS NOT CASE WHEN target IS NOT NULL THEN 'resolved'
      WHEN EXISTS(SELECT 1 FROM graph_candidates WHERE link=OLD.link) THEN 'ambiguous' ELSE 'unresolved' END;
  END;`;

test("a 0.1.0 (schema 3) graph reads as having no library targets and migrates in place", async () => {
  await project(async (root, scratch) => {
    await writeFile(join(root, "a.toy"), "def main\ncall helper\n");
    await mkdir(join(root, "lib"));
    const database = join(scratch, "g.sqlite");
    let store = new SqliteGraphStore(database, "p");
    await indexProject(root, registry, store);
    const before = store.links();
    store.close();
    const raw = new DatabaseSync(database);
    raw.exec(`DROP TABLE graph_library_targets;
      DROP TRIGGER graph_target_changed; DROP TRIGGER graph_candidate_removed;
      ${schema3Triggers}
      UPDATE graph_meta SET value='3' WHERE key='schema';`);
    raw.close();
    store = new SqliteGraphStore(database, undefined, { readOnly: true });
    assert.deepEqual(store.links(), before);
    assert.deepEqual(store.libraryUses("zod", undefined, 10), []);
    assert.equal(store.counts().library, 0);
    store.close();
    store = new SqliteGraphStore(database, "p");
    assert.deepEqual(store.links(), before);
    await writeFile(
      join(root, "a.toy"),
      "use npm:zod\ndef main\ncall zod.parse\n",
    );
    await indexProject(root, registry, store);
    assert.deepEqual(
      store.libraryUses("zod", "parse", 10).map((link) => link.resolution),
      ["library"],
    );
    store.close();
    const check = new DatabaseSync(database, { readOnly: true });
    assert.equal(
      check.prepare("SELECT value FROM graph_meta WHERE key='schema'").get()
        .value,
      "4",
    );
    check.close();
  });
});

test("a proven declaring owner is a definite level-2 library target", async () => {
  await project(async (root, scratch) => {
    const store = new SqliteGraphStore(join(scratch, "g.sqlite"), "p");
    try {
      const report = await indexProject(
        root,
        new LanguageRegistry([
          recording({
            library: {
              ecosystem: "go-std",
              unit: "time",
              symbol: "Time.Equal",
              evidence: "declaring-owner",
            },
          }),
        ]),
        store,
      );
      assert.deepEqual(report.resolutionErrors, []);
      const [link] = store.libraryUses("time", "Time.Equal", 10);
      const { id, ...target } = link.libraries[0];
      assert.equal(link.resolution, "library");
      assert.match(id, /^library:[a-f0-9]{64}$/);
      assert.deepEqual(target, {
        ecosystem: "go-std",
        unit: "time",
        symbol: "Time.Equal",
        evidence: "declaring-owner",
      });
    } finally {
      store.close();
    }
  });
});

test("a second resolution gets its links without the previous run's library targets", async () => {
  await project(async (root, scratch) => {
    const seen = [];
    const watching = {
      ...toy,
      resolve(context) {
        seen.push(
          context.links.filter((link) => Object.hasOwn(link, "libraries"))
            .length,
        );
        return toy.resolve(context);
      },
    };
    const store = new SqliteGraphStore(join(scratch, "g.sqlite"), "p");
    try {
      const registry = new LanguageRegistry([watching]);
      await indexProject(root, registry, store);
      assert.equal(store.counts().library, 3);
      await indexProject(root, registry, store);
      assert.deepEqual(seen, [0, 0]);
      assert.equal(store.counts().library, 3);
    } finally {
      store.close();
    }
  });
});

test("a parse result cannot smuggle library targets into the store", async () => {
  await project(async (root, scratch) => {
    const forging = {
      ...toy,
      parse(source) {
        const result = toy.parse(source);
        return {
          ...result,
          links: result.links.map((link) => ({
            ...link,
            libraries: [
              {
                id: "library:forged",
                ecosystem: "npm",
                unit: "x",
                evidence: "made-up",
              },
            ],
          })),
        };
      },
      resolve: undefined,
    };
    const store = new SqliteGraphStore(join(scratch, "g.sqlite"), "p");
    try {
      const report = await indexProject(
        root,
        new LanguageRegistry([forging]),
        store,
      );
      assert.deepEqual(report.failed, ["a.toy", "b.toy"]);
      assert.match(report.errors[0].message, /cannot carry library targets/);
      assert.equal(store.links().length, 0);
      const file = { ...store.getFile("a.toy") };
      assert.throws(
        () =>
          store.replaceFile({
            ...file,
            result: {
              status: "clean",
              diagnostics: [],
              symbols: [],
              links: [
                {
                  sourceKey: null,
                  kind: "imports",
                  targetName: "x",
                  range: { start: 0, end: 1 },
                  libraries: [{ id: "library:forged", evidence: "made-up" }],
                },
              ],
            },
          }),
        /cannot carry library targets/,
      );
      assert.equal(store.links().length, 0);
    } finally {
      store.close();
    }
  });
});

test("a reader opened on a schema-3 graph agrees with itself after another connection migrates it", async () => {
  await project(async (root, scratch) => {
    const database = join(scratch, "g.sqlite");
    let writer = new SqliteGraphStore(database, "p");
    await indexProject(root, registry, writer);
    writer.close();
    const raw = new DatabaseSync(database);
    raw.exec(`DROP TABLE graph_library_targets;
      DROP TRIGGER graph_target_changed; DROP TRIGGER graph_candidate_removed;
      ${schema3Triggers}
      UPDATE graph_links SET resolution='unresolved' WHERE resolution='library';
      UPDATE graph_meta SET value='3' WHERE key='schema';`);
    raw.close();
    // The reader decides nothing at open: it opens while the graph is schema 3.
    const reader = new SqliteGraphStore(database, undefined, {
      readOnly: true,
    });
    try {
      assert.deepEqual(
        [
          reader.counts().library,
          reader.libraryUses("zod", undefined, 10).length,
        ],
        [0, 0],
      );
      // Another connection migrates the graph and records library targets.
      writer = new SqliteGraphStore(database, "p");
      await indexProject(root, registry, writer);
      writer.close();
      const links = reader.links();
      assert.deepEqual(
        [
          reader.counts().library,
          links.filter((link) => link.resolution === "library").length,
          reader.libraryUses("zod", undefined, 10).length,
          reader.libraryUseCounts("zod", undefined).library,
        ],
        [3, 3, 2, 2],
      );
      // One snapshot gives every read the same state.
      assert.deepEqual(
        reader.readCommandSnapshot(() => [
          reader.counts().library,
          reader.libraryUses("lodash", "map", 10).length,
        ]),
        [3, 1],
      );
    } finally {
      reader.close();
    }
  });
});

/** Toy with a declared lockfile, recording one versioned library target. */
const versioned = (library) => ({
  ...toy,
  contextFiles: ["toy.lock"],
  resolve(context) {
    const link = context.links.find((item) => item.kind === "calls");
    return [{ linkId: link.id, library }];
  },
});
const zodBinding = {
  ecosystem: "npm",
  unit: "zod",
  symbol: "string",
  evidence: "import-binding",
};
for (const [label, library, message] of [
  [
    "a version without its source",
    { ...zodBinding, version: "99.99.99" },
    /needs the manifest or lockfile/,
  ],
  [
    "a source without a version",
    { ...zodBinding, versionSource: "toy.lock" },
    /only with a version/,
  ],
  [
    "a source missing from the snapshot",
    { ...zodBinding, version: "3.0.0", versionSource: "missing.lock" },
    /clean manifest or lockfile in the snapshot/,
  ],
  [
    "a source file as the source",
    { ...zodBinding, version: "3.0.0", versionSource: "a.toy" },
    /clean manifest or lockfile in the snapshot/,
  ],
])
  test(`a library version is refused with ${label}`, async () => {
    await project(async (root, scratch) => {
      await writeFile(join(root, "toy.lock"), "zod 3.0.0\n");
      const store = new SqliteGraphStore(join(scratch, "g.sqlite"), "p");
      try {
        const report = await indexProject(
          root,
          new LanguageRegistry([versioned(library)]),
          store,
        );
        assert.equal(report.resolutionErrors.length, 1);
        assert.match(report.resolutionErrors[0].message, message);
        assert.equal(store.counts().library, 0);
        // The store refuses the same decision made directly.
        const link = store.links().find((item) => item.kind === "calls");
        assert.throws(
          () => store.resolveLinks([{ linkId: link.id, library }]),
          message,
        );
      } finally {
        store.close();
      }
    });
  });

test("a library version from a lockfile in the snapshot is stored with its source", async () => {
  await project(async (root, scratch) => {
    await writeFile(join(root, "toy.lock"), "zod 3.0.0\n");
    const store = new SqliteGraphStore(join(scratch, "g.sqlite"), "p");
    try {
      const report = await indexProject(
        root,
        new LanguageRegistry([
          versioned({
            ...zodBinding,
            version: "3.0.0",
            versionSource: "toy.lock",
          }),
        ]),
        store,
      );
      assert.deepEqual(report.resolutionErrors, []);
      const [link] = store.libraryUses("zod", "string", 10);
      const { id, ...target } = link.libraries[0];
      assert.deepEqual(target, {
        ...zodBinding,
        version: "3.0.0",
        versionSource: "toy.lock",
      });
    } finally {
      store.close();
    }
  });
});
