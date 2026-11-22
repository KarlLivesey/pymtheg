// SPDX-License-Identifier: MIT
// C-48: the MCP server keeps one graph worker with an index session between
// jobs. Counted, not timed: requests report the session's counters and the
// jobs count the workers started; a worker stopped inside a store call or a
// module call waits on a gate the test opens; idleness uses a test clock.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { executeGraph } from "../dist/graph/commands.js";
import {
  discoverLanguages,
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import { GraphJobs } from "../dist/mcp/graph-jobs.js";
import { compareRows, storeRows } from "../scripts/reindex/dump.mjs";
import { module as synthetic } from "./fixtures/graph-core/synthetic.mjs";
import { keepingModule } from "./fixtures/mcp-graph/keeping-module.mjs";

const production = await discoverLanguages();
const worker = new URL(
  "./fixtures/mcp-graph/session-worker.mjs",
  import.meta.url,
);
const graphAt = (root) => join(root, ".pymtheg/rebuildable/graph.sqlite");
function tree(files) {
  const base = mkdtempSync(join(tmpdir(), "c48-mcp-"));
  const root = join(base, "tree");
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  mkdirSync(join(root, ".pymtheg"), { recursive: true });
  for (const [path, text] of Object.entries(files)) write(path, text);
  return { base, root, write };
}
const goFiles = {
  "go.mod": "module example.com/m\n\ngo 1.22\n",
  "a/a.go": "package a\n\nfunc Hello() int { return 1 }\n",
  "b/b.go":
    'package b\n\nimport "example.com/m/a"\n\nfunc B() int { return a.Hello() }\n',
};
const synFiles = Object.fromEntries(
  Array.from({ length: 4 }, (_, i) => [`${i}.syn`, `source ${i}`]),
);
/** Jobs whose workers run `mode`, with a gate the test holds. */
function jobsFor(root, mode, options = {}) {
  const gate = new Int32Array(new SharedArrayBuffer(12));
  const jobs = new GraphJobs(root, {
    launch: (control) =>
      new Worker(worker, {
        workerData: { control, gate: gate.buffer, mode },
        stdout: true,
        stderr: true,
      }),
    ...options,
  });
  return {
    jobs,
    gate,
    stopped: async () => {
      while (Atomics.load(gate, 0) === 0)
        await Atomics.waitAsync(gate, 0, 0).value;
    },
    release: () => {
      Atomics.store(gate, 1, 1);
      Atomics.notify(gate, 1);
    },
  };
}
const run = async (jobs) => {
  const job = jobs.start({ command: "index" });
  await job.done;
  return job;
};
async function differencesFromCold(base, root, registry) {
  const rows = storeRows(graphAt(root));
  const path = join(base, `cold-${Math.random().toString(36).slice(2)}.sqlite`);
  const cold = new SqliteGraphStore(path, rows.project[0]);
  try {
    await indexProject(root, registry, cold, {
      excludeDirectories: [".pymtheg"],
    });
  } finally {
    cold.close();
  }
  return compareRows(rows, storeRows(path));
}

test("two jobs reuse one worker and its loaded modules", async () => {
  const { base, root, write } = tree(goFiles);
  const { jobs } = jobsFor(root, "production");
  try {
    const first = await run(jobs);
    assert.equal(first.state, "complete");
    write("a/a.go", "package a\n\nfunc Hello() int { return 2 }\n");
    const second = await run(jobs);
    assert.equal(second.state, "complete");
    assert.equal(jobs.generation, 1);
    assert.equal(first.worker, second.worker);
    // One discovery of the modules for both runs.
    assert.deepEqual([second.session.loads, second.session.runs], [1, 2]);
    assert.deepEqual(await differencesFromCold(base, root, production), []);
  } finally {
    await jobs.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("a cancel in the graph command is acknowledged and the worker lives on", async () => {
  const { base, root } = tree(goFiles);
  const { jobs, stopped, release } = jobsFor(root, "pause-store");
  try {
    const job = jobs.start({ command: "index" });
    await stopped();
    // The worker is inside a store call: it answers at its next checkpoint.
    const cancelling = jobs.cancel(job.id);
    release();
    await cancelling;
    assert.equal(job.state, "cancelled");
    assert.equal(jobs.generation, 1);
    const next = await run(jobs);
    assert.equal(next.state, "complete");
    assert.equal(jobs.generation, 1);
    assert.deepEqual(await differencesFromCold(base, root, production), []);
  } finally {
    await jobs.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("a cancel inside a module call ends the worker; the next job repairs the store", async () => {
  const { base, root } = tree(synFiles);
  const registry = new LanguageRegistry([synthetic]);
  const { jobs, stopped } = jobsFor(root, "pause-module");
  try {
    const job = jobs.start({ command: "index" });
    await stopped();
    await jobs.cancel(job.id);
    assert.equal(job.state, "cancelled");
    assert.equal(job.exited, true);
  } finally {
    await jobs.close();
  }
  // The store the terminated worker left is repaired by the next index.
  const repaired = await executeGraph({ command: "index", root }, { registry });
  assert.equal(repaired.sync.complete, true);
  assert.deepEqual(await differencesFromCold(base, root, registry), []);
  rmSync(base, { recursive: true, force: true });
});

test("a worker that crashes ends its job; the next job starts a new worker and equals cold", async () => {
  const { base, root, write } = tree({ ...synFiles, "crash.syn": "boom" });
  const registry = new LanguageRegistry([synthetic]);
  const { jobs } = jobsFor(root, "crash-module");
  try {
    const crashed = await run(jobs);
    assert.equal(crashed.state, "error");
    assert.match(String(crashed.error), /exited/);
    rmSync(join(root, "crash.syn"));
    write("0.syn", "edited source 0");
    const next = await run(jobs);
    assert.equal(next.state, "complete");
    assert.equal(jobs.generation, 2);
    assert.deepEqual(await differencesFromCold(base, root, registry), []);
  } finally {
    await jobs.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("an index by another process between two jobs drops the kept state; the result equals cold", async () => {
  const { base, root, write } = tree(synFiles);
  const keeping = keepingModule;
  const { jobs } = jobsFor(root, "keeping");
  try {
    const first = await run(jobs);
    assert.equal(first.state, "complete");
    assert.equal(first.session.dropped, 0);
    // A CLI-style index in another connection, after an edit.
    write("1.syn", "edited by the other process");
    const other = await executeGraph(
      { command: "index", root },
      { registry: new LanguageRegistry([keeping]) },
    );
    assert.equal(other.sync.complete, true);
    write("2.syn", "edited again");
    const second = await run(jobs);
    assert.equal(second.state, "complete");
    assert.ok(second.session.dropped >= 1, JSON.stringify(second.session));
    assert.deepEqual(
      await differencesFromCold(base, root, new LanguageRegistry([keeping])),
      [],
    );
  } finally {
    await jobs.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("an idle worker is ended with its session, by a test clock", async () => {
  const { base, root } = tree(goFiles);
  let now = 0;
  const { jobs } = jobsFor(root, "production", {
    clock: () => now,
    idleMs: 1000,
  });
  try {
    await run(jobs);
    now = 999;
    assert.equal(jobs.releaseIfIdle(), false);
    now = 1000;
    assert.equal(jobs.releaseIfIdle(), true);
    const next = await run(jobs);
    assert.equal(next.state, "complete");
    assert.equal(jobs.generation, 2);
    assert.equal(next.session.loads, 1);
    assert.equal(next.session.runs <= 1, true);
  } finally {
    await jobs.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("a worker terminated after any committed write leaves a store the next job repairs to cold", async (t) => {
  const { base, root, write } = tree(goFiles);
  try {
    // A completed index, then an edit whose re-index is cut short.
    const { jobs: setup } = jobsFor(root, "production");
    assert.equal((await run(setup)).state, "complete");
    await setup.close();
    write("a/a.go", "package a\n\nfunc Hello() int { return 3 }\n");
    let n = 1;
    for (; ; n++) {
      const copy = join(base, `kill-${n}`);
      // Each kill point starts from the same tree and store.
      cpSync(root, copy, { recursive: true });
      const { jobs, gate, stopped } = jobsFor(copy, "write-limit");
      Atomics.store(gate, 2, n);
      const job = jobs.start({ command: "index" });
      const reached = await Promise.race([
        stopped().then(() => true),
        job.done.then(() => false),
      ]);
      if (!reached) {
        // The run made fewer than n writes: every boundary was tried.
        await jobs.close();
        break;
      }
      await jobs.close();
      const { jobs: next } = jobsFor(copy, "production");
      const repaired = await run(next);
      await next.close();
      assert.equal(repaired.state, "complete", `kill ${n}`);
      assert.deepEqual(
        await differencesFromCold(base, copy, production),
        [],
        `kill ${n}: the next job equals a cold index`,
      );
    }
    assert.ok(n > 3, `write boundaries tried: ${n - 1}`);
    t.diagnostic(`write boundaries: ${n - 1}`);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
