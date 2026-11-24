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
import { tableModule } from "./fixtures/graph-session/table-module.mjs";
import { controlledClock } from "./controlled-clock.mjs";

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
        workerData: { control, gate: gate.buffer, mode, root },
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
  const { jobs, stopped, gate } = jobsFor(root, "pause-store");
  try {
    const job = jobs.start({ command: "index" });
    await stopped();
    // The worker is inside a store call and cannot go on until the cancel
    // flag is set: it must answer `cancelled` at its next checkpoint.
    await jobs.cancel(job.id);
    assert.equal(job.state, "cancelled");
    assert.equal(job.answer, "cancelled", "the worker acknowledged");
    assert.equal(job.view, undefined, "no result came back");
    assert.equal(
      job.abortedAt,
      Atomics.load(gate, 2) + 1,
      "acted on at the first checkpoint after the flag",
    );
    const store = new SqliteGraphStore(graphAt(root), undefined, {
      readOnly: true,
    });
    try {
      assert.equal(store.graphCommandState(), null, "no completion record");
    } finally {
      store.close();
    }
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

// The worker stops after its nth store write call (as the C-22 kill child
// counts them). Under C-37's write batches a write call does not always
// commit: some of these points fall inside an open batch, where the
// termination discards the batch's uncommitted writes; the others fall
// after a commit. Either way the next job must repair the store to cold.
test("a worker terminated after any store write call (committed, or inside an open batch) leaves a store the next job repairs to cold", async (t) => {
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

test("after each job the worker reports what it keeps; over its bound it is ended when the job finishes", async () => {
  const { base, root, write } = tree(goFiles);
  const kept = jobsFor(root, "production");
  const bounded = jobsFor(root, "production", { restingBytes: 1 });
  try {
    // Within the default bound the worker stays.
    const first = await run(kept.jobs);
    assert.ok(first.memory.liveBytes > 0);
    assert.ok(first.memory.liveBytes < 512 * 1024 * 1024);
    assert.equal(first.workerEnded ?? false, false);
    await kept.jobs.close();
    // Over its bound it is ended as the job finishes; the next job starts a
    // new worker and its result equals cold.
    write("a/a.go", "package a\n\nfunc Hello() int { return 4 }\n");
    const over = await run(bounded.jobs);
    assert.equal(over.state, "complete");
    assert.equal(over.workerEnded, true);
    const next = await run(bounded.jobs);
    assert.equal(next.state, "complete");
    assert.equal(bounded.jobs.generation, 2);
    assert.deepEqual(await differencesFromCold(base, root, production), []);
  } finally {
    await kept.jobs.close();
    await bounded.jobs.close();
    rmSync(base, { recursive: true, force: true });
  }
});

/** The stored name of every `.k` file (the table module), by path. */
function storedNames(root) {
  const store = new SqliteGraphStore(graphAt(root), undefined, {
    readOnly: true,
  });
  try {
    return Object.fromEntries(
      store
        .files()
        .filter((file) => file.path.endsWith(".k"))
        .map((file) => [file.path, file.result.data?.name ?? null]),
    );
  } finally {
    store.close();
  }
}

test("through the worker, another process's complete index just before a run's baseline drops what the session kept", async () => {
  const { base, root, write } = tree({ "a.k": "k=alpha", "b.k": "k=beta" });
  const { jobs, gate } = jobsFor(root, "table-race");
  try {
    assert.equal((await run(jobs)).state, "complete");
    write("a.k", "k=ALPHA2");
    // Armed: the worker's next baseline is preceded by the other process.
    Atomics.store(gate, 2, 1);
    assert.equal((await run(jobs)).state, "complete");
    assert.equal(Atomics.load(gate, 2), 0, "the other process ran");
    write("b.k", "k=beta2");
    const last = await run(jobs);
    assert.equal(last.state, "complete");
    assert.equal(jobs.generation, 1);
    assert.ok(last.session.dropped >= 1, JSON.stringify(last.session));
    assert.deepEqual(storedNames(root), { "a.k": "ALPHA2", "b.k": "beta2" });
    assert.deepEqual(
      await differencesFromCold(
        base,
        root,
        new LanguageRegistry([tableModule]),
      ),
      [],
    );
  } finally {
    await jobs.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("a worker started under other code is ended before the next job", async () => {
  const { base, root, write } = tree(synFiles);
  let code = "1.0.0";
  const { jobs } = jobsFor(root, "keeping", { codeVersion: () => code });
  try {
    await run(jobs);
    write("1.syn", "edit a");
    await run(jobs);
    assert.equal(jobs.generation, 1, "the same code keeps the worker");
    code = "1.0.1";
    write("1.syn", "edit b");
    const job = await run(jobs);
    assert.equal(job.state, "complete");
    assert.equal(jobs.generation, 2, "an upgrade starts a new worker");
    assert.equal(job.session.runs, 1, "a fresh session");
  } finally {
    await jobs.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("a cancel during query evaluation is acted on at the query's next store read; the worker lives", async () => {
  const { base, root } = tree(synFiles);
  const { jobs, stopped, release } = jobsFor(root, "pause-query");
  try {
    assert.equal((await run(jobs)).state, "complete");
    const job = jobs.start({ command: "callers", args: ["0.syn:0"] });
    await stopped();
    const cancelling = jobs.cancel(job.id);
    release();
    await cancelling;
    assert.equal(job.state, "cancelled");
    assert.equal(job.answer, "cancelled", "the worker acknowledged");
    assert.equal(job.view, undefined, "no result came back");
    assert.equal(jobs.generation, 1, "acknowledged at a checkpoint");
    assert.equal((await run(jobs)).state, "complete");
    assert.equal(jobs.generation, 1);
  } finally {
    await jobs.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("a cancel while a module's returned promise is awaited aborts it through the signal; the worker lives", async () => {
  const { base, root } = tree(synFiles);
  const { jobs, stopped } = jobsFor(root, "await-module");
  try {
    const job = jobs.start({ command: "index" });
    await stopped();
    await jobs.cancel(job.id);
    assert.equal(job.state, "cancelled");
    assert.equal(job.answer, "cancelled", "the worker answered");
    assert.equal(jobs.generation, 1, "cancelled cooperatively, not ended");
  } finally {
    await jobs.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("a cancel inside a synchronous stretch a module marks after an await ends the worker at once", async () => {
  // C-50: the stretch reads as inside the module call, so the cancel
  // retires the worker without the grace. Unmarked, it would read as the
  // awaited section: the grace clock would be scheduled, and this test
  // fires it and fails instead of waiting.
  const { base, root } = tree(synFiles);
  const clock = controlledClock();
  const { jobs, stopped, release } = jobsFor(root, "stretch-module", {
    cancelClock: clock,
    graceMs: 30_000,
  });
  // C-50 review: if the worker is neither retired nor given a grace, the
  // cancel would wait forever. After this bound the stretch is released, so
  // the worker goes on and the test fails instead of hanging; the bound
  // decides nothing when the test passes.
  let bounded = false;
  const bound = setTimeout(() => {
    bounded = true;
    release();
  }, 3 * 60_000);
  try {
    const job = jobs.start({ command: "index" });
    await stopped();
    let retired = false;
    const cancelling = jobs.cancel(job.id).then(() => (retired = true));
    // Watches for a grace until the cancel has finished; a scheduled grace
    // is fired at once, so the cancel always finishes.
    let graced = false;
    while (!retired) {
      if (clock.pending > 0) {
        graced = true;
        clock.fireNext();
      }
      await new Promise(setImmediate);
    }
    await cancelling;
    assert.equal(bounded, false, "the cancel did not end the worker");
    assert.equal(graced, false, "no grace was scheduled");
    assert.equal(job.state, "cancelled");
    assert.equal(job.exited, true);
    assert.equal(job.answer, undefined, "the worker was ended, not answered");
    const next = jobs.start({ command: "status" });
    await next.done;
    assert.equal(jobs.generation, 2, "a new worker took the next job");
  } finally {
    clearTimeout(bound);
    release();
    await jobs.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("a module that ignores the abort while its promise is awaited is ended when the cancel's grace ends", async () => {
  const { base, root } = tree(synFiles);
  const clock = controlledClock();
  const { jobs, stopped } = jobsFor(root, "await-deaf", {
    cancelClock: clock,
    graceMs: 30_000,
  });
  try {
    const job = jobs.start({ command: "index" });
    await stopped();
    const cancelling = jobs.cancel(job.id);
    while (clock.pending === 0) await new Promise(setImmediate);
    assert.equal(clock.fireNext(), 30_000);
    await cancelling;
    assert.equal(job.state, "cancelled");
    assert.equal(job.answer, undefined, "the worker never answered");
    const next = jobs.start({ command: "status" });
    await next.done;
    assert.equal(jobs.generation, 2, "the silent worker was ended");
  } finally {
    await jobs.close();
    rmSync(base, { recursive: true, force: true });
  }
});
