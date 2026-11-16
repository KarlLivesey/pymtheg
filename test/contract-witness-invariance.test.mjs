// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
import { tryFlow, trialSchema } from "../dist/behaviour/trial.js";
const file = "/tmp/pym-witness-invariance.pym";
const check = (source) =>
  analyseFile(file, () => {}, { buffers: { [file]: source } });
const witnesses = (run) =>
  run.report.results
    .filter((p) => p.witnessValidation === "source_replayed")
    .flatMap((p) => p.witnessOrDerivation.examples);

test("renaming inputs and moving their declarations preserves bounded witness verdicts", () => {
  for (const [names, declarations] of [
    [
      ["a", "m", "z"],
      [0, 1, 2],
    ],
    [
      ["m", "z", "a"],
      [0, 1, 2],
    ],
    [
      ["zz", "a", "b"],
      [2, 0, 1],
    ],
    [
      ["x", "y", "p"],
      [1, 2, 0],
    ],
  ]) {
    const [a, b] = names;
    const run = check(`op r(q: Int) -> Unit requires q >= 0;
      flow f(${declarations.map((i) => `${names[i]}: Int`).join(",")}) -> Unit {
        let k = 5 + 9; if ${a} * ${a} * ${a} == 1 && ${b} * ${b} * ${b} == 125 { call r(-1); } return unit;
      }`);
    assert.equal(witnesses(run).length, 1, names.join(","));
    const witness = witnesses(run)[0];
    assert.equal(witness.inputs[a], "1");
    assert.equal(witness.inputs[b], "5");
    assert.equal(
      tryFlow(run.ir, witness.entry, witness.inputs).completion,
      "violated",
    );
  }
});

test("unrelated hard conditions cannot consume another call's witness allowance", () => {
  const hard = Array.from(
    { length: 5 },
    (_, i) =>
      `flow hard${i}(a: Int,b: Int,c: Int) -> Unit requires a*a+b*b+c*c < 0 { call r(-1000); return unit; }`,
  ).join("\n");
  const target = "flow zz(d: Int) -> Unit { call r(d); return unit; }";
  for (const flows of [target, hard + target, target + hard]) {
    const run = check("op r(q: Int) -> Unit requires q >= -500;" + flows);
    const found = witnesses(run).filter((w) => w.entry.endsWith("#zz"));
    assert.equal(found.length, 1);
    assert.deepEqual(found[0].inputs, { d: "-501" });
  }
});

test("trial results identify the exact failed call and condition", () => {
  const source =
    "op r(q: Int) -> Unit requires q > 0; flow f() -> Unit { call r(1); call r(-1); return unit; }";
  const run = check(source);
  const trial = trialSchema.parse(tryFlow(run.ir, "f", {}));
  assert.equal(trial.completion, "violated");
  assert.equal(trial.violation.code, "precondition");
  assert.equal(trial.violation.span.start, source.indexOf("call r(-1)"));
  assert.equal(trial.violation.condition.start, source.indexOf("q > 0"));
  assert.equal(trial.violation.span.file, file);
});

test("unused constants and commuting Boolean guards do not consume witness priorities", () => {
  const source =
    'op ship(weight: Int) -> Unit requires weight >= 1;flow dispatch(weight: Int,code: Int)->Unit { if code != 7 {unknown "manual handling";}call ship(weight);return unit;}';
  const codes = [];
  for (const padding of [
    "",
    "let handling=3;let boxes=10;let window=60;",
    Array.from({ length: 40 }, (_, i) => `let unused${i}=${i * 19};`).join(""),
  ]) {
    const run = check(source.replace("if code", padding + "if code"));
    assert.ok(witnesses(run).length > 0, padding);
    codes.push(run.diagnostics?.map((x) => x.code));
  }
  const template =
    "op r(q:Int)->Unit requires q>=1;flow f(a:Int,b:Int,flag:Bool)->Unit { if GUARD {return unit;}call r(a);return unit;}";
  for (const guard of [
    "flag == false && b != -502",
    "b != -502 && flag == false",
    "(flag == false) && (b != -502)",
  ]) {
    const run = check(template.replace("GUARD", guard));
    assert.ok(witnesses(run).length > 0, guard);
  }
});

test("guard nesting, mirroring, negation and extracted rules keep source-confirmed witnesses", () => {
  const shapes = [
    ["", 'if code != 7 { unknown "decide"; }'],
    ["", 'if 7 != code { unknown "decide"; }'],
    ["", 'if !(code == 7) { unknown "decide"; }'],
    ["rule seven() -> Int = 7;", 'if code != seven() { unknown "decide"; }'],
    [
      "rule notSpecial(c: Int) -> Bool = c != 7;",
      'if notSpecial(code) { unknown "decide"; }',
    ],
    ["", 'let a = code - 3; if a != 4 { unknown "decide"; }'],
    ["", 'if code * 2 != 14 { unknown "decide"; }'],
  ];
  for (const [rules, guard] of shapes) {
    const run = check(
      `op ship(weight: Int) -> Unit requires weight >= 1;${rules} flow dispatch(weight:Int,code:Int)->Unit{${guard}call ship(weight);return unit;}`,
    );
    assert.ok(
      run.report.diagnostics.some((d) => d.code === "C004"),
      guard,
    );
    assert.ok(
      witnesses(run).some((w) => w.inputs.code === "7"),
      guard,
    );
  }
  for (const guard of [
    "if walkIn == false && seats > 7 {return unit;}",
    "if walkIn == false {if seats > 7 {return unit;}}",
  ]) {
    const run = check(
      `op reserve(seats:Int)->Unit requires seats<=500;flow book(group:Int,seats:Int,walkIn:Bool)->Unit{${guard}if group > -1 {call reserve(seats);}return unit;}`,
    );
    assert.ok(
      run.report.diagnostics.some((d) => d.code === "C004"),
      guard,
    );
  }
  const run = check(
    'op ship(weight:Int)->Unit requires weight>=1;flow dispatch(weight:Int,code:Int,zone:Int)->Unit{if code !=7 {unknown "a";}if zone != code+5 {unknown "b";}call ship(weight);return unit;}',
  );
  assert.ok(
    witnesses(run).some((w) => w.inputs.code === "7" && w.inputs.zone === "12"),
  );
});

test("resolved rule guards refine the same source paths as their inline bodies", () => {
  for (const guard of ["if y > -2 {call r(a);}", "if rx(y) {call r(a);}"]) {
    const r = check(
      `op r(q:Int)->Unit requires q<=-498;rule rx(z:Int)->Bool=z > -2;flow f(a:Int,m:Int,y:Int)->Unit{if m != -499 {unknown "h";}${guard}return unit;}`,
    );
    assert.ok(r.report.diagnostics.some((d) => d.code === "C004"));
  }
  const r = check(
    "op r(q:Int)->Unit requires q<=499;rule lo(z:Int)->Bool=z<=0;rule hi(z:Int)->Bool=z>=-5;flow f(d:Int)->Unit{if lo(d){return unit;}if hi(d){return unit;}call r(d);return unit;}",
  );
  assert.equal(
    r.report.diagnostics.some((d) => /^C00[4-9]$/.test(d.code)),
    false,
  );
});
test("unused parameters do not consume the eight varying witness dimensions", () => {
  for (const count of [7, 8, 12, 24]) {
    const r = check(
      `op r(q:Int)->Unit requires q>0;flow f(n:Int,${Array.from({ length: count }, (_, i) => `unused${i}:Int`).join(",")})->Unit{call r(n);return unit;}`,
    );
    assert.ok(
      r.report.diagnostics.some((d) => d.code === "C004"),
      String(count),
    );
    const w = witnesses(r)[0];
    assert.equal(tryFlow(r.ir, w.entry, w.inputs).completion, "violated");
  }
});

test("rule predicates retained in Boolean aliases narrow only their captured bindings", () => {
  const r = check(
    "op r(q:Int)->Unit requires q>0;rule positive(z:Int)->Bool=z>0;flow f(d:Int)->Unit{let ok=positive(d);if ok {call r(d);}return unit;}",
  );
  assert.equal(
    r.report.diagnostics.some((d) => /^C00[4-9]$/.test(d.code)),
    false,
  );
  const bad = check(
    "op r(q:Int)->Unit requires q>0;rule positive(z:Int)->Bool=z>0;flow f(d:Int)->Unit{let ok=positive(d);if ok {for j in 1 {call r(j);}}return unit;}",
  );
  assert.ok(bad.report.diagnostics.some((d) => d.code === "C004"));
});
