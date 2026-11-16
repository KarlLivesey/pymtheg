// SPDX-License-Identifier: MIT
// Bounded explicit evidence capture; never overwrites historical research logs.
import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import Ajv from "ajv";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const validate = new Ajv({ allErrors: true }).compile(
  JSON.parse(readFileSync("docs/report.schema.json", "utf8")),
);
const cases = [
  ["algorithm", ["check", "examples/mvp/algorithm.pym"], 0],
  ["files-buggy", ["check", "examples/mvp/files-buggy.pym"], 1],
  ["files-fixed", ["check", "examples/mvp/files-fixed.pym"], 0],
  ["quote-unknown", ["check", "examples/mvp/checkout.pym"], 1],
  ["task-local", ["check", "examples/mvp/task-local.pym"], 1],
  ["self-pipeline", ["check", "examples/self/pipeline.pym"], 0],
  [
    "self-publication",
    ["simulate", "examples/self/publication.pym", "--entry", "Publication"],
    0,
  ],
];
for (const name of ["double-charge", "stock-leak", "missing-refund", "fixed"])
  cases.push([
    "simulate-" + name,
    ["simulate", `examples/mvp/checkout-${name}.pym`, "--entry", "Checkout"],
    name === "fixed" ? 0 : 1,
  ]);
for (const name of ["buggy", "fixed"])
  cases.push([
    "task-" + name,
    ["simulate", `examples/mvp/task-${name}.pym`, "--entry", "TaskRunner"],
    name === "fixed" ? 0 : 1,
  ]);
for (const name of ["double-charge", "stock-leak", "missing-refund", "fixed"])
  cases.push([
    "verify-" + name,
    ["verify", `examples/mvp/checkout-${name}.pym`, "--entry", "Checkout"],
    name === "fixed" ? 0 : 1,
  ]);
const selected = process.argv[2] === "--case" ? process.argv[3] : null;
assert.ok(
  !selected || cases.some((c) => c[0] === selected),
  "Unknown capture case",
);
const previous =
  selected && existsSync("evidence/acceptance.json")
    ? JSON.parse(readFileSync("evidence/acceptance.json", "utf8"))
    : null;
const summary = previous
  ? previous.cases
      .filter((c) => c.case !== selected)
      .map((c) => ({ ...c, capturedAt: c.capturedAt ?? previous.date }))
  : [];
for (const [name, args, expected] of cases.filter(
  (c) => !selected || c[0] === selected,
)) {
  const command = [
    ...args,
    "--format",
    "json",
    ...(args[0] === "check"
      ? []
      : [
          "--timeout",
          "12s",
          "--seed",
          "42",
          "--max-steps",
          "12",
          "--max-samples",
          "1000",
        ]),
  ];
  const p = spawnSync(process.execPath, ["dist/cli/main.js", ...command], {
    encoding: "utf8",
  });
  assert.ifError(p.error);
  const report = JSON.parse(p.stdout);
  const unresolved = report.results.some(
    (result) => result.completion === "timed_out",
  );
  if (!unresolved)
    assert.equal(p.status, expected, `${name}: ${p.stdout}${p.stderr}`);
  if (unresolved) process.exitCode = 2;
  assert.equal(validate(report), true, JSON.stringify(validate.errors));
  writeFileSync(`evidence/${name}.json`, p.stdout);
  summary.push({
    case: name,
    capturedAt: new Date().toISOString(),
    command: ["node", "dist/cli/main.js", ...command],
    exit: p.status,
    unresolved,
    matchedExpectation: p.status === expected,
    results: report.results.map((r) => ({
      property: r.propertyId.split("#").at(-1),
      outcome: r.outcome,
      completion: r.completion,
      method: r.method,
      validation: r.witnessValidation,
      bounds: r.scope.bounds ?? null,
      measurements: r.measurements,
    })),
    evidence: `${name}.json`,
  });
  console.log(
    `${name}: exit ${p.status}, ${report.results.length} scoped results`,
  );
}
writeFileSync(
  "evidence/acceptance.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      node: process.versions.node,
      cases: summary,
    },
    null,
    2,
  ) + "\n",
);
