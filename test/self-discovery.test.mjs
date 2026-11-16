// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
test("discovery self-model matches observed entry, directory and parse counts", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-discovery-model-"));
  try {
    await mkdir(join(root, "design"));
    await mkdir(join(root, "target"));
    const entry = join(root, "design", "main.pym");
    await writeFile(entry, "flow main() -> Unit {}");
    for (let i = 0; i < 1000; i++)
      await writeFile(
        join(root, "target", `${i}.pym`),
        `rule generated${i}(value: Nat) -> Bool = value > 0;`,
      );
    const scoped = analyseFile(entry, () => {}, {
      root,
      related: true,
      sourcePolicy: { include: ["design/**/*.pym"] },
    }).report;
    const broad = analyseFile(entry, () => {}, {
      root,
      related: true,
      sourcePolicy: { include: ["**/*.pym"] },
    }).report;
    const model = analyseFile("examples/self/discovery.pym").report;
    assert.deepEqual(
      model.diagnostics.filter((d) => d.severity === "error"),
      [],
    );
    const maximum = (flow, metric) =>
      model.results.find((r) =>
        r.propertyId.endsWith(`#${flow}/cost/${metric}`),
      ).witnessOrDerivation.maximum;
    for (const [flow, report] of [
      ["selectSourceTree", scoped],
      ["includeGeneratedTree", broad],
    ]) {
      assert.equal(
        String(report.measurements.discoveryEntries),
        maximum(flow, "directory_entries"),
      );
      assert.equal(
        String(report.measurements.discoveryDirectories),
        maximum(flow, "directory_reads"),
      );
      assert.equal(
        String(
          report.measurements.parses + report.measurements.discoveryParses,
        ),
        maximum(flow, "source_parses"),
      );
      assert.equal(
        report.snapshot.files.length,
        1,
        "Discovery parses do not become unrelated typed modules",
      );
    }
    assert.equal(scoped.measurements.discoveryEntries, 3);
    assert.equal(broad.measurements.discoveryEntries, 1003);
    assert.equal(scoped.measurements.discoveryParses, 0);
    assert.equal(broad.measurements.discoveryParses, 1000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
