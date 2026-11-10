import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyseFile } from "../dist/analysis/index.js";

// A concrete step counter over tiny syntax trees, independent of the cost DAG.
function run(statements, input) {
  let ticks = 0;
  for (const statement of statements) {
    if (statement.kind === "tick") ticks++;
    else if (statement.kind === "return") return { ticks, returned: true };
    else if (statement.kind === "if") {
      const condition =
        statement.condition === "flag" ? input.flag : input.n === 0;
      const branch = run(condition ? statement.yes : statement.no, input);
      ticks += branch.ticks;
      if (branch.returned) return { ticks, returned: true };
    } else if (statement.kind === "loop") {
      const count = statement.bound === "n" ? input.n : statement.bound;
      for (let i = 0; i < count; i++) {
        const body = run(statement.body, input);
        ticks += body.ticks;
        if (body.returned) return { ticks, returned: true };
      }
    } else assert.fail("Unknown oracle statement");
  }
  return { ticks, returned: false };
}
function source(statements, depth = 0) {
  return statements
    .map((s) => {
      if (s.kind === "tick") return "call tick();";
      if (s.kind === "return") return "return unit;";
      if (s.kind === "if")
        return `if ${s.condition === "flag" ? "flag" : "n == 0"} { ${source(s.yes, depth + 1)} } else { ${source(s.no, depth + 1)} }`;
      return `for index${depth} in ${s.bound} { ${source(s.body, depth + 1)} }`;
    })
    .join(" ");
}
function cases() {
  let state = 0x15c05;
  const choose = (n) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
  const block = (depth) =>
    Array.from({ length: 1 + choose(3) }, () => {
      const kind = choose(depth ? 4 : 2);
      if (kind === 0) return { kind: "tick" };
      if (kind === 1) return { kind: "return" };
      if (kind === 2)
        return {
          kind: "if",
          condition: choose(2) ? "flag" : "zero",
          yes: block(depth - 1),
          no: block(depth - 1),
        };
      return {
        kind: "loop",
        bound: [0, 2, "n"][choose(3)],
        body: block(depth - 1),
      };
    });
  const unique = new Map();
  for (let i = 0; i < 400; i++) {
    const body = block(3);
    unique.set(source(body), body);
  }
  return [...unique.values()];
}
test("reported work bounds cover independently executed branch, loop and return paths", () => {
  const hand = [
    { kind: "loop", bound: "n", body: [{ kind: "tick" }, { kind: "return" }] },
    { kind: "tick" },
  ];
  assert.deepEqual(run(hand, { n: 0, flag: false }), {
    ticks: 1,
    returned: false,
  });
  assert.deepEqual(run(hand, { n: 3, flag: true }), {
    ticks: 1,
    returned: true,
  });
  const root = mkdtempSync(join(tmpdir(), "pym-cost-oracle-"));
  try {
    const programs = cases();
    assert.ok(programs.length >= 100);
    const file = join(root, "paths.pym");
    writeFileSync(
      file,
      "op tick() -> Unit cost calls exact 1;\n" +
        programs
          .map(
            (body, i) =>
              `flow case${i}(n: Nat, flag: Bool) -> Unit bound n <= 3 { ${source(body)} }`,
          )
          .join("\n"),
    );
    const { report } = analyseFile(file);
    assert.deepEqual(
      report.diagnostics.filter((d) => d.severity === "error"),
      [],
    );
    const costs = new Map(
      report.results
        .filter((r) => r.analysisKind === "cost")
        .map((r) => [r.propertyId.split("#").at(-1), r]),
    );
    for (let i = 0; i < programs.length; i++) {
      const result = costs.get(`case${i}/cost/calls`);
      assert.ok(result, `Missing case ${i}`);
      const measured = Math.max(
        ...[0, 1, 2, 3].flatMap((n) =>
          [false, true].map((flag) => run(programs[i], { n, flag }).ticks),
        ),
      );
      assert.equal(result.completion, "complete", source(programs[i]));
      assert.ok(
        result.witnessOrDerivation.maximum !== null,
        source(programs[i]),
      );
      assert.ok(
        BigInt(result.witnessOrDerivation.maximum) >= BigInt(measured),
        `Case ${i}: ${result.witnessOrDerivation.maximum} < ${measured}: ${source(programs[i])}`,
      );
    }
    console.log(
      `${programs.length} generated programs checked over all 8 bounded inputs; no wall-clock assertion.`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
