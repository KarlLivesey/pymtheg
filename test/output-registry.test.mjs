// SPDX-License-Identifier: MIT
import { controlledClock } from "./controlled-clock.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { OutputRegistry } from "../dist/contracts/registry.js";
import { analyseFile } from "../dist/analysis/index.js";
import { contractDocument } from "../dist/contracts/document.js";
const loadRegistry = (specs) =>
  OutputRegistry.load(specs, new AbortController().signal, {
    clock: controlledClock(),
  });
test("only explicitly registered targets run and changed emitter entries require a new launch", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-registered-output-"));
  let registry;
  try {
    const source = join(root, "main.pym");
    await writeFile(source, "op result() -> Bool;");
    const doc = contractDocument(analyseFile(source).ir);
    const plugin = join(root, "emitter.mjs");
    const text = await (
      await import("node:fs/promises")
    ).readFile(resolve("examples/plugins/javascript.mjs"), "utf8");
    await writeFile(plugin, text);
    registry = await loadRegistry(["javascript=" + plugin]);
    assert.ok(
      registry.targets().some((t) => t.id === "javascript" && !t.builtin),
    );
    const output = await registry.emit(
      doc,
      "javascript",
      "fail-fast",
      new AbortController().signal,
    );
    assert.equal(output.implementation, "fail-fast");
    await assert.rejects(
      registry.emit(
        doc,
        "unregistered",
        "fail-fast",
        new AbortController().signal,
      ),
      /Unknown output target/,
    );
    await writeFile(plugin, text + "\n// changed entry");
    await assert.rejects(
      registry.emit(
        doc,
        "javascript",
        "fail-fast",
        new AbortController().signal,
      ),
      /changed after launch/,
    );
    await assert.rejects(
      loadRegistry(["typescript=" + plugin]),
      /already registered/,
    );
  } finally {
    await registry?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("closing the output registry cancels and reaps an active emitter", async () => {
  const { watch } = await import("node:fs");
  const { readFile } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "pym-registry-cancel-"));
  let registry, watcher, operation;
  try {
    const path = join(root, "main.pym"),
      ready = join(root, "ready"),
      plugin = join(root, "busy.mjs");
    await writeFile(path, "op run() -> Unit;");
    const document = contractDocument(analyseFile(path).ir);
    await writeFile(
      plugin,
      `import {writeFileSync,renameSync} from 'node:fs'; export const apiVersion='pymtheg.emitter/v1',target='busy',extension='.txt';export function emit(){writeFileSync(${JSON.stringify(ready + ".staging")},String(process.pid));renameSync(${JSON.stringify(ready + ".staging")},${JSON.stringify(ready)});while(true){}}`,
    );
    registry = await loadRegistry(["busy=" + plugin]);
    const started = new Promise((resolve) => {
      watcher = watch(root, (_, name) => {
        if (name === "ready") resolve();
      });
    });
    operation = registry.emit(
      document,
      "busy",
      "fail-fast",
      new AbortController().signal,
    );
    const rejected = assert.rejects(operation, /cancelled/);
    await Promise.race([
      started,
      operation.then(() => {
        throw Error("Emitter finished before readiness");
      }),
    ]);
    // The final path is published only after the complete PID has been written.
    const pid = Number(await readFile(ready, "utf8"));
    assert.ok(
      Number.isSafeInteger(pid) && pid > 0,
      "Readiness must contain a complete PID",
    );
    await registry.close();
    await rejected;
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    await assert.rejects(
      registry.emit(
        document,
        "busy",
        "fail-fast",
        new AbortController().signal,
      ),
      /cancelled/,
    );
  } finally {
    watcher?.close();
    await registry?.close();
    await operation?.catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("registration rejects invalid APIs, mismatched targets and invalid extensions before advertising them", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-register-check-"));
  try {
    const path = join(root, "bad.mjs");
    for (const [source, message] of [
      [
        'export const apiVersion="old",target="custom",extension=".txt"; export function emit(){}',
        /implement/,
      ],
      [
        'export const apiVersion="pymtheg.emitter/v1",target="different",extension=".txt"; export function emit(){}',
        /emitter declares different/,
      ],
      [
        'export const apiVersion="pymtheg.emitter/v1",target="custom",extension="../bad"; export function emit(){}',
        /metadata/,
      ],
      ["export INVALID JAVASCRIPT", /Cannot register/],
    ]) {
      await writeFile(path, source);
      await assert.rejects(loadRegistry(["custom=" + path]), message);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plugin budget is explicitly configurable and included in the agent launch configuration", async () => {
  const { outputPluginArguments } = await import(
    "../dist/contracts/registry.js"
  );
  const parsed = outputPluginArguments([
    "project",
    "--plugin-timeout",
    "30s",
    "--plugin",
    "javascript=" + resolve("examples/plugins/javascript.mjs"),
  ]);
  assert.equal(parsed.timeoutMs, 30000);
  assert.deepEqual(parsed.rest, ["project"]);
  assert.throws(
    () => outputPluginArguments(["--plugin-timeout", "121s"]),
    /120s/,
  );
  const registry = await OutputRegistry.load(
    parsed.specifications,
    new AbortController().signal,
    { timeoutMs: parsed.timeoutMs, clock: controlledClock() },
  );
  try {
    assert.deepEqual(registry.launchArguments().slice(-2), [
      "--plugin-timeout",
      "30000ms",
    ]);
  } finally {
    await registry.close();
  }
});
