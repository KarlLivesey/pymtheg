import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const source =
  "machine Sample { state n: Nat in 0..2 = 0; event advance when n < 2 { n = n + 1; } invariant once = n <= 1; }";
const script = (body) =>
  `#!/usr/bin/env node\nif(process.argv.includes('--version')) {console.log('0.33.1');process.exit(0);}\n${body}\n`;
async function fixture(body, run) {
  const dir = await mkdtemp(join(tmpdir(), "pym-session-"));
  try {
    const file = join(dir, "model.pym"),
      fake = join(dir, "fake-quint");
    await writeFile(file, source);
    await writeFile(fake, script(body));
    await chmod(fake, 0o700);
    return await run(file, fake, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function invoke(file, fake, extra = [], onStderr = () => {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "dist/cli/main.js",
        "simulate",
        file,
        "--entry",
        "Sample",
        "--quint",
        fake,
        "--timeout",
        "120s",
        "--format",
        "json",
        ...extra,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "",
      err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => {
      err += c;
      onStderr(String(c), child);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      try {
        resolve({ code, signal, r: JSON.parse(out), err });
      } catch (e) {
        reject(Error(String(e) + out + err));
      }
    });
  });
}
const success = `const fs=require('fs');console.error('warning: external log');const path=process.argv.find(x=>x.startsWith('--out=')).slice(6);fs.writeFileSync(path,JSON.stringify({status:'ok',stage:'running',errors:[],warnings:[]}));`;
test("backend warnings do not contaminate JSON stdout", async () =>
  await fixture(success, async (file, fake) => {
    const x = await invoke(file, fake);
    assert.equal(x.code, 0);
    assert.equal(x.r.results.at(-1).method, "simulation");
  }));
test("malformed output and backend crash are integration failures, never violations", async () => {
  for (const body of [
    "process.exit(7);",
    `const fs=require('fs');fs.writeFileSync(process.argv.find(x=>x.startsWith('--out=')).slice(6),'{}');`,
  ])
    await fixture(body, async (file, fake) => {
      const x = await invoke(file, fake);
      assert.equal(x.code, 3);
      assert.equal(x.r.results.at(-1).outcome, "inconclusive");
      assert.equal(x.r.results.at(-1).completion, "failed");
    });
});
test("requested timeout classification uses a deterministic process boundary", async () =>
  await fixture("", async (file) => {
    const { analyseFile } = await import("../dist/analysis/index.js");
    const { runBackend } = await import("../dist/backends/adapter.js");
    const { ir } = analyseFile(file);
    const runner = async (command, args) => ({
      kind: args.includes("--version") ? "exited" : "timed_out",
      code: args.includes("--version") ? 0 : null,
      signal: null,
      stdout: args.includes("--version") ? "0.33.1\n" : "",
      stderr: "",
      elapsedMs: 0,
      cleanup: "fixture complete",
    });
    const records = await runBackend(
      ir,
      {
        entry: "Sample",
        backend: "quint",
        seed: "42",
        maxSteps: 1,
        maxSamples: 1,
        timeoutMs: 100,
        quint: "fake",
        tlcJar: null,
        scopeFile: null,
      },
      new AbortController().signal,
      runner,
    );
    assert.equal(records[0].completion, "timed_out");
    assert.equal(records[0].outcome, "inconclusive");
  }));

test("source edit during backend does not remap old evidence to new snapshot", async () =>
  await fixture(success, async (file, fake) => {
    await writeFile(
      fake,
      script(
        `const fs=require('fs');fs.appendFileSync(${JSON.stringify(file)},${JSON.stringify("\n// edited while checking")});${success.replace("const fs=require('fs');", "")}`,
      ),
    );
    const x = await invoke(file, fake);
    assert.equal(x.code, 2);
    assert.deepEqual(x.r.session.staleFiles, [file]);
    assert.notEqual(x.r.snapshot.files[0].hash, "");
  }));
test("missing requested tool is explicit and ordinary offline check is independent", async () =>
  await fixture(success, async (file, fake) => {
    const x = await invoke(file, fake + "-missing");
    assert.equal(x.code, 3);
    const p = spawnSync(
      process.execPath,
      ["dist/cli/main.js", "check", file, "--format", "json"],
      { encoding: "utf8" },
    );
    assert.equal(p.status, 0);
    assert.equal(JSON.parse(p.stdout).results[0].completion, "complete");
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
  await fixture(success, async (file, fake, dir) => {
    const x = await invoke(file, fake, [
      "--out",
      join(dir, "missing", "report.json"),
    ]);
    assert.equal(x.code, 3);
    assert.ok(x.r.diagnostics.some((x) => x.code === "PUBLISH"));
    assert.ok(x.r.results.some((x) => x.analysisKind === "behaviour"));
  }));
