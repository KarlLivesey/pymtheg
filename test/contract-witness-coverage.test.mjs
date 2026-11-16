// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
import { tryFlow } from "../dist/behaviour/trial.js";
import { compileFlow } from "../dist/behaviour/flow.js";

const file = "/tmp/pym-contract-witness-coverage.pym";
const check = (source) =>
  analyseFile(file, () => {}, { buffers: { [file]: source } });
const examples = (run) =>
  run.report.results
    .filter((r) => r.witnessValidation === "source_replayed")
    .flatMap((r) => r.witnessOrDerivation.examples);

function permutations(values) {
  return values.length
    ? values.flatMap((value, i) =>
        permutations(values.filter((_, j) => i !== j)).map((rest) => [
          value,
          ...rest,
        ]),
      )
    : [[]];
}

test("bounded source witnesses are independent of declared parameter order", () => {
  for (const params of permutations([
    "region: String",
    "priority: Nat",
    "attempts: Nat",
    "minutes: Nat",
  ])) {
    const run = check(`op notify(text: String) -> Unit requires text != "";
      flow regionalNotice(${params.join(", ")}) -> Unit {
        if region == "eu" { call notify(""); } return unit;
      }`);
    const found = examples(run);
    assert.equal(found.length, 1, params.join(", "));
    assert.deepEqual(found[0].inputs, {
      attempts: "0",
      minutes: "0",
      priority: "0",
      region: "eu",
    });
    assert.equal(
      tryFlow(run.ir, found[0].entry, found[0].inputs).completion,
      "violated",
    );
  }
  for (const [params, guards] of [
    [
      "s: String, x: Int, y: Int, z: Int",
      'if x > 9 { return unit; } if s == "vip" { call r(-1); }',
    ],
    ["a: Int, b: Int, c: Int", "if a * a > 19 { call r(-1); }"],
    ["x: Int, y: Int, z: Int", "let go = x + y > 7; if go { call r(-1); }"],
  ]) {
    const run = check(`op r(q: Int) -> Unit requires q >= 0;
      flow f(${params}) -> Unit { ${guards} return unit; }`);
    assert.ok(examples(run).length, guards);
  }
});

test("negative rule boundaries produce exact failing inputs and replay", () => {
  for (const boundary of [
    "-500",
    "-99999999999999999999999999999999999999999999",
  ]) {
    const run = check(`op r(q: Int) -> Unit requires q >= ${boundary};
      flow f(d: Int) -> Unit { call r(d); return unit; }`);
    const [example] = examples(run);
    assert.ok(example, boundary);
    assert.equal(BigInt(example.inputs.d), BigInt(boundary) - 1n);
    assert.equal(
      tryFlow(run.ir, example.entry, example.inputs).completion,
      "violated",
    );
  }
  const unsupported =
    check(`op r(q: Int) -> Unit requires q >= -500 effects(remote.Net);
    flow f(d: Int) -> Unit effects(remote.Net) { call r(d); return unit; }`);
  const candidate = unsupported.report.results.find(
    (r) => r.analysisKind === "call-contract",
  );
  assert.equal(candidate.witnessValidation, "unvalidated");
  assert.equal(candidate.witnessOrDerivation.candidates[0].arguments.q, "-501");
});

test("source replay confirms a violation before a hole but never crosses a hole or type error", () => {
  const prefix = check(`op r(q: Nat) -> Unit requires q > 0;
    flow f(minutes: Nat) -> Unit { call r(minutes); return unknown "finish later"; }`);
  assert.equal(examples(prefix).length, 1);
  const [example] = examples(prefix);
  assert.equal(
    tryFlow(prefix.ir, example.entry, example.inputs).completion,
    "violated",
  );
  assert.equal(
    tryFlow(prefix.ir, "f", { minutes: "1" }).completion,
    "unsupported",
  );
  assert.throws(() => compileFlow(prefix.ir, "f"), /unresolved/);
  for (const body of [
    'unknown "work first"; call r(0); return unit;',
    'let number = unknown "value"; call r(number); return unit;',
    "let number = missing; call r(0); return unit;",
  ]) {
    const run = check(
      `op r(q: Nat) -> Unit requires q > 0; flow f() -> Unit { ${body} }`,
    );
    assert.equal(examples(run).length, 0, body);
  }
});
