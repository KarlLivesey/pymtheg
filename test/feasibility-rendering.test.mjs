// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

for (const [label, condition, expected] of [
  [
    "positive",
    "amount > 9007199254740993123456789",
    "9007199254740993123456790",
  ],
  [
    "negative",
    "amount < -9007199254740993123456789",
    "-9007199254740993123456790",
  ],
]) {
  test(`text and JSON preserve the same exact ${label} feasibility witness`, async () => {
    const root = await mkdtemp(join(tmpdir(), "pym-feasibility-render-"));
    try {
      const file = join(root, "rules.pym");
      await writeFile(
        file,
        `op reserve(amount: Int, ready: Bool) -> Int requires ${condition} requires ready ensures result >= amount;\n`,
      );
      const args = [resolve("dist/cli/main.js"), "check", file];
      const text = spawnSync(process.execPath, args, { encoding: "utf8" });
      assert.equal(text.status, 0, text.stderr + text.stdout);
      assert.ok(text.stdout.includes(expected));
      assert.match(text.stdout, /feasibility: established/);
      assert.doesNotMatch(text.stderr, /TypeError|BigInt/);
      const machine = spawnSync(
        process.execPath,
        [...args, "--format", "json"],
        { encoding: "utf8" },
      );
      assert.equal(machine.status, 0, machine.stderr);
      const witness = JSON.parse(machine.stdout).results.find(
        (r) => r.analysisKind === "feasibility",
      ).witnessOrDerivation.entryWitness;
      assert.equal(witness.amount, expected);
      assert.equal(witness.ready, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("a feasibility witness cannot hide a caller violation or change its CLI exit status", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-feasibility-finding-"));
  try {
    const file = join(root, "rules.pym");
    await writeFile(
      file,
      "op reserve(amount: Nat) -> Nat requires amount > 1;\nflow one() -> Nat { call reserve(1) as value; return value; }\n",
    );
    const result = spawnSync(
      process.execPath,
      [resolve("dist/cli/main.js"), "check", file],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stdout, /rules\.pym:2:\d+ error C004/);
    assert.match(result.stdout, /Call to reserve violates its precondition/);
    assert.doesNotMatch(result.stderr, /TypeError|BigInt/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
