// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentWorkspace } from "../dist/mcp/workspace.js";
import { analyseFile } from "../dist/analysis/index.js";
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "pym-related-"));
  let agent;
  try {
    await writeFile(join(root, "pay.pym"), "op pay(value: Nat) -> Nat;");
    await writeFile(
      join(root, "checkout.pym"),
      'import "pay.pym"; flow checkout() -> Nat {call pay(1) as r; return r;}',
    );
    await writeFile(
      join(root, "scratch.pym"),
      "flow broken() -> Nat {return false;}",
    );
    await mkdir(join(root, "notes"));
    await writeFile(join(root, "notes", "latin1.pym"), Buffer.from([255, 254]));
    agent = await AgentWorkspace.open(root);
    await fn({ root, agent });
  } finally {
    await agent?.close();
    await rm(root, { recursive: true, force: true });
  }
}
test("default related checks keep callers but isolate unrelated type errors and unreadable files", () =>
  fixture(async ({ root, agent }) => {
    const run = await agent.run(
      { file: "pay.pym" },
      new AbortController().signal,
    );
    assert.deepEqual(
      run.report.snapshot.files
        .map((f) => f.file.slice(root.length + 1))
        .sort(),
      ["checkout.pym", "pay.pym"],
    );
    assert.equal(
      run.report.diagnostics.filter((d) => d.severity === "error").length,
      0,
    );
    assert.ok(
      run.report.diagnostics.some(
        (d) => d.code === "L003" && d.span.file.endsWith("latin1.pym"),
      ),
    );
    assert.ok(run.ir);
    const changed = await agent.run(
      {
        file: "pay.pym",
        buffers: { "pay.pym": "op charge(value: Nat) -> Nat;" },
      },
      new AbortController().signal,
    );
    assert.ok(
      changed.report.consumers.diagnostics.some(
        (d) => d.span.file.endsWith("checkout.pym") && d.code === "N002",
      ),
    );
    assert.ok(
      !changed.report.consumers.diagnostics.some((d) =>
        d.span.file.endsWith("scratch.pym"),
      ),
    );
    const isolated = await agent.run(
      { file: "pay.pym", checkScope: "entry" },
      new AbortController().signal,
    );
    assert.equal(isolated.report.snapshot.files.length, 1);
    assert.deepEqual(isolated.report.diagnostics, []);
  }));
test("source include/exclude patterns control caller discovery without excluding the explicit entry", () =>
  fixture(async ({ root }) => {
    const { report } = analyseFile(join(root, "pay.pym"), () => {}, {
      root,
      related: true,
      sourcePolicy: { include: ["*.pym"], exclude: ["checkout.pym"] },
    });
    assert.deepEqual(
      report.snapshot.files.map((f) => f.file.slice(root.length + 1)),
      ["pay.pym"],
    );
    assert.ok(!report.diagnostics.some((d) => d.code === "L003"));
  }));

test("selected checks separate real consumer findings from unrelated declarations in their files", () =>
  fixture(async ({ root, agent }) => {
    await writeFile(
      join(root, "checkout.pym"),
      'import "pay.pym"; flow checkout() -> Nat {call pay(true) as r; return r;} flow unrelated() -> Nat {return false;}',
    );
    const run = await agent.run(
      { file: "pay.pym" },
      new AbortController().signal,
    );
    assert.equal(agent.summary(run).exitStatus, 0);
    assert.equal(
      run.report.diagnostics.filter((d) => d.severity === "error").length,
      0,
    );
    assert.ok(
      run.report.consumers.diagnostics.some(
        (d) =>
          d.code === "T007" ||
          d.message.includes("argument") ||
          d.message.includes("Nat"),
      ),
    );
    const source = run.report.snapshot.files.find((f) =>
      f.file.endsWith("checkout.pym"),
    ).text;
    assert.ok(
      run.report.consumers.diagnostics.every(
        (d) => d.span.start < source.indexOf("flow unrelated"),
      ),
    );
    assert.ok(
      run.report.consumers.results.some((p) =>
        p.propertyId.includes("#checkout/"),
      ),
    );
    assert.ok(
      !run.report.consumers.results.some((p) =>
        p.propertyId.includes("#unrelated/"),
      ),
    );
  }));

test("a parser hole in a related file remains visible even when no caller declaration survives", () =>
  fixture(async ({ root }) => {
    const caller = join(root, "checkout.pym");
    await writeFile(
      caller,
      'import "pay.pym"; flow checkout( { call pay(1); }',
    );
    const { report } = analyseFile(join(root, "pay.pym"), () => {}, {
      root,
      related: true,
    });
    assert.equal(
      report.diagnostics.filter((d) => d.severity === "error").length,
      0,
    );
    assert.ok(
      report.consumers.diagnostics.some(
        (d) => d.code === "P002" && d.span.file === caller,
      ),
    );
    assert.ok(report.consumers.incompleteFiles.includes(caller));
    assert.equal(
      report.consumers.results.length,
      0,
      "No property is invented for a declaration the parser could not recover",
    );
  }));

test("a loaded but unparseable caller prevents an exhaustive impact claim", () =>
  fixture(async ({ root }) => {
    await rm(join(root, "notes"), { recursive: true, force: true });
    const caller = join(root, "checkout.pym");
    await writeFile(
      caller,
      'import "pay.pym"; flow checkout( { call pay(1); }',
    );
    const { describeSignature, rewriteSignature } = await import(
      "../dist/studio/signature.js"
    );
    const { ir, report } = analyseFile(join(root, "pay.pym"), () => {}, {
      root,
      related: true,
    });
    const description = describeSignature(ir, join(root, "pay.pym") + "#pay");
    const preview = rewriteSignature(
      ir,
      description.symbolId,
      { ...description, name: "charge" },
      description.sourceHash,
    );
    assert.equal(preview.affectedComplete, false);
    assert.ok(preview.notices.some((n) => n.includes("syntax errors")));
    assert.ok(report.consumers.diagnostics.some((d) => d.code === "P002"));
  }));
