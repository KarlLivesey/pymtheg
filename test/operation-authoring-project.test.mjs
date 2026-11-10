import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyseFile } from "../dist/analysis/index.js";
import { createDeclaration } from "../dist/studio/declaration-authoring.js";
import {
  sourceCatalogue,
  affectedSourceContracts,
} from "../dist/architecture/source-contracts.js";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";

test("an authored operation-rule change reaches 128 imported callers and their plans without tainting an independent plan", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-operation-project-"));
  const shared = join(root, "shared.pym");
  const entry = join(root, "main.pym");
  const base = "// The shared rule is deliberately in its own file.\n";
  const service = new StudioService(root);
  const signal = new AbortController().signal;
  try {
    await writeFile(shared, base);
    const generate = (bound) => {
      const { ir } = analyseFile(shared, () => {}, {
        root,
        buffers: { [shared]: base },
      });
      return createDeclaration(
        ir,
        shared,
        {
          kind: "operation",
          signature: {
            name: "reserve",
            inputs: [{ name: "amount", type: "Nat" }],
            output: "Nat",
            effects: [],
          },
          requires: [`amount > ${bound}`],
          ensures: ["result >= amount"],
        },
        ir.snapshot.sources[0].hash,
      ).text;
    };
    const paths = Array.from(
      { length: 128 },
      (_, i) => `call-${String(i).padStart(3, "0")}.pym`,
    );
    await writeFile(shared, generate(0));
    await Promise.all(
      paths.map((path, i) =>
        writeFile(
          join(root, path),
          `import "./shared.pym";\nflow work${i}() -> Nat { call reserve(1) as value; return value; }\n`,
        ),
      ),
    );
    await writeFile(
      entry,
      paths.map((path) => `import "./${path}";`).join("\n") +
        "\nflow independent() -> Bool { return true; }\n",
    );
    const before = analyseFile(entry, () => {}, { root });
    assert.equal(before.report.measurements.parses, 130);
    assert.equal(
      before.report.diagnostics.filter((d) => d.severity === "error").length,
      0,
    );
    const beforeCatalogue = sourceCatalogue(before.ir, root);
    let revision;
    for (const [id, target] of [
      ["R1", "source:call-000.pym#work0"],
      ["R2", "source:main.pym#independent"],
    ]) {
      revision = await service.savePlanItem(
        revision?.id ?? "",
        {
          ...newPlanItem(id),
          title: id === "R1" ? "Reserve an amount" : "Independent work",
          acceptance: "Keep the declared contract",
          links: [{ kind: "depends-on", target }],
        },
        "Retain contract expectations",
        signal,
      );
    }
    await writeFile(shared, generate(1));
    const after = analyseFile(entry, () => {}, { root });
    assert.equal(
      after.report.measurements.parses,
      130,
      "Shared imports are still parsed once per snapshot",
    );
    assert.equal(
      after.report.diagnostics.filter((d) => d.code === "C004").length,
      128,
    );
    const affected = affectedSourceContracts(
      beforeCatalogue,
      sourceCatalogue(after.ir, root),
    );
    assert.equal(affected.size, 129);
    for (let i = 0; i < 128; i++)
      assert.ok(affected.has(`source:${paths[i]}#work${i}`));
    assert.ok(!affected.has("source:main.pym#independent"));
    const work = await service.architectureWork(revision.id, signal);
    assert.ok(
      work.some(
        (item) =>
          item.id === "plan:R1" &&
          item.kind === "changed-target" &&
          item.target === "source:shared.pym#reserve",
      ),
    );
    assert.ok(
      !work.some(
        (item) =>
          item.id === "plan:R2" &&
          ["changed-target", "unknown-link-review"].includes(item.kind),
      ),
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
