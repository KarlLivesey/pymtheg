// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { scenario, projectConfig } from "../dist/shared/config.js";
import { findConfig } from "../dist/project/config.js";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("scenario validation retains finite data without rounding large integers", () => {
  const s = scenario({
    file: "work.pym",
    entry: "main",
    scope: { inputs: { n: ["999999999999999999999999999999"] } },
  });
  assert.equal(s.seed, "42");
  assert.equal(s.scope.inputs.n[0], "999999999999999999999999999999");
  for (const bad of [
    { maxSteps: 0 },
    { seed: "9223372036854775808" },
    { scope: [] },
    { unrecognised: true },
  ])
    assert.throws(() => scenario({ file: "work.pym", entry: "main", ...bad }));
  assert.throws(() => projectConfig({ version: 2, scenarios: {} }));
});
test("project scenarios are discovered from imported file directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pym-config-"));
  try {
    await mkdir(join(dir, "source"));
    await mkdir(join(dir, ".pymtheg"), { recursive: true });
    await writeFile(
      join(dir, ".pymtheg/settings.json"),
      JSON.stringify({
        version: 1,
        scenarios: {
          small: {
            file: "source/main.pym",
            entry: "main",
            scope: { inputs: { n: [0, 1, 2] } },
          },
        },
      }),
    );
    const found = await findConfig(join(dir, "source"));
    assert.equal(found.root, dir);
    assert.deepEqual(found.config.scenarios.small.scope.inputs.n, [0, 1, 2]);
    assert.match(found.hash, /^[0-9a-f]{64}$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("machine scope validation is shared by emission and checking", async () => {
  const { machineScope } = await import("../dist/shared/config.js");
  assert.deepEqual(machineScope({}, { n: "0..2" }), []);
  assert.deepEqual(
    machineScope(
      { domains: { n: "0..2" }, assumptions: ["finite instance"] },
      { n: "0..2" },
    ),
    ["finite instance"],
  );
  assert.throws(
    () =>
      machineScope({ domains: { n: "0..1" }, assumptions: [] }, { n: "0..2" }),
    /exactly match/,
  );
  assert.throws(
    () =>
      machineScope(
        { domains: { n: "0..2" }, assumptions: [], ignored: true },
        { n: "0..2" },
      ),
    /Unknown/,
  );
});
