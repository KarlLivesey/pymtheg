// SPDX-License-Identifier: MIT
import { controlledClock } from "./controlled-clock.mjs";
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
import { contractDocument } from "../dist/contracts/document.js";
import { scaffold } from "../dist/contracts/scaffold.js";
import { emitPlugin as timedEmitPlugin } from "../dist/contracts/plugins.js";
function emitPlugin(doc, path, target, signal, options = {}) {
  return timedEmitPlugin(doc, path, target, signal, {
    ...options,
    clock: options.clock ?? controlledClock(),
  });
}
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "pym-output-"));
  try {
    const file = join(root, "source.pym");
    await writeFile(
      file,
      'type Record = { value: Int }; type Problem = Failed(String) | Missing; op send(record: Record) -> Result<Record, Problem>; flow undecided() -> Unit { unknown "decision"; }',
    );
    const { ir } = analyseFile(file);
    await fn(root, ir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("one checked contract document feeds all three targets while preserving interface declarations and body obligations", () =>
  fixture(async (root, ir) => {
    const doc = contractDocument(ir);
    assert.equal(doc.schema, "pymtheg.contracts/v1");
    for (const target of ["typescript", "rust", "go"]) {
      const out = scaffold(ir, target);
      assert.ok(!out.omitted.some((d) => d.name === "undecided"));
      assert.match(
        out.source,
        /function undecided|fn undecided|func Undecided/,
      );
      assert.match(out.source, /Source: send/);
      assert.ok(out.symbols.every((s) => s.span.file.endsWith("source.pym")));
    }
    assert.match(scaffold(ir, "rust").source, /num_bigint::BigInt/);
    assert.match(scaffold(ir, "go").source, /\*big.Int/);
  }));
test("explicit plugin receives normalized contracts and returns validated mapped output", () =>
  fixture(async (root, ir) => {
    const file = join(root, "plugin.mjs");
    await writeFile(
      file,
      `export const apiVersion='pymtheg.emitter/v1',target='signatures',extension='.txt';export function emit(document){return {source:document.declarations.map(d=>d.name).join('\\n'),symbols:document.declarations.map(d=>({name:d.name,symbolId:d.symbolId})),notes:['Example signatures-only plugin'],dependencies:[]};}`,
    );
    const out = await emitPlugin(
      contractDocument(ir),
      file,
      "signatures",
      new AbortController().signal,
    );
    assert.match(out.source, /Record/);
    assert.ok(out.symbols.length);
    assert.equal(out.snapshotId, ir.snapshot.id);
    assert.equal(out.omitted.length, 0);
    await assert.rejects(
      emitPlugin(
        contractDocument(ir),
        file,
        "wrong-target",
        new AbortController().signal,
      ),
      /declares target "signatures".*--target is "wrong-target"/,
    );
  }));
test("plugin version, malformed JSON and incomplete source mapping cannot become valid output", () =>
  fixture(async (root, ir) => {
    const file = join(root, "plugin.mjs"),
      doc = contractDocument(ir),
      signal = new AbortController().signal;
    await writeFile(
      file,
      `export const apiVersion='wrong';export function emit(){}`,
    );
    await assert.rejects(emitPlugin(doc, file, "x", signal), /must implement/);
    await writeFile(
      file,
      `export const apiVersion='pymtheg.emitter/v1',target='x',extension='.x';export function emit(){console.log('not JSON');return {};}`,
    );
    await assert.rejects(
      emitPlugin(doc, file, "x", signal),
      /malformed output.*stdout is reserved.*console.error/,
    );
    await writeFile(
      file,
      `export const apiVersion='pymtheg.emitter/v1',target='x',extension='.x';export function emit(){return {source:'',symbols:[],notes:[],dependencies:[]};}`,
    );
    await assert.rejects(
      emitPlugin(doc, file, "x", signal),
      /every supplied declaration; missing: .*source.pym#/,
    );
  }));

test("cancelling an executing plugin reaps its process after explicit readiness", () =>
  fixture(async (root, ir) => {
    const file = join(root, "busy.mjs"),
      ready = join(root, "ready");
    await writeFile(
      file,
      `import {writeFileSync,renameSync} from 'node:fs';export const apiVersion='pymtheg.emitter/v1',target='busy',extension='.txt';export function emit(){writeFileSync(${JSON.stringify(ready + ".staging")},String(process.pid));renameSync(${JSON.stringify(ready + ".staging")},${JSON.stringify(ready)});while(true){}}`,
    );
    const controller = new AbortController();
    let watcher;
    const started = new Promise((resolve) => {
      watcher = watch(root, (_, name) => {
        if (name === "ready") resolve();
      });
    });
    const operation = emitPlugin(
      contractDocument(ir),
      file,
      "busy",
      controller.signal,
    );
    try {
      await Promise.race([
        started,
        operation.then(() => {
          throw Error("Plugin unexpectedly finished");
        }),
      ]);
      // The final path is published only after the complete PID has been written.
      const pid = Number(await readFile(ready, "utf8"));
      assert.ok(
        Number.isSafeInteger(pid) && pid > 0,
        "Readiness must contain a complete PID",
      );
      controller.abort();
      await assert.rejects(operation, /cancelled/);
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    } finally {
      controller.abort();
      watcher.close();
      await operation.catch(() => {});
    }
  }));

test("a fourth JavaScript target works through the public plugin document without compiler edits", () =>
  fixture(async (root, ir) => {
    const out = await emitPlugin(
      contractDocument(ir),
      resolve("examples/plugins/javascript.mjs"),
      "javascript",
      new AbortController().signal,
    );
    assert.equal(out.assurance, "plugin_declared");
    assert.match(out.source, /export function send\(record\)/);
    assert.match(out.source, /@returns/);
    const path = join(root, "generated.mjs");
    await writeFile(path, out.source);
    const module = await import(path);
    assert.equal(typeof module.send, "function");
  }));
test("missing emitter paths explain how to select a plugin or a built-in target", () =>
  fixture(async (root, ir) => {
    await assert.rejects(
      emitPlugin(
        contractDocument(ir),
        join(root, "missing.mjs"),
        "custom",
        new AbortController().signal,
      ),
      /Emitter plugin file was not found.*--plugin.*typescript/,
    );
  }));

test("the shipped emitter honors fail-fast defaults and explicit empty bodies", () =>
  fixture(async (root, ir) => {
    const path = resolve("examples/plugins/javascript.mjs");
    const fail = await emitPlugin(
      contractDocument(ir),
      path,
      "javascript",
      new AbortController().signal,
      { requirePolicy: true },
    );
    assert.equal(fail.implementation, "fail-fast");
    const output = join(root, "fail.mjs");
    await writeFile(output, fail.source);
    const generated = await import(output);
    assert.throws(() => generated.send({ value: 1n }), /Not implemented/);
    const empty = await emitPlugin(
      contractDocument(ir),
      path,
      "javascript",
      new AbortController().signal,
      { bodyPolicy: "empty", requirePolicy: true },
    );
    assert.equal(empty.implementation, "empty");
    assert.doesNotMatch(empty.source, /throw new Error/);
  }));

test("plugin deadline and escalation are driven after readiness, independently of machine speed", () =>
  fixture(async (root, ir) => {
    const file = join(root, "timeout.mjs"),
      ready = join(root, "deadline-ready"),
      clock = controlledClock();
    await writeFile(
      file,
      `import {writeFileSync,renameSync} from 'node:fs';export const apiVersion='pymtheg.emitter/v1',target='busy',extension='.txt';export function emit(){process.on('SIGTERM',()=>{});writeFileSync(${JSON.stringify(ready + ".staging")},String(process.pid));renameSync(${JSON.stringify(ready + ".staging")},${JSON.stringify(ready)});while(true){}}`,
    );
    let watcher;
    const started = new Promise((resolve) => {
      watcher = watch(root, (_, name) => {
        if (name === "deadline-ready") resolve();
      });
    });
    const operation = emitPlugin(
      contractDocument(ir),
      file,
      "busy",
      new AbortController().signal,
      { clock },
    );
    const rejected = assert.rejects(operation, /timed_out/);
    try {
      await Promise.race([
        started,
        operation.then(() => {
          throw Error("Plugin ended before readiness");
        }),
      ]);
      // The final path is published only after the complete PID has been written.
      const pid = Number(await readFile(ready, "utf8"));
      assert.ok(
        Number.isSafeInteger(pid) && pid > 0,
        "Readiness must contain a complete PID",
      );
      assert.equal(
        clock.fireNext(),
        5000,
        "The declared production deadline is scheduled",
      );
      assert.equal(
        clock.fireNext(),
        100,
        "Escalation is a separately controlled deadline",
      );
      await rejected;
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      assert.equal(clock.pending, 0);
    } finally {
      watcher?.close();
      while (clock.pending) clock.fireNext();
      await operation.catch(() => {});
    }
  }));
