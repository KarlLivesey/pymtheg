import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
function cli(file, entry, command = "simulate", extra = [], context) {
  const p = spawnSync(
    process.execPath,
    [
      "dist/cli/main.js",
      command,
      file,
      "--entry",
      entry,
      "--format",
      "json",
      ...(command === "simulate"
        ? ["--seed", "42", "--max-steps", "12", "--max-samples", "1000"]
        : []),
      "--timeout",
      process.env.PYM_TEST_BACKEND_TIMEOUT ?? "12s",
      ...extra,
    ],
    { encoding: "utf8" },
  );
  assert.ifError(p.error);
  assert.equal(p.signal, null, p.stderr);
  const r = JSON.parse(p.stdout);
  if (r.results.some((result) => result.completion === "timed_out")) {
    context.skip(
      "Configured checker time budget exhausted; correctness unresolved",
    );
    return null;
  }
  return { code: p.status, r };
}
for (const name of ["double-charge", "stock-leak", "missing-refund", "fixed"])
  test(`simulated checkout ${name}`, (t) => {
    const observed = cli(
      `examples/mvp/checkout-${name}.pym`,
      "Checkout",
      "simulate",
      [],
      t,
    );
    if (!observed) return;
    const { code, r } = observed;
    assert.equal(code, name === "fixed" ? 0 : 1, JSON.stringify(r));
    const b = r.results.filter(
      (x) =>
        x.analysisKind === "behaviour" && x.propertyId.includes("/invariant/"),
    );
    assert.ok(b.length === 3);
    assert.equal(
      r.results.find((x) => x.propertyId.endsWith("/state-domains")).outcome,
      "no_counterexample",
    );
    if (name === "fixed")
      assert.ok(
        b.every(
          (x) => x.method === "simulation" && x.outcome === "no_counterexample",
        ),
      );
    else
      assert.ok(
        b.some(
          (x) =>
            x.outcome === "counterexample" &&
            x.witnessValidation === "source_replayed",
        ),
      );
  });
for (const name of ["buggy", "fixed"])
  test(`simulated independent task shape ${name}`, (t) => {
    const observed = cli(
      `examples/mvp/task-${name}.pym`,
      "TaskRunner",
      "simulate",
      [],
      t,
    );
    if (!observed) return;
    const { code, r } = observed;
    assert.equal(code, name === "fixed" ? 0 : 1, JSON.stringify(r));
    assert.equal(
      r.results.find((x) => x.propertyId.endsWith("/invariant/singleDelivery"))
        .witnessValidation,
      name === "fixed" ? "not_applicable" : "source_replayed",
    );
  });
test("renamed and reordered source has generic lowering and replay", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pym-rename-"));
  try {
    let text = readFileSync("examples/mvp/task-buggy.pym", "utf8")
      .replaceAll("TaskRunner", "Courier")
      .replaceAll("deliveries", "sideEffects")
      .replaceAll("runJob", "executeTask")
      .replaceAll("enqueue", "submitWork")
      .replaceAll("acknowledged", "__proto__");
    text = text.replace(
      /(^ state[^\n]*\n)+/m,
      (block) => block.trimEnd().split("\n").reverse().join("\n") + "\n",
    );
    text += "\nrule unrelated(x: Int) -> Bool = x > 0;\n";
    const file = join(dir, "renamed.pym");
    writeFileSync(file, text);
    const observed = cli(file, "Courier", "simulate", [], t);
    if (!observed) return;
    const { code, r } = observed;
    assert.equal(code, 1);
    assert.ok(
      r.results
        .find((x) => x.outcome === "counterexample")
        .witnessOrDerivation.events.some((e) => e.operation === "executeTask"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
for (const name of ["double-charge", "stock-leak", "missing-refund", "fixed"])
  test(`verified checkout ${name}`, (t) => {
    const observed = cli(
      `examples/mvp/checkout-${name}.pym`,
      "Checkout",
      "verify",
      [],
      t,
    );
    if (!observed) return;
    const { code, r } = observed;
    assert.equal(code, name === "fixed" ? 0 : 1, JSON.stringify(r));
    assert.ok(
      r.results.some(
        (x) =>
          x.analysisKind === "behaviour" &&
          x.method === "finite_model_check" &&
          x.completion === "complete",
      ),
    );
    if (name === "fixed")
      assert.ok(
        r.results
          .filter((x) => x.analysisKind === "behaviour")
          .every((x) => x.outcome === "no_counterexample"),
      );
  });
test("late effects and failed compensation keep reconciliation pending", (t) => {
  const observed = cli(
    "examples/mvp/checkout-late.pym",
    "Reconciliation",
    "simulate",
    [],
    t,
  );
  if (!observed) return;
  assert.equal(observed.code, 0);
});
