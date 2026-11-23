// SPDX-License-Identifier: MIT
// C-22: two index runs on one store. Each run owns the store's index-run
// mark from its first write; a run that another run has overtaken writes
// nothing more and says so, and the store only becomes complete through a
// run that started from a state it fully re-analysed. The interleavings are
// forced by gates inside the TypeScript module's analysis (no timing).
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { executeGraph } from "../dist/graph/commands.js";
import {
  discoverLanguages,
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import { compareRows, storeRows } from "../scripts/reindex/dump.mjs";
import { DatabaseSync } from "node:sqlite";

const production = await discoverLanguages();
const taken = /Another graph index run started on this store and took it over/;

/**
 * The database file without SQLite's file change counter (header bytes
 * 24-27 and its copy at 92-95): an index run chooses the journal before it
 * reads (C-22), which counts as a change of the file even when it writes no
 * row. Every other byte must be as it was.
 */
const withoutChangeCounter = (bytes) => {
  const copy = Buffer.from(bytes);
  copy.fill(0, 24, 28);
  copy.fill(0, 92, 96);
  return copy;
};

/** A gate: `wait()` blocks until `open()`; `reached` resolves on arrival. */
function gate() {
  let open, arrive;
  const opened = new Promise((resolve) => (open = resolve));
  const reached = new Promise((resolve) => (arrive = resolve));
  return {
    open,
    reached,
    async wait() {
      arrive();
      await opened;
    },
  };
}
/** Production modules, with one module's analysis (TypeScript by default) pausing at `pause` (once). */
function pausing(pause, language = "typescript") {
  return new LanguageRegistry(
    production.modules.map((module) =>
      module.id !== language
        ? module
        : {
            ...module,
            async analyze(context) {
              // The analysis is computed from what this run read, then held.
              const results = await module.analyze(context);
              const held = pause.shift();
              if (held) await held.wait();
              return results;
            },
          },
    ),
  );
}
const a = `export function hello(): string {
  return "hello";
}

export function gone(): number {
  return 1;
}
`;
const files = {
  "package.json": JSON.stringify({ name: "fixture", private: true }),
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true },
    include: ["src"],
  }),
  "src/a.ts": a,
  "src/b.ts":
    'import { hello, gone } from "./a";\n\nexport const b = hello() + gone();\n',
};
function project() {
  const base = mkdtempSync(join(tmpdir(), "c22-runs-"));
  const root = join(base, "tree");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { base, root, graph: join(base, "graph.sqlite") };
}
async function cold(base, root, projectId) {
  const path = join(base, `cold-${Math.random().toString(36).slice(2)}.sqlite`);
  const store = new SqliteGraphStore(path, projectId);
  try {
    await indexProject(root, production, store);
  } finally {
    store.close();
  }
  return storeRows(path);
}
/** The call to `gone` from src/b.ts: its target file, or null. */
function goneTarget(path) {
  const store = new SqliteGraphStore(path, undefined, { readOnly: true });
  try {
    const link = store
      .links()
      .find((item) => item.file === "src/b.ts" && item.targetName === "gone");
    return link?.targetId ? store.getSymbol(link.targetId)?.file : null;
  } finally {
    store.close();
  }
}

test("the review's case: A analyses with an export removed and pauses; it is restored; B completes; A resumes and writes nothing", async () => {
  const { base, root, graph } = project();
  try {
    const first = new SqliteGraphStore(graph);
    await indexProject(root, production, first);
    first.close();
    assert.equal(goneTarget(graph), "src/a.ts");
    writeFileSync(
      join(root, "src/a.ts"),
      a.replace(/export function gone[\s\S]*$/, ""),
    );
    const held = gate();
    const storeA = new SqliteGraphStore(graph);
    const runA = indexProject(root, pausing([held]), storeA);
    await held.reached;
    // A holds analysis of the tree without `gone`; the export comes back.
    writeFileSync(join(root, "src/a.ts"), a);
    const storeB = new SqliteGraphStore(graph);
    await indexProject(root, production, storeB);
    storeB.close();
    held.open();
    await assert.rejects(runA, taken);
    storeA.close();
    assert.equal(goneTarget(graph), "src/a.ts", "A wrote nothing after B");
    // One normal re-index equals a cold index of the tree.
    const again = new SqliteGraphStore(graph);
    await indexProject(root, production, again);
    const projectId = again.projectId;
    again.close();
    assert.deepEqual(
      compareRows(storeRows(graph), await cold(base, root, projectId)),
      [],
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("A paused before writing; B completes; A resumes: A writes nothing, the store is B's", async () => {
  const { base, root, graph } = project();
  try {
    const first = new SqliteGraphStore(graph);
    await indexProject(root, production, first);
    first.close();
    // A starts on the tree as it is and pauses before its first write.
    const held = gate();
    const storeA = new SqliteGraphStore(graph);
    const runA = indexProject(root, pausing([held]), storeA);
    await held.reached;
    writeFileSync(
      join(root, "src/a.ts"),
      a.replace(/export function gone[\s\S]*$/, ""),
    );
    const storeB = new SqliteGraphStore(graph);
    await indexProject(root, production, storeB);
    const projectId = storeB.projectId;
    storeB.close();
    // Rows, not bytes: A's connection holds the write-ahead log open, so
    // the file's journal format depends on which connection closes last.
    const rows = storeRows(graph);
    held.open();
    // A either stops at its first write, or finds nothing to write.
    const [settled] = await Promise.allSettled([runA]);
    if (settled.status === "rejected")
      assert.match(settled.reason.message, taken);
    storeA.close();
    assert.deepEqual(storeRows(graph), rows, "A wrote nothing");
    assert.equal(goneTarget(graph), null);
    assert.deepEqual(
      compareRows(storeRows(graph), await cold(base, root, projectId)),
      [],
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("A paused; B starts and pauses; A resumes and stops; B finishes: both settle, the store equals a cold index", async () => {
  const { base, root, graph } = project();
  try {
    const first = new SqliteGraphStore(graph);
    await indexProject(root, production, first);
    first.close();
    writeFileSync(join(root, "src/a.ts"), "// moved\n" + a);
    const heldA = gate();
    const storeA = new SqliteGraphStore(graph);
    const runA = indexProject(root, pausing([heldA]), storeA);
    await heldA.reached;
    const heldB = gate();
    const storeB = new SqliteGraphStore(graph);
    const runB = indexProject(root, pausing([heldB]), storeB);
    await heldB.reached;
    heldA.open();
    const [settledA] = await Promise.allSettled([runA]);
    assert.equal(settledA.status, "rejected");
    assert.match(settledA.reason.message, taken);
    heldB.open();
    const report = await runB;
    assert.deepEqual(report.resolutionErrors, []);
    const projectId = storeB.projectId;
    storeA.close();
    storeB.close();
    assert.deepEqual(
      compareRows(storeRows(graph), await cold(base, root, projectId)),
      [],
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("graph index launched twice at once from the command path: one completes, the other ends with a clear message", async () => {
  const { base, root } = project();
  try {
    // Two cold indexes of a project with no graph yet, as two CLI or MCP
    // commands: the first holds its analysis until the second has started.
    const heldA = gate();
    const heldB = gate();
    const runA = executeGraph(
      { command: "index", root },
      { registry: pausing([heldA]) },
    );
    await heldA.reached;
    const runB = executeGraph(
      { command: "index", root },
      { registry: pausing([heldB]) },
    );
    await heldB.reached;
    heldA.open();
    heldB.open();
    const [first, second] = await Promise.allSettled([runA, runB]);
    const outcomes = [first, second].map((item) => item.status).sort();
    assert.deepEqual(outcomes, ["fulfilled", "rejected"]);
    const loser = [first, second].find((item) => item.status === "rejected");
    assert.match(loser.reason.message, taken);
    assert.doesNotMatch(loser.reason.message, /UNIQUE|constraint/i);
    // The next command reports a complete graph equal to a cold index.
    const next = await executeGraph({ command: "index", root });
    assert.equal(next.sync.complete, true);
    const graph = join(root, ".pymtheg/rebuildable/graph.sqlite");
    assert.deepEqual(
      compareRows(
        storeRows(graph),
        await cold(base, root, storeRows(graph).project[0]),
      ),
      [],
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a no-edit graph index through the command path leaves every database byte but the change counter as it was", async () => {
  const { base, root } = project();
  try {
    assert.equal(
      (await executeGraph({ command: "index", root })).sync.complete,
      true,
    );
    const graph = join(root, ".pymtheg/rebuildable/graph.sqlite");
    const bytes = readFileSync(graph);
    const again = await executeGraph({ command: "index", root });
    assert.equal(again.sync.complete, true);
    assert.deepEqual(
      withoutChangeCounter(readFileSync(graph)),
      withoutChangeCounter(bytes),
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// Known limit (C-22): another connection running `wal_checkpoint(TRUNCATE)`
// during a run advances the data version and makes the run stop as
// overtaken although no data changed (it can be retried). A FULL checkpoint,
// a read-only status and a query that does not sync change nothing a run
// relies on: the run goes on and completes.
test("a FULL checkpoint, a status and a no-sync query by other connections do not stop a run", async () => {
  const { base, root } = project();
  try {
    assert.equal(
      (await executeGraph({ command: "index", root })).sync.complete,
      true,
    );
    writeFileSync(join(root, "src/a.ts"), "// moved\n" + a);
    const held = gate();
    const run = executeGraph(
      { command: "index", root },
      { registry: pausing([held]) },
    );
    await held.reached;
    const graph = join(root, ".pymtheg/rebuildable/graph.sqlite");
    const other = new DatabaseSync(graph);
    try {
      const checkpoint = other.prepare("PRAGMA wal_checkpoint(FULL)").get();
      assert.equal(checkpoint.busy, 0);
    } finally {
      other.close();
    }
    assert.equal(
      (await executeGraph({ command: "status", root })).sync.complete,
      false,
    );
    await executeGraph({
      command: "search",
      args: ["hello"],
      root,
      noSync: true,
    });
    held.open();
    const answer = await run;
    assert.equal(answer.sync.complete, true);
    assert.deepEqual(
      compareRows(
        storeRows(graph),
        await cold(base, root, storeRows(graph).project[0]),
      ),
      [],
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("Go: A analyses with an export removed and pauses; it is restored; B completes; A resumes and writes nothing", async () => {
  // Go's parsed writes also wait for its analysis (C-27). Without the run's
  // early claim (C-38A), B found the store unchanged and answered without
  // writing, and A then wrote its stale analysis.
  const goFull =
    "package a\n\nfunc Hello() int { return 1 }\n\nfunc Gone() int { return 2 }\n";
  const base = mkdtempSync(join(tmpdir(), "c38-go-runs-"));
  const root = join(base, "tree");
  const graph = join(base, "graph.sqlite");
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  try {
    write("go.mod", "module example.com/m\n\ngo 1.22\n");
    write("a/a.go", goFull);
    write(
      "b/b.go",
      'package b\n\nimport "example.com/m/a"\n\nfunc Use() int { return a.Hello() + a.Gone() }\n',
    );
    const first = new SqliteGraphStore(graph);
    await indexProject(root, production, first);
    first.close();
    const rows = () => storeRows(graph);
    write("a/a.go", "package a\n\nfunc Hello() int { return 1 }\n");
    const held = gate();
    const storeA = new SqliteGraphStore(graph);
    const runA = indexProject(root, pausing([held], "go"), storeA);
    await held.reached;
    write("a/a.go", goFull);
    const storeB = new SqliteGraphStore(graph);
    await indexProject(root, production, storeB);
    const projectId = storeB.projectId;
    storeB.close();
    const afterB = rows();
    held.open();
    await assert.rejects(runA, taken);
    storeA.close();
    assert.deepEqual(rows(), afterB, "A wrote nothing after B");
    const again = new SqliteGraphStore(graph);
    await indexProject(root, production, again);
    again.close();
    assert.deepEqual(
      compareRows(storeRows(graph), await cold(base, root, projectId)),
      [],
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
