import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { RecoveryStore } from "../dist/studio/recovery.js";
const draft = {
  drafts: [
    {
      path: "main.pym",
      text: "flow unsaved() -> Unit {}",
      baseHash: "original",
    },
  ],
  context: null,
};
test("drafts persist and stale writers cannot overwrite a newer recovery record", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-recovery-"));
  let first, second;
  try {
    first = await RecoveryStore.openOrCreate(root);
    second = await RecoveryStore.openOrCreate(root);
    assert.equal(first.read().revision, 0);
    first.save(0, draft);
    assert.throws(
      () => second.save(0, { drafts: [], context: null }),
      /changed in another/,
    );
    assert.equal(second.read().drafts[0].text, draft.drafts[0].text);
    first.close();
    first = null;
    const restored = await RecoveryStore.openOrCreate(root);
    try {
      assert.equal(restored.read().drafts.length, 1);
    } finally {
      restored.close();
    }
  } finally {
    first?.close();
    second?.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("killing a writer before commit leaves the previous draft intact", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-recovery-crash-"));
  let child;
  try {
    const store = await RecoveryStore.openOrCreate(root);
    store.save(0, draft);
    store.close();
    child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');db.prepare('UPDATE workspace SET payload=? WHERE id=1').run(JSON.stringify({drafts:[],context:null}));console.log('READY');setInterval(()=>{},1000);`,
        join(root, ".pymtheg/shared/drafts.sqlite"),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const exited = new Promise((resolve) => child.once("exit", resolve));
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.stdout.on("data", (data) => {
        if (String(data).includes("READY")) resolve();
      });
      child.once("exit", () => reject(Error("Writer exited before readiness")));
    });
    child.kill("SIGKILL");
    await exited;
    const restored = await RecoveryStore.openOrCreate(root);
    try {
      assert.equal(restored.read().drafts[0].text, draft.drafts[0].text);
    } finally {
      restored.close();
    }
  } finally {
    child?.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
});
test("history is bounded and interrupted runs are never restored as passes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-history-"));
  try {
    const store = await RecoveryStore.openOrCreate(root);
    const request = {
      clientId: "test",
      revision: 0,
      file: "main.pym",
      buffers: { "main.pym": "secret draft" },
      kind: "check",
      entry: "main",
      seed: "42",
      maxSteps: 6,
      maxSamples: 10,
    };
    for (let i = 0; i < 4; i++)
      store.saveRun({
        sequence: 0,
        id: String(i),
        request,
        status: "running",
        phase: "loading",
        report: null,
        symbols: [],
        error: null,
      });
    store.close();
    const restored = await RecoveryStore.openOrCreate(root);
    try {
      const runs = restored.runs();
      assert.equal(runs.length, 3);
      assert.ok(
        runs.every(
          (r) => r.status === "cancelled" && r.error.includes("not a pass"),
        ),
      );
      assert.ok(runs.every((r) => Object.keys(r.request.buffers).length === 0));
    } finally {
      restored.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
