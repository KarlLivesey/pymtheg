// SPDX-License-Identifier: MIT
// C-62: an index run that another run has overtaken writes nothing, and
// never disturbs the newer run's mark. Each run is a child process stopped
// (SIGSTOP) at a named gate (test/graph-index-ownership-child.mjs); this test
// waits for it to be stopped, acts, and continues it. No timing: every step
// waits on an event. Every case must end equal to a cold index of the tree,
// with its completion intact, with no further index.
import assert from "node:assert/strict";
import { fork, spawn, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import {
  discoverLanguages,
  indexProject,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import { compareRows, storeRows } from "../scripts/reindex/dump.mjs";

/** `promise`, or after a safety bound `onExpiry` runs and the wait fails; the bound decides nothing when a test passes. */
async function bounded(promise, what, onExpiry) {
  let timer;
  let expired = false;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(Error(`Safety budget exhausted waiting for ${what}`));
        }, 180_000);
      }),
    ]);
  } catch (error) {
    if (expired) onExpiry();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const child = new URL("graph-index-ownership-child.mjs", import.meta.url)
  .pathname;
const proc = existsSync("/proc/self/status");
const production = await discoverLanguages();
const graphAt = (root) => join(root, ".pymtheg/rebuildable/graph.sqlite");

/** Each language's tree, with an export to remove, a file to add and a body edit. */
const LANGUAGES = {
  go: {
    files: {
      "go.mod": "module example.com/m\n\ngo 1.22\n",
      "a/a.go": "package a\n\nfunc Hello() int { return 1 }\n",
      "b/b.go":
        'package b\n\nimport "example.com/m/a"\n\nfunc B() int { return a.Hello() }\n',
    },
    exported: "a/a.go",
    removeExport: (text) => text.replace("func Hello", "func hello"),
    added: ["c/c.go", "package c\n\nfunc C() int { return 3 }\n"],
    edit: (text) => text.replace("return 1", "return 2"),
  },
  rust: {
    files: {
      "Cargo.toml":
        '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n',
      "src/lib.rs": "pub mod a;\npub fn use_it() -> u32 { a::hello() }\n",
      "src/a.rs": "pub fn hello() -> u32 { 1 }\n",
    },
    exported: "src/a.rs",
    removeExport: (text) => text.replace("pub fn hello", "fn hello"),
    added: ["src/c.rs", "pub fn c() -> u32 { 3 }\n"],
    edit: (text) => text.replace("{ 1 }", "{ 2 }"),
  },
  typescript: {
    files: {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true },
        include: ["src"],
      }),
      "src/a.ts": "export function foo() { return 1 }\n",
      "src/b.ts": "import { foo } from './a';\nexport const b = foo();\n",
    },
    exported: "src/a.ts",
    removeExport: (text) => text.replace("export function", "function"),
    added: ["src/c.ts", "export const c = 3;\n"],
    edit: (text) => text.replace("return 1", "return 2"),
  },
};

const cli = (root, command = "index", ...args) => {
  const result = spawnSync(
    process.execPath,
    [
      resolve("dist/cli/main.js"),
      "graph",
      command,
      ...args,
      "--root",
      root,
      "--json",
    ],
    // A bound: a run that waits on a stopped child fails instead of hanging.
    { encoding: "utf8", timeout: 180_000, killSignal: "SIGKILL" },
  );
  assert.ok(result.status <= 2, result.stderr);
  return JSON.parse(result.stdout);
};
function project(language) {
  const base = mkdtempSync(join(tmpdir(), `c62-${language}-`));
  const root = join(base, "tree");
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const read = (path) => readFileSync(join(root, path), "utf8");
  for (const [path, text] of Object.entries(LANGUAGES[language].files))
    write(path, text);
  assert.equal(cli(root).sync.complete, true);
  return { base, root, write, read };
}
/**
 * A run in a child, stopped at `gate`; `resume()` returns its reply. With
 * `how` "session", the child's first run (ungated) keeps the modules'
 * inputs; `prepare(warm)` then runs before the gated second run starts.
 */
async function stopped(root, how, gate, prepare) {
  const run = fork(child, [root, how, gate], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  let reply;
  let stop;
  const at = new Promise((done) => (stop = done));
  run.on("message", async (message) => {
    if (message.warm !== undefined) {
      await prepare(message);
      run.send("go");
    }
    if (message.stopped) stop(message);
    if (message.reply) reply = message.reply;
  });
  const exited = new Promise((done) =>
    run.once("exit", (code, signal) => {
      stop(undefined);
      done({ code, signal });
    }),
  );
  // Bounded, so a run that never reaches its gate (or never exits) fails
  // the test instead of hanging it, and is killed.
  const bound = (promise, what) =>
    bounded(promise, what, () => run.kill("SIGKILL"));
  const message = await bound(at, `the run to reach ${gate}`);
  assert.ok(message, `the run reached ${gate}`);
  // Stopped for certain, not only about to be.
  while (!/^State:\s+T/m.test(readFileSync(`/proc/${run.pid}/status`, "utf8")))
    await new Promise(setImmediate);
  return {
    async resume() {
      run.kill("SIGCONT");
      const result = await bound(exited, "the resumed run to exit");
      assert.equal(result.code, 0);
      return reply;
    },
    async kill() {
      run.kill("SIGKILL");
      await bound(exited, "the killed run to exit");
    },
  };
}
/** The stored rows against a cold index of the tree as it is now. */
async function differencesFromCold(base, root) {
  const graph = graphAt(root);
  const cold = join(base, `cold-${Math.random().toString(36).slice(2)}.sqlite`);
  const store = new SqliteGraphStore(cold, storeRows(graph).project[0]);
  try {
    await indexProject(root, production, store, {
      excludeDirectories: [".pymtheg"],
    });
  } finally {
    store.close();
  }
  return compareRows(storeRows(graph), storeRows(cold));
}
/** Equal to cold and complete as stored, with no further index. */
async function settled(base, root, what) {
  assert.deepEqual(await differencesFromCold(base, root), [], what);
  assert.equal(cli(root, "status").sync.complete, true, what);
}
const overtaken = (reply, what) =>
  assert.ok(
    reply.error === "GraphIndexTakenOver" ||
      reply.error === "GraphIndexStale" ||
      reply.complete === false,
    `${what}: ${JSON.stringify(reply)}`,
  );

for (const language of Object.keys(LANGUAGES)) {
  const L = LANGUAGES[language];
  test(
    `${language}: a run paused after parsing an export's removal writes nothing once the file is restored and a syncing query found it current`,
    { skip: !proc && "needs /proc to see the child stopped" },
    async () => {
      const { base, root, write, read } = project(language);
      try {
        const original = read(L.exported);
        write(L.exported, L.removeExport(original));
        const A = await stopped(root, "command", "after-parse");
        write(L.exported, original);
        // A syncing query, then B, an index: each finds the tree current.
        assert.equal(cli(root, "status").sync.complete, true);
        const query = cli(root, "file", L.exported);
        assert.equal(query.sync.complete, true);
        assert.equal(cli(root).sync.complete, true);
        const B = storeRows(graphAt(root));
        overtaken(await A.resume(), "A");
        // B's store is untouched, row for row.
        assert.deepEqual(compareRows(B, storeRows(graphAt(root))), [], "B");
        await settled(base, root, "after A");
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  );

  test(
    `${language}: a run paused after its walk never deletes a file another run indexed meanwhile`,
    { skip: !proc && "needs /proc to see the child stopped" },
    async () => {
      const { base, root, write } = project(language);
      try {
        const A = await stopped(root, "index", "after-walk");
        write(...L.added);
        assert.equal(cli(root).sync.complete, true);
        const B = storeRows(graphAt(root));
        overtaken(await A.resume(), "A");
        // B's store is untouched, its added file's rows included.
        assert.deepEqual(compareRows(B, storeRows(graphAt(root))), [], "B");
        await settled(base, root, "after A");
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  );

  test(
    `${language}: a run's late completion leaves a newer, still running run's mark alone`,
    { skip: !proc && "needs /proc to see the child stopped" },
    async () => {
      const { base, root, write, read } = project(language);
      try {
        // A has written its rows and passed its own checks.
        write(L.exported, L.edit(read(L.exported)));
        const A = await stopped(root, "command", "before-publish");
        // B claims for a newer edit and is still running.
        write(L.exported, L.edit(L.edit(read(L.exported))) + "\n");
        const B = await stopped(root, "command", "before-finish");
        await A.resume();
        const reply = await B.resume();
        assert.equal(reply.complete, true, JSON.stringify(reply));
        await settled(base, root, "after B");
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  );
}

// Sol review (C-62): the claim commits on its own, before the capture
// check. Helpers: the meta rows as stored, a no-op commit by another
// connection, and B, an index in another process, run concurrently.
const metaRows = (root) => {
  const db = new DatabaseSync(graphAt(root), { readOnly: true });
  try {
    return db
      .prepare("SELECT key, value FROM graph_meta ORDER BY key")
      .all()
      .map((row) => [row.key, row.value]);
  } finally {
    db.close();
  }
};
const graphTables = (before, after) =>
  compareRows(before, after).filter((diff) => diff.table !== "graph_meta");
const noOpCommit = (root) => {
  const db = new DatabaseSync(graphAt(root));
  try {
    db.exec(
      "BEGIN IMMEDIATE; INSERT INTO graph_meta VALUES ('c62-test','x'); DELETE FROM graph_meta WHERE key='c62-test'; COMMIT;",
    );
  } finally {
    db.close();
  }
};
/** B: `graph index` in another process, started now; resolves to its answer. */
function concurrentIndex(root) {
  const child = spawn(
    process.execPath,
    [resolve("dist/cli/main.js"), "graph", "index", "--root", root, "--json"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (text) => (stdout += text));
  child.stderr.setEncoding("utf8").on("data", (text) => (stderr += text));
  const bound = setTimeout(() => child.kill("SIGKILL"), 180_000);
  return new Promise((done) =>
    child.on("close", (code) => {
      clearTimeout(bound);
      let answer;
      try {
        answer = JSON.parse(stdout);
      } catch {
        answer = undefined;
      }
      done({ code, answer, stderr });
    }),
  );
}

// A's capture no longer matches when it is checked, after its claim: A
// undoes the claim exactly. While A is held, a reader sees the old rows and
// no completion; afterwards the store is as before A started, row for row
// (its meta rows included), complete, and a no-edit index still verifies.
// B, an index run concurrently, either verifies or is taken over by the
// undo; it never leaves the store otherwise.
const undoCase = (language, how) =>
  test(
    `${language}${how === "session" ? " in a session" : ""}: a run whose capture no longer matches after its claim undoes the claim exactly; a concurrent index sees no torn state`,
    { skip: !proc && "needs /proc to see the child stopped" },
    async () => {
      const L = LANGUAGES[language];
      const { base, root, write, read } = project(language);
      try {
        let original = read(L.exported);
        // The store as it is before A starts (in a session, after the
        // session's first run, which kept Go's inputs).
        let before;
        const snapshot = () => ({
          rows: storeRows(graphAt(root)),
          meta: metaRows(root),
        });
        if (how === "session") write(L.exported, L.edit(original));
        else {
          before = snapshot();
          write(L.exported, L.removeExport(original));
        }
        const A = await stopped(
          root,
          how,
          "before-capture",
          how === "session"
            ? (warm) => {
                keptGo(warm);
                before = snapshot();
                original = read(L.exported);
                write(L.exported, L.removeExport(original));
              }
            : undefined,
        );
        // A is held after its claim: no completion, the old rows.
        assert.equal(
          metaRows(root).some(([key]) => key === "command-complete"),
          false,
          "no completion while the claim is held",
        );
        assert.deepEqual(
          graphTables(before.rows, storeRows(graphAt(root))),
          [],
          "the old rows while the claim is held",
        );
        write(L.exported, original);
        const B = concurrentIndex(root);
        overtaken(await A.resume(), "A");
        const b = await B;
        assert.ok(
          b.answer?.sync?.complete === true || b.code !== 0,
          `B: ${b.code} ${b.stderr}`,
        );
        // As before A started: rows and meta rows.
        assert.deepEqual(metaRows(root), before.meta, "the meta rows");
        assert.deepEqual(
          graphTables(before.rows, storeRows(graphAt(root))),
          [],
          "the rows",
        );
        assert.equal(cli(root, "status").sync.complete, true);
        // A no-edit index verifies: it writes nothing.
        assert.equal(cli(root).sync.complete, true);
        assert.deepEqual(metaRows(root), before.meta, "verified, unchanged");
        await settled(base, root, "after A");
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  );
for (const language of Object.keys(LANGUAGES)) undoCase(language, "command");
undoCase("go", "session");

// Something else commits after A's claim: no undo. A no-op commit by
// another connection leaves the store reporting incomplete, which one more
// index repairs; a newer run that claims leaves its own store untouched.
test(
  "go: a run whose claim another connection committed after is not undone; the store reports incomplete until the next index",
  { skip: !proc && "needs /proc to see the child stopped" },
  async () => {
    const L = LANGUAGES.go;
    const { base, root, write, read } = project("go");
    try {
      const original = read(L.exported);
      write(L.exported, L.removeExport(original));
      const A = await stopped(root, "command", "after-claim");
      write(L.exported, original);
      noOpCommit(root);
      overtaken(await A.resume(), "A");
      assert.equal(cli(root, "status").sync.complete, false);
      assert.equal(cli(root).sync.complete, true);
      await settled(base, root, "after one more index");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);
test(
  "go: a newer run that claims after A's claim keeps its store; A writes nothing",
  { skip: !proc && "needs /proc to see the child stopped" },
  async () => {
    const L = LANGUAGES.go;
    const { base, root, write, read } = project("go");
    try {
      const original = read(L.exported);
      write(L.exported, L.removeExport(original));
      const A = await stopped(root, "command", "after-claim");
      write(L.exported, original);
      assert.equal(cli(root).sync.complete, true);
      const B = storeRows(graphAt(root));
      const meta = metaRows(root);
      overtaken(await A.resume(), "A");
      assert.deepEqual(compareRows(B, storeRows(graphAt(root))), [], "B");
      assert.deepEqual(metaRows(root), meta, "B's meta rows");
      await settled(base, root, "after A");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);

// Opus review: a run that writes nothing (B, with no edit) begins after A
// has finished its run and before A publishes its completion; A publishes
// after B's baseline. B recognises A's completion: it publishes nothing and
// does not mark the store interleaved, so no later index redoes everything.
test(
  "go: a run that writes nothing leaves the completion another run published after its baseline",
  { skip: !proc && "needs /proc to see the child stopped" },
  async () => {
    const L = LANGUAGES.go;
    const { base, root, write, read } = project("go");
    try {
      write(L.exported, L.edit(read(L.exported)));
      const A = await stopped(root, "command", "before-publish");
      // A has finished its run: B finds nothing to write.
      const B = await stopped(root, "command", "before-publish");
      const a = await A.resume();
      assert.equal(a.complete, true, JSON.stringify(a));
      const b = await B.resume();
      assert.equal(b.complete, true, JSON.stringify(b));
      assert.equal(
        metaRows(root).some(([key]) => key === "index-run"),
        false,
        "no interleaved mark",
      );
      await settled(base, root, "after B");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);

// The Sol reviewer's window: A has passed its capture check (after its
// claim) and is held before its first rows commit; the file is restored
// and B indexes concurrently. B can no longer verify the old completion
// (the claim removed it). Whatever the order, B never answers complete
// over a store that differs from a cold index, and at most one more index
// settles it.
for (const language of Object.keys(LANGUAGES))
  test(
    `${language}: a run held after its capture check: a concurrent index never answers complete over a stale store`,
    { skip: !proc && "needs /proc to see the child stopped" },
    async () => {
      const L = LANGUAGES[language];
      const { base, root, write, read } = project(language);
      try {
        const original = read(L.exported);
        write(L.exported, L.removeExport(original));
        const A = await stopped(root, "command", "after-capture");
        write(L.exported, original);
        // B runs to its end while A is held: it cannot verify the old
        // completion (the claim removed it), and it cannot write while A
        // holds the lock, so it ends without answering complete.
        const b = await concurrentIndex(root);
        assert.notEqual(
          b.answer?.sync?.complete,
          true,
          `B answered complete over A's held claim: ${b.stderr}`,
        );
        await A.resume();
        if (b.answer?.sync?.complete === true)
          await settled(base, root, "B answered complete");
        else {
          assert.equal(cli(root).sync.complete, true);
          await settled(base, root, "after one more index");
        }
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  );

// The reviewer's two windows again, with A in an IndexSession whose first
// run kept Go's inputs (C-55; Go is the module that keeps them). A must
// still be rejected and leave B's store untouched.
const sessionCase = (what, gate, scenario) =>
  test(
    `go in a session with kept inputs: ${what}`,
    { skip: !proc && "needs /proc to see the child stopped" },
    async () => {
      const L = LANGUAGES.go;
      const { base, root, write, read } = project("go");
      try {
        const original = read(L.exported);
        // An edit for the session's first run to analyse, so it keeps.
        write(L.exported, L.edit(original));
        const edited = read(L.exported);
        await scenario({ root, write, edited, L, gate });
        await settled(base, root, "after A");
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  );
const read0 = (root, path) => readFileSync(join(root, path), "utf8");
const keptGo = (warm) => {
  assert.equal(warm.warm, true, "the session's first run completed");
  assert.ok(
    warm.kept.some((module) => module.startsWith("go\u0000")),
    `the session keeps Go's inputs: ${JSON.stringify(warm.kept)}`,
  );
};
sessionCase(
  "A paused after parsing an export's removal, the file restored while B completes",
  "after-parse",
  async ({ root, write, edited, L }) => {
    const A = await stopped(root, "session", "after-parse", (warm) => {
      keptGo(warm);
      write(L.exported, L.removeExport(edited));
    });
    write(L.exported, edited);
    assert.equal(cli(root).sync.complete, true);
    const B = storeRows(graphAt(root));
    overtaken(await A.resume(), "A");
    assert.deepEqual(compareRows(B, storeRows(graphAt(root))), [], "B");
  },
);
sessionCase(
  "A paused after its walk while B adds a file",
  "after-walk",
  async ({ root, write, L }) => {
    const A = await stopped(root, "session", "after-walk", (warm) => {
      keptGo(warm);
      // An edit for the gated run, so it walks and analyses.
      write(L.exported, read0(root, L.exported) + "\n// edited again\n");
    });
    write(...L.added);
    assert.equal(cli(root).sync.complete, true);
    const B = storeRows(graphAt(root));
    overtaken(await A.resume(), "A");
    assert.deepEqual(compareRows(B, storeRows(graphAt(root))), [], "B");
  },
);
// Three runs. A holds an older capture, before its claim; B has claimed for
// a newer tree and holds its mark; C, a full index, takes over and finishes.
// In either resume order, A and B write nothing more and disturb nothing:
// C's result stands, complete, with no further index.
for (const order of ["A, B", "B, A"])
  test(
    `three runs: an older capture and a taken-over run resumed ${order} leave the third run's complete result`,
    { skip: !proc && "needs /proc to see the child stopped" },
    async () => {
      const L = LANGUAGES.go;
      const { base, root, write, read } = project("go");
      try {
        const original = read(L.exported);
        write(L.exported, L.removeExport(original));
        const A = await stopped(root, "command", "after-parse");
        write(L.exported, L.edit(original));
        const B = await stopped(root, "command", "before-finish");
        write(...L.added);
        assert.equal(cli(root).sync.complete, true);
        const runs = { A, B };
        for (const name of order.split(", "))
          overtaken(await runs[name].resume(), name);
        await settled(base, root, `after ${order}`);
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  );

// A run killed at any gate leaves a store that one more index makes equal
// to a cold index of the tree; a run killed before its claim wrote nothing.
for (const gate of [
  "after-walk",
  "after-parse",
  "after-claim",
  "before-capture",
  "before-finish",
  "before-publish",
])
  test(
    `a run killed at ${gate} needs at most one more index`,
    { skip: !proc && "needs /proc to see the child stopped" },
    async () => {
      const L = LANGUAGES.go;
      const { base, root, write, read } = project("go");
      try {
        const before = storeRows(graphAt(root));
        write(L.exported, L.edit(read(L.exported)));
        const A = await stopped(
          root,
          gate === "after-walk" ? "index" : "command",
          gate,
        );
        await A.kill();
        // Killed after its claim committed: the store reports incomplete.
        if (gate === "after-claim" || gate === "before-capture")
          assert.equal(cli(root, "status").sync.complete, false, gate);
        if (gate === "after-walk" || gate === "after-parse")
          assert.deepEqual(
            compareRows(before, storeRows(graphAt(root))),
            [],
            "nothing written before the claim",
          );
        assert.equal(cli(root).sync.complete, true);
        await settled(base, root, `after ${gate}`);
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  );
