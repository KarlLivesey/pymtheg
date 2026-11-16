// SPDX-License-Identifier: MIT
import { exitStatus } from "../dist/reporting/report.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyseFile } from "../dist/analysis/index.js";
import { nodeKey } from "../dist/language/ast.js";
import { valueShape } from "../dist/studio/shapes.js";
import { StudioService } from "../dist/studio/service.js";
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "pym-shape-budget-"));
  let service;
  try {
    const types = Array.from(
      { length: 8 },
      (_, i) =>
        `type T${i} = {${Array.from({ length: 8 }, (_, f) => `f${f}: ${i ? "T" + (i - 1) : "Nat"}`).join(",")}};`,
    ).join("\n");
    const file = join(root, "main.pym");
    await writeFile(
      file,
      types + "\nflow inspect(value: T7) -> Bool {return true;}\n",
    );
    service = new StudioService(root);
    await fn({ root, file, service });
  } finally {
    await service?.close();
    await rm(root, { recursive: true, force: true });
  }
}
test("compact shared types cannot expand beyond a deterministic guided-shape budget", () =>
  fixture(async ({ file }) => {
    const { ir, report } = analyseFile(file);
    assert.deepEqual(
      report.diagnostics.filter((d) => d.severity === "error"),
      [],
    );
    const d = ir.declarations.find((d) => d.name === "inspect");
    const budget = { remaining: 512 };
    const shape = valueShape(
      ir,
      ir.types.get(nodeKey(d.params[0].type.span)),
      budget,
    );
    assert.equal(shape.kind, "unsupported");
    assert.match(shape.label, /Guided input size limit/);
    assert.ok(
      budget.remaining >= 0 && budget.remaining < 512,
      "Expansion consumes bounded work and may stop before exhausting an indivisible field group",
    );
    const bool = valueShape(ir, ir.types.get(nodeKey(d.result.span)));
    assert.deepEqual(bool, { kind: "bool", label: "Bool" });
  }));
test("coordinator cancellation during input metadata preparation retains completed findings and cancels the session", () =>
  fixture(async ({ service }) => {
    const done = new Promise((resolve) => {
      const off = service.subscribe((e) => {
        if (e.kind !== "run") return;
        if (e.run.phase === "preparing input controls")
          service.cancel(e.run.id);
        if (e.run.status !== "running") {
          off();
          resolve(e.run);
        }
      });
    });
    await service.start({
      file: "main.pym",
      buffers: {},
      kind: "check",
      clientId: "test",
      revision: 1,
      entry: "",
      seed: "42",
      maxSteps: 6,
      maxSamples: 1,
    });
    const run = await done;
    assert.equal(run.status, "cancelled");
    assert.equal(run.report.session.state, "Cancelled");
    assert.ok(run.report.results.length);
  }));

test("large guided input refusal preserves independent output shapes and completed source checks", () =>
  fixture(async ({ service }) => {
    const done = new Promise((resolve) => {
      const off = service.subscribe((e) => {
        if (e.kind === "run" && e.run.status !== "running") {
          off();
          resolve(e.run);
        }
      });
    });
    await service.start({
      file: "main.pym",
      buffers: {},
      kind: "check",
      clientId: "test",
      revision: 1,
      entry: "",
      seed: "42",
      maxSteps: 6,
      maxSamples: 1,
    });
    const run = await done;
    assert.equal(run.status, "completed");
    const callable = run.symbols.find((s) => s.name === "inspect").callable;
    assert.equal(callable.parameters[0].shape.kind, "unsupported");
    assert.equal(callable.result.kind, "bool");
    assert.deepEqual(
      run.report.diagnostics.filter((d) => d.severity === "error"),
      [],
    );
    assert.ok(run.report.results.length);
  }));

test("metadata preparation failure cannot leave an apparently successful report", () =>
  fixture(async ({ service }) => {
    service.symbols = async () => {
      throw Error("controlled metadata failure");
    };
    const done = new Promise((resolve) => {
      const off = service.subscribe((e) => {
        if (e.kind === "run" && e.run.status !== "running") {
          off();
          resolve(e.run);
        }
      });
    });
    await service.start({
      file: "main.pym",
      buffers: {},
      kind: "check",
      clientId: "test",
      revision: 1,
      entry: "",
      seed: "42",
      maxSteps: 6,
      maxSamples: 1,
    });
    const run = await done;
    assert.equal(run.status, "failed");
    assert.equal(exitStatus(run.report), 3);
    assert.match(run.error, /controlled metadata failure/);
    assert.ok(run.report.results.length);
  }));
