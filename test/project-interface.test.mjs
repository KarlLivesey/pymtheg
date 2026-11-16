// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
import { AgentWorkspace } from "../dist/mcp/workspace.js";
import { StudioService } from "../dist/studio/service.js";
import {
  describeSignature,
  rewriteSignature,
} from "../dist/studio/signature.js";
const source =
  "type Errors = Failed;\nop pay(value: Nat) -> Result<Nat, Errors>;";
const caller =
  'import "pay.pym";\nflow checkout() -> Nat { call pay(1) as r; match r { Ok(n) => {return n;} Failed => {return 0;} } }';
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "pym-project-interface-"));
  try {
    await writeFile(join(root, "pay.pym"), source);
    await writeFile(join(root, "checkout.pym"), caller);
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("project snapshot finds reverse callers once, including new buffers; an unchanged edit has no impact", () =>
  fixture(async (root) => {
    const file = join(root, "pay.pym");
    const { ir, report } = analyseFile(file, () => {}, {
      root,
      projectWide: true,
      buffers: {
        [join(root, "new.pym")]:
          'import "pay.pym"; flow newCaller() -> Unit { call pay(2) as r; return unit; }',
      },
    });
    assert.equal(report.measurements.parses, 3);
    const d = describeSignature(ir, file + "#pay");
    assert.deepEqual(
      rewriteSignature(ir, d.symbolId, d, d.sourceHash).affected,
      [],
    );
    const changed = rewriteSignature(
      ir,
      d.symbolId,
      { ...d, name: "charge" },
      d.sourceHash,
    );
    assert.deepEqual(changed.affected.map((x) => x.name).sort(), [
      "checkout",
      "newCaller",
    ]);
    const next = analyseFile(file, () => {}, {
      root,
      projectWide: true,
      buffers: { [file]: changed.text },
    });
    assert.ok(
      next.report.diagnostics.some(
        (d) =>
          d.span.file.endsWith("/checkout.pym") && d.message.includes("pay"),
      ),
    );
    assert.ok(
      !next.report.diagnostics.some((d) => d.code === "T006"),
      "unresolved call must not invent bad variants",
    );
    assert.equal(
      analyseFile(file).ir.snapshot.sources.length,
      1,
      "ordinary CLI closure stays bounded to its entry",
    );
  }));
test("Studio and agent checks expose external callers before and after an interface edit", () =>
  fixture(async (root) => {
    const agent = await AgentWorkspace.open(root);
    const studio = new StudioService(root);
    try {
      const run = await agent.run(
        { file: "pay.pym" },
        new AbortController().signal,
      );
      assert.equal(run.report.snapshot.files.length, 2);
      const d = describeSignature(run.ir, join(root, "pay.pym") + "#pay");
      const edit = rewriteSignature(
        run.ir,
        d.symbolId,
        { ...d, name: "charge" },
        d.sourceHash,
      );
      const broken = await agent.run(
        { file: "pay.pym", buffers: { "pay.pym": edit.text } },
        new AbortController().signal,
      );
      assert.ok(
        broken.report.consumers.diagnostics.some((d) =>
          d.span.file.endsWith("/checkout.pym"),
        ),
      );
      const completed = new Promise((resolve) => {
        const off = studio.subscribe((e) => {
          if (e.kind === "run" && e.run.status !== "running") {
            off();
            resolve(e.run);
          }
        });
      });
      await studio.start({
        file: "pay.pym",
        buffers: { "pay.pym": edit.text },
        kind: "check",
        clientId: "test",
        revision: 1,
        entry: "",
        seed: "42",
        maxSteps: 6,
        maxSamples: 1,
      });
      const checked = await completed;
      assert.equal(checked.status, "completed");
      assert.ok(
        checked.report.consumers.diagnostics.some((d) =>
          d.span.file.endsWith("/checkout.pym"),
        ),
      );
      assert.equal(checked.report.measurements.parses, 2);
    } finally {
      await agent.close();
      await studio.close();
    }
  }));
