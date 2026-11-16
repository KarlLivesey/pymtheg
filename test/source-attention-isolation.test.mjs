// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";

test("source attention preserves independent changes across deletion, large scope, parse failure and mid-check edits", async () => {
  const root = mkdtempSync(join(tmpdir(), "pym-attention-isolation-"));
  const service = new StudioService(root),
    signal = new AbortController().signal;
  try {
    for (let i = 0; i < 40; i++)
      writeFileSync(
        join(root, `c${i}.pym`),
        `flow comp${i}() -> Bool { return true; }`,
      );
    let saved;
    for (let i = 0; i < 40; i++)
      saved = await service.savePlanItem(
        saved?.id ?? "",
        {
          ...newPlanItem("P" + i),
          title: "Plan " + i,
          acceptance: "Observe the declared return",
          links: [{ kind: "depends-on", target: `source:c${i}.pym#comp${i}` }],
        },
        "Plan " + i,
        signal,
      );
    const check = async () =>
      (await service.architectureWork(saved.id)).filter((w) =>
        ["changed-target", "broken-link", "unknown-link-review"].includes(
          w.kind,
        ),
      );
    writeFileSync(
      join(root, "c7.pym"),
      "flow comp7() -> Bool { return false; }",
    );
    assert.deepEqual(
      (await check()).map((w) => [w.id, w.kind]),
      [["plan:P7", "changed-target"]],
    );
    unlinkSync(join(root, "c3.pym"));
    let work = await check();
    assert.deepEqual(work.map((w) => [w.id, w.kind]).sort(), [
      ["plan:P3", "broken-link"],
      ["plan:P7", "changed-target"],
    ]);
    for (let i = 0; i < 2100; i++)
      writeFileSync(join(root, `noise${i}.pym`), "");
    work = await check();
    assert.deepEqual(work.map((w) => [w.id, w.kind]).sort(), [
      ["plan:P3", "broken-link"],
      ["plan:P7", "changed-target"],
    ]);
    writeFileSync(join(root, "c9.pym"), "flow comp9( {");
    work = await check();
    assert.ok(
      work.some((w) => w.id === "plan:P9" && w.kind === "unknown-link-review"),
    );
    assert.ok(
      work.some((w) => w.id === "plan:P7" && w.kind === "changed-target"),
    );
    assert.ok(!work.some((w) => w.id === "plan:P8"));
    const capture = service.captureSourceContracts.bind(service);
    let edited = false;
    service.captureSourceContracts = async (...args) => {
      const result = await capture(...args);
      if (!edited) {
        edited = true;
        writeFileSync(
          join(root, "c1.pym"),
          "flow comp1() -> Bool { return false; }",
        );
      }
      return result;
    };
    work = await check();
    assert.ok(edited);
    assert.ok(
      work.some((w) => w.id === "plan:P1" && w.kind === "unknown-link-review"),
    );
    assert.ok(
      work.some((w) => w.id === "plan:P7" && w.kind === "changed-target"),
    );
    assert.ok(work.some((w) => w.id === "plan:P3" && w.kind === "broken-link"));
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
