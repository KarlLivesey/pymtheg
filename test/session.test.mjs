// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const source =
  "machine Sample { state n: Nat in 0..2 = 0; event advance when n < 2 { n = n + 1; } invariant once = n <= 1; }";
async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), "pym-session-"));
  try {
    const file = join(dir, "model.pym");
    await writeFile(file, source);
    return await run(file, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
function invoke(file, extra = []) {
  const p = spawnSync(
    process.execPath,
    [
      "dist/cli/main.js",
      "simulate",
      file,
      "--entry",
      "Sample",
      "--timeout",
      "120s",
      "--format",
      "json",
      ...extra,
    ],
    { encoding: "utf8" },
  );
  return { code: p.status, r: JSON.parse(p.stdout), err: p.stderr };
}
test("simulation writes one JSON report to stdout", async () =>
  await fixture(async (file) => {
    const x = invoke(file);
    assert.equal(x.code, 1, x.err);
    assert.equal(
      x.r.results.find((r) => r.propertyId.endsWith("/invariant/once")).method,
      "simulation",
    );
  }));
test("source edit during checking does not remap old evidence to the new snapshot", async () =>
  await fixture(async (file) => {
    const { analyseFile } = await import("../dist/analysis/index.js");
    const { runBackend } = await import("../dist/backends/adapter.js");
    const { staleSourcesAsync } = await import("../dist/language/project.js");
    const { ir } = analyseFile(file);
    let edited = false;
    const records = await runBackend(
      ir,
      {
        entry: "Sample",
        method: "exhaustive",
        seed: "42",
        maxSteps: 6,
        maxSamples: 10,
        timeoutMs: 120000,
        scopeFile: null,
      },
      new AbortController().signal,
      {
        onReady: () => {
          appendFileSync(file, "\n// edited while checking");
          edited = true;
        },
      },
    );
    assert.equal(edited, true);
    assert.ok(records.every((r) => r.scope.snapshotHash === ir.snapshot.id));
    assert.deepEqual(
      await staleSourcesAsync(
        ir.snapshot.sources,
        new AbortController().signal,
      ),
      [file],
    );
  }));
test("CPU-bound worker cancellation uses the production coordinator without timing assertions", async () => {
  const { analyseInWorker } = await import("../dist/cli/coordinator.js");
  const { pathToFileURL } = await import("node:url");
  const dir = await mkdtemp(join(tmpdir(), "pym-cpu-"));
  try {
    const script = join(dir, "busy.mjs");
    const progress = new SharedArrayBuffer(4);
    await writeFile(
      script,
      `import {parentPort,workerData} from 'node:worker_threads';const state=new Int32Array(workerData.progress);Atomics.store(state,0,1);parentPort.postMessage({kind:'snapshot',value:{id:'controlled-cpu-fixture',sources:[],diagnostics:[],measurements:{bytes:0,files:0,tokens:0,parses:0}}});while(true){Atomics.store(state,0,1);}`,
    );
    const c = new AbortController();
    let ready = false;
    const start = performance.now();
    const session = await analyseInWorker({
      file: "cpu-fixture.pym",
      signal: c.signal,
      workerURL: pathToFileURL(script),
      workerData: { progress },
      onProgress: () => {
        ready = true;
        c.abort();
      },
    });
    assert.equal(ready, true);
    assert.notEqual(Atomics.load(new Int32Array(progress), 0), 0);
    assert.equal(session.report.session.state, "Cancelled");
    console.error(
      `Controlled CPU cancellation observation: ${(performance.now() - start).toFixed(1)} ms (informational only)`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("publication error preserves available findings and valid JSON stdout", async () =>
  await fixture(async (file, dir) => {
    const x = invoke(file, ["--out", join(dir, "missing", "report.json")]);
    assert.equal(x.code, 3);
    assert.ok(x.r.diagnostics.some((x) => x.code === "PUBLISH"));
    assert.ok(x.r.results.some((x) => x.analysisKind === "behaviour"));
  }));
