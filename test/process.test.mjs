import { within, processState } from "./process-safety.mjs";
import { controlledClock as manualClock } from "./controlled-clock.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcess as productionRunProcess } from "../dist/backends/process.js";
import { atomicWrite } from "../dist/reporting/publish.js";
import { parseItf } from "../dist/backends/adapter.js";
const opts = { cwd: process.cwd(), timeoutMs: 2000 };
function runProcess(command, args, options) {
  const clock = options.clock ?? manualClock();
  const running = productionRunProcess(command, args, { ...options, clock });
  return within(
    running,
    "process leader reaping and output pipe closure",
    async () => {
      // On a failed safety bound, terminate even an uncooperative group.
      while (clock.pending) clock.fireNext();
      await within(running, "forced process cleanup after safety failure");
    },
  );
}
test("process distinguishes success, crash, spawn failure and nonzero result", async () => {
  assert.equal(
    (await runProcess(process.execPath, ["-e", 'console.log("ok")'], opts))
      .code,
    0,
  );
  assert.equal(
    (await runProcess(process.execPath, ["-e", "process.exit(12)"], opts)).code,
    12,
  );
  assert.equal(
    (await runProcess("/missing/pym-checker", [], opts)).kind,
    "spawn_failed",
  );
  const crash = await runProcess(
    process.execPath,
    ["-e", 'process.kill(process.pid,"SIGKILL")'],
    opts,
  );
  assert.equal(crash.signal, "SIGKILL");
  assert.equal(crash.kind, "exited");
});
test("timeout and cancellation terminate group, including retained pipes and child", async () => {
  // Both processes ignore TERM, so completion requires the controlled KILL.
  const leaf = `process.on('SIGTERM',()=>{});process.send('READY');setInterval(()=>{},1000);`;
  const script = `process.on('SIGTERM',()=>{});const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(leaf)}],{stdio:['ignore','inherit','inherit','ipc']});c.once('message',()=>console.log(c.pid));setInterval(()=>{},1000);`;
  const clock = manualClock();
  let ready = "";
  let triggered = false;
  const p = await runProcess(process.execPath, ["-e", script], {
    ...opts,
    clock,
    onStdout(text) {
      ready += text;
      if (!triggered && ready.includes("\n")) {
        triggered = true;
        assert.equal(clock.fireNext(), opts.timeoutMs);
        assert.equal(clock.fireNext(), 100, "advance TERM grace explicitly");
      }
    },
  });
  assert.equal(p.kind, "timed_out");
  const pid = Number(p.stdout.trim());
  assert.ok(pid > 0);
  await processState(
    pid,
    ["Z"],
    "descendant termination after group SIGKILL",
    true,
  );
  const c = new AbortController();
  const cancelClock = manualClock();
  const running = runProcess(
    process.execPath,
    [
      "-e",
      'process.on("SIGTERM",()=>{});console.log("READY");setInterval(()=>{},1000)',
    ],
    {
      ...opts,
      clock: cancelClock,
      signal: c.signal,
      onStdout: () => {
        c.abort();
        assert.equal(cancelClock.fireNext(), opts.timeoutMs);
        assert.equal(cancelClock.fireNext(), 100);
      },
    },
  );
  assert.equal((await running).kind, "cancelled");
});
test("exiting leader cannot leave a child holding output pipes", async () => {
  const leaf = `process.on('SIGTERM',()=>{process.stdout.write('CHILD_EXITING\\n',()=>process.exit(0));});process.send('READY');setInterval(()=>{},1000);`;
  const leader = `const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(leaf)}],{stdio:['ignore','inherit','inherit','ipc']});c.on('message',()=>{console.log('CHILD_READY');c.disconnect();c.unref();});`;
  const r = await runProcess(process.execPath, ["-e", leader], opts);
  assert.equal(r.kind, "exited");
  assert.match(r.stdout, /CHILD_READY/);
  assert.match(r.stdout, /CHILD_EXITING/);
});

test("output limits are explicit failures", async () => {
  const p = await runProcess(
    process.execPath,
    ["-e", 'setInterval(()=>process.stdout.write("x".repeat(10000)),1)'],
    { ...opts, maxBytes: 1000 },
  );
  assert.equal(p.kind, "output_limit");
  assert.ok(p.stdout.length <= 1000);
});
test("atomic publication preserves previous file on cancellation/failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pym-publish-"));
  try {
    const dest = join(dir, "report.json");
    await atomicWrite(dest, "old");
    const c = new AbortController();
    c.abort();
    await assert.rejects(atomicWrite(dest, "new", c.signal));
    assert.equal(await readFile(dest, "utf8"), "old");
    await assert.rejects(atomicWrite(join(dir, "missing", "report"), "new"));
    assert.equal(await readFile(dest, "utf8"), "old");
    await atomicWrite(dest, "new");
    assert.equal(await readFile(dest, "utf8"), "new");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("external JSON is validated before use", () =>
  assert.throws(() =>
    parseItf(
      { vars: [], states: [{}] },
      { variables: [{ generated: "v0" }], events: [] },
    ),
  ));

test("subprocess Unicode remains exact across bounded stream chunks", async () => {
  const value = "界🌍".repeat(100000);
  const result = await runProcess(
    process.execPath,
    ["-e", "process.stdout.write('界🌍'.repeat(100000))"],
    { ...opts, maxBytes: 1024 * 1024 },
  );
  assert.equal(result.kind, "exited");
  assert.equal(result.stdout, value);
});
