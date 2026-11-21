// SPDX-License-Identifier: MIT
// C-22: index runs raced inside the store's own synchronous steps. A child
// process runs `graph index` and stops itself (SIGSTOP) at a step; this test
// waits for it to be stopped (an IPC message, then its process state), acts,
// and continues it. No timing: every step waits on an event. Ported from the
// review's reproducers (interleave.mjs, X2 "index inside journal switch" and
// "direct write after mark clear").
import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
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
import { DatabaseSync } from "node:sqlite";
import {
  discoverLanguages,
  indexProject,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import { compareRows, storeRows } from "../scripts/reindex/dump.mjs";

const child = new URL("graph-index-race-child.mjs", import.meta.url).pathname;
const proc = existsSync("/proc/self/status");
const production = await discoverLanguages();
const a = "export function foo() { return 1 }\n";
const graphAt = (root) => join(root, ".pymtheg/rebuildable/graph.sqlite");
const cli = (root, command = "index") => {
  const result = spawnSync(
    process.execPath,
    [resolve("dist/cli/main.js"), "graph", command, "--root", root, "--json"],
    { encoding: "utf8" },
  );
  assert.ok(result.status <= 2, result.stderr);
  return JSON.parse(result.stdout);
};
function project() {
  const base = mkdtempSync(join(tmpdir(), "c22-race-"));
  const root = join(base, "tree");
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write(
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }),
  );
  write("src/a.ts", a);
  for (const name of ["b", "c"])
    write(
      `src/${name}.ts`,
      `import { foo } from './a';\nexport const ${name} = foo();\n`,
    );
  assert.equal(cli(root).sync.complete, true);
  return { base, root, write };
}
/** The run in a child, stopped at `point`; `resume()` returns its reply. */
async function stopped(root, point) {
  const process_ = fork(child, [root, point], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  let reply;
  let stop;
  const at = new Promise((done) => (stop = done));
  process_.on("message", (message) => {
    if (message.stopped) stop(message);
    if (message.reply) reply = message.reply;
  });
  const exited = new Promise((done) =>
    process_.once("exit", (code, signal) => {
      stop(undefined);
      done({ code, signal });
    }),
  );
  const message = await at;
  assert.ok(message, `the run reached ${point}`);
  // Stopped for certain, not only about to be.
  while (
    !/^State:\s+T/m.test(readFileSync(`/proc/${process_.pid}/status`, "utf8"))
  )
    await new Promise(setImmediate);
  return {
    async resume() {
      process_.kill("SIGCONT");
      const result = await exited;
      assert.equal(result.code, 0);
      return reply;
    },
  };
}
async function equalsCold(base, root) {
  const graph = graphAt(root);
  const cold = join(base, "cold.sqlite");
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

test(
  "a run paused in its journal set-up while another run indexes to completion writes nothing stale",
  { skip: !proc && "needs /proc to see the child stopped" },
  async () => {
    const { base, root, write } = project();
    try {
      write("src/a.ts", a.replace("export function foo", "function foo"));
      const A = await stopped(root, "journal-window");
      // The export comes back and another run indexes the tree completely.
      write("src/a.ts", a);
      write("src/c.ts", "export const c = 42;\n");
      assert.equal(cli(root).sync.complete, true);
      const reply = await A.resume();
      // The other run committed after A's baseline. A stops as overtaken
      // at its first write, or finds nothing to write; either way it writes
      // nothing it saw before the other run, and claims no completion.
      if (reply.error)
        assert.match(reply.error, /took it over/, JSON.stringify(reply));
      else assert.equal(reply.complete, false, JSON.stringify(reply));
      assert.deepEqual(await equalsCold(base, root), []);
      const again = cli(root);
      assert.equal(again.sync.complete, true);
      assert.deepEqual(await equalsCold(base, root), []);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);

test(
  "a direct write after a run's last commit and before its completion leaves the graph incomplete, and one index repairs it",
  { skip: !proc && "needs /proc to see the child stopped" },
  async () => {
    const { base, root } = project();
    try {
      // An edit, so the run writes and clears its own mark.
      writeFileSync(join(root, "src/c.ts"), "export const c = 2;\n");
      const A = await stopped(root, "finish-commit");
      const db = new DatabaseSync(graphAt(root));
      try {
        const removed = db
          .prepare(
            "DELETE FROM graph_links WHERE kind='calls' AND file='src/b.ts'",
          )
          .run();
        assert.equal(removed.changes, 1);
      } finally {
        db.close();
      }
      const reply = await A.resume();
      assert.equal(reply.complete, false, JSON.stringify(reply));
      assert.equal(cli(root, "status").sync.complete, false);
      const repaired = cli(root);
      assert.equal(repaired.sync.complete, true);
      assert.deepEqual(await equalsCold(base, root), []);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);
