import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteGraphStore } from "../dist/graph/store.js";
import { queryGraph } from "../dist/graph/command-queries.js";
import { GraphLocations } from "../dist/graph/command-locations.js";
import { contentHash, fileFacts } from "../dist/graph/identity.js";
import { executeGraph } from "../dist/graph/commands.js";
import { formatGraph } from "../dist/cli/graph.js";
import { openDatabase } from "../dist/storage/local.js";

function synthetic(module, names, drafts, run, text = "x".repeat(200)) {
  const store = new SqliteGraphStore(":memory:", "review-test");
  const file = {
    path: "code.x",
    text,
    hash: contentHash(text),
    module,
    version: "1",
    result: {
      status: "clean",
      diagnostics: [],
      symbols: names.map((identity, i) => ({
        key: identity,
        name: identity.split(/::|\./).at(-1),
        identity,
        kind: "method",
        range: { start: i * 2, end: i * 2 + 1 },
      })),
      links: [],
    },
  };
  const ids = Object.fromEntries(
    fileFacts(store.projectId, file).symbols.map((s) => [s.identity, s.id]),
  );
  const edges = drafts(ids);
  file.result.links = edges.map((e, i) => ({
    sourceKey: e.from,
    kind: "calls",
    targetName: e.name ?? e.to ?? "step",
    range: { start: 50 + i, end: 51 + i },
    data: e.data ?? { reason: "fixture-unresolved" },
  }));
  try {
    store.replaceFile(file);
    const facts = fileFacts(store.projectId, file);
    store.resolveLinks(
      edges.flatMap((e, i) =>
        e.to
          ? [{ linkId: facts.links[i].id, targetId: ids[e.to] }]
          : e.candidates
            ? [
                {
                  linkId: facts.links[i].id,
                  candidateIds: e.candidates.map((n) => ids[n]),
                },
              ]
            : [],
      ),
    );
    run(store, ids);
  } finally {
    store.close();
  }
}

test("incoming candidate membership and impact route certainty are never promoted to definite", () => {
  synthetic(
    "rust",
    ["step", "other", "caller", "upper"],
    () => [
      { from: "caller", candidates: ["step", "other"] },
      { from: "upper", to: "caller" },
    ],
    (store) => {
      const callers = queryGraph(store, "callers", ["step"], 5, 100);
      assert.equal(callers.data.links.length, 1);
      assert.equal(callers.data.links[0].certainty, "candidate-set");
      assert.deepEqual(
        callers.data.links[0].candidates.map((c) => c.symbol.name).sort(),
        ["other", "step"],
      );
      assert.deepEqual(callers.data.classCounts, {
        definite: 0,
        candidateSet: 1,
        unresolved: 0,
      });
      const impact = queryGraph(store, "impact", ["step"], 5, 100);
      assert.deepEqual(
        impact.data.callers.map((c) => [c.symbol.name, c.certainty]).sort(),
        [
          ["caller", "candidate"],
          ["upper", "candidate"],
        ],
      );
    },
  );
});

test("possible callers have three distinct match bases, keep reasons, and impact only follows on opt-in", () => {
  for (const module of ["rust", "go", "typescript"]) {
    synthetic(
      module,
      ["Engine.step", "hint", "qualified", "unknown", "top"],
      (ids) => [
        {
          from: "hint",
          name: "alias",
          data: {
            targets:
              module === "typescript"
                ? [{ file: "code.x", key: "Engine.step" }]
                : [ids["Engine.step"]],
            reason: "open-world",
          },
        },
        {
          from: "qualified",
          name: "e.step",
          data:
            module === "go"
              ? {
                  expr: {
                    k: "sel",
                    x: { k: "val", t: { n: "Engine" } },
                    n: "step",
                  },
                  reason: "dispatch",
                }
              : { receiverType: "Engine", reason: "dispatch" },
        },
        {
          from: "unknown",
          name: "different.step",
          data: { reason: "unknown-receiver" },
        },
        { from: "top", to: "hint" },
      ],
      (store) => {
        const callers = queryGraph(store, "callers", ["Engine.step"], 5, 100);
        assert.equal(callers.data.hasPossibleCallers, true);
        assert.equal(callers.data.links.length, 0);
        assert.deepEqual(
          callers.data.possibleCallers.map((c) => c.matchKind).sort(),
          ["name-only", "receiver-qualified", "target-hint"],
        );
        assert.equal(callers.data.classCounts.unresolved, 3);
        for (const c of callers.data.possibleCallers) {
          assert.equal(c.certainty, "unresolved");
          assert.ok(c.data.reason);
        }
        const normal = queryGraph(store, "impact", ["Engine.step"], 5, 100);
        assert.equal(normal.data.callers.length, 0);
        assert.equal(normal.data.possibleCallers[0].links.length, 3);
        const opted = queryGraph(
          store,
          "impact",
          ["Engine.step"],
          5,
          100,
          false,
          true,
        );
        assert.equal(
          opted.data.callers.find((c) => c.symbol.name === "top")?.certainty,
          "unresolved",
        );
        assert.equal(opted.data.callers.length, 4);
        const path = queryGraph(store, "path", ["top", "Engine.step"], 5, 100);
        assert.equal(path.data.found, false);
        assert.equal(path.data.possiblePath.certainty, "unresolved");
        assert.deepEqual(
          path.data.possiblePath.symbols.map((s) => s.name),
          ["top", "hint", "step"],
        );
        assert.equal(
          path.data.possiblePath.links.at(-1).certainty,
          "unresolved",
        );
      },
    );
  }
});

test("impact shortest distance is independent of a later stronger route", () => {
  synthetic(
    "go",
    ["target", "other", "short", "long", "middle", "ancestor"],
    () => [
      { from: "short", candidates: ["target", "other"] },
      { from: "long", to: "target" },
      { from: "middle", to: "long" },
      { from: "short", to: "middle" },
      { from: "ancestor", to: "short" },
    ],
    (store) => {
      const impact = queryGraph(store, "impact", ["target"], 5, 100);
      const short = impact.data.callers.find((c) => c.symbol.name === "short");
      assert.equal(short.distance, 1);
      assert.equal(short.certainty, "definite");
      assert.equal(
        impact.data.callers.find((c) => c.symbol.name === "ancestor").distance,
        2,
      );
      const shallow = queryGraph(store, "impact", ["target"], 2, 100);
      assert.equal(
        shallow.data.callers.find((c) => c.symbol.name === "ancestor")
          .certainty,
        "candidate",
      );
    },
  );
});

test("positions ignore leading BOM, lone CR and Unicode separators; LF and CRLF are line breaks", () => {
  const text = "\uFEFF// 😀\u2028one\u2029two\rthree\r\nfunc Sep() {}\nend";
  synthetic(
    "go",
    ["s"],
    () => [],
    (store) => {
      const positions = new GraphLocations(store);
      assert.equal(positions.locate("code.x", { start: 1, end: 1 }).column, 1);
      const cr = text.indexOf("three");
      assert.equal(positions.locate("code.x", { start: cr, end: cr }).line, 1);
      assert.equal(
        positions.locate("code.x", { start: cr, end: cr }).column,
        cr,
      );
      const start = text.indexOf("func");
      assert.deepEqual(positions.locate("code.x", { start, end: start + 4 }), {
        line: 2,
        column: 1,
        endLine: 2,
        endColumn: 5,
        locationSource: "stored-snapshot",
        snapshotHash: contentHash(text),
      });
      assert.equal(positions.offset("code.x", 1, 1), 1);
      assert.equal(positions.lineRange("code.x", 1).end, text.indexOf("\r\n"));
      assert.equal(
        positions.locate("code.x", {
          start: text.indexOf("end"),
          end: text.length,
        }).line,
        3,
      );
    },
    text,
  );
});

test("main schema-3 status and no-sync queries are byte-identical read-only operations", async () => {
  const root = await mkdtemp(join(tmpdir(), "pymtheg-command-main-readonly-"));
  try {
    const dir = join(root, ".pymtheg/rebuildable");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "graph.sqlite");
    const db = openDatabase(path);
    db.exec(
      await readFile(
        new URL("./fixtures/graph-command/main-schema-3.sql", import.meta.url),
        "utf8",
      ),
    );
    db.prepare(
      "INSERT INTO graph_meta VALUES ('project','main-written')",
    ).run();
    db.close();
    const before = await readFile(path);
    const status = await executeGraph({ command: "status", root });
    assert.equal(status.exitCode, 0);
    assert.equal(status.indexExists, true);
    assert.deepEqual(await readFile(path), before);
    const query = await executeGraph({
      command: "search",
      args: ["x"],
      root,
      noSync: true,
    });
    assert.equal(query.exitCode, 2); // Main has no command completion record.
    assert.deepEqual(await readFile(path), before);
    assert.match(formatGraph(query), /index-incomplete/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real Rust and TypeScript stored unresolved target hints are visible as possible callers", async () => {
  const root = await mkdtemp(join(tmpdir(), "pymtheg-command-real-hints-"));
  try {
    await writeFile(
      join(root, "Cargo.toml"),
      '[package]\nname="hints"\nversion="0.1.0"\n',
    );
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src/lib.rs"),
      "pub struct Engine; impl Engine { pub fn new() -> Self { Engine } pub fn step(&self) {} } pub fn caller() { let e = Engine::new(); e.step(); }",
    );
    await writeFile(
      join(root, "code.ts"),
      "class Box { step() {} } function caller(b: Box) { b.step(); }",
    );
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({ extends: "./missing.json", include: ["code.ts"] }),
    );
    const indexed = await executeGraph({ command: "index", root });
    assert.equal(indexed.failedFiles.length, 0);
    const search = await executeGraph({
      command: "search",
      args: ["step"],
      root,
    });
    for (const module of ["rust", "typescript"]) {
      const target = search.data.matches.find((s) => s.module === module);
      assert.ok(target);
      const callers = await executeGraph({
        command: "callers",
        args: [target.id],
        root,
      });
      assert.ok(
        callers.data.possibleCallers.some(
          (c) => c.matchKind === "target-hint" && c.source.name === "caller",
        ),
        JSON.stringify(callers.data),
      );
      assert.match(
        formatGraph(callers),
        /Possible callers \(unresolved\): present/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Go generic constraints and recorded variable static types are qualified hints, not resolution", () => {
  for (const receiver of [
    { k: "tval", c: { n: "SaverUnpacked" } },
    { k: "var", d: { k: "val", t: { n: "SaverUnpacked" } } },
  ]) {
    synthetic(
      "go",
      ["SaverUnpacked.SaveUnpacked", "generic"],
      () => [
        {
          from: "generic",
          name: "repo.SaveUnpacked",
          data: {
            expr: { k: "sel", x: receiver, n: "SaveUnpacked" },
            reason: "dispatch-unverified",
          },
        },
      ],
      (store) => {
        const answer = queryGraph(
          store,
          "callers",
          ["SaverUnpacked.SaveUnpacked"],
          5,
          100,
        );
        assert.equal(answer.data.links.length, 0);
        assert.equal(
          answer.data.possibleCallers[0].matchKind,
          "receiver-qualified",
        );
        assert.equal(answer.data.possibleCallers[0].certainty, "unresolved");
      },
    );
  }
});
