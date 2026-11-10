import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
export function check(source, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), "pym-test-"));
  try {
    const file = join(dir, "main.pym");
    writeFileSync(file, source);
    const p = spawnSync(
      process.execPath,
      ["dist/cli/main.js", "check", file, "--format", "json", ...extra],
      { encoding: "utf8" },
    );
    assert.equal(p.signal, null, p.stderr);
    return { code: p.status, report: JSON.parse(p.stdout) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const codes = (r) => r.report.diagnostics.map((d) => d.code);
test("actual syntax and UTF-16 token spans", () => {
  const r = check("// 🌍\nrule ok(x: Int) -> Bool = x ≥ 0;");
  assert.equal(r.code, 1);
  const d = r.report.diagnostics.find((d) => d.code === "P001");
  assert.equal(d.span.start, "// 🌍\nrule ok(x: Int) -> Bool = x ".length);
  assert.equal(d.span.end, d.span.start + 1);
});
test("signature fields and effect targets with declaration locations", () => {
  const r = check(
    "type A = { active: Bool }; rule bad(a: A) -> Bool = a.missing; op read(n: Int) -> Unit effects(remote.A); flow f() -> Unit effects(remote.B) { call read(true, 2); }",
  );
  assert.ok(codes(r).includes("T005"));
  assert.ok(codes(r).includes("T004"));
  assert.ok(codes(r).includes("T002"));
  assert.ok(codes(r).includes("E002"));
  assert.ok(r.report.diagnostics.find((d) => d.code === "T004").related.length);
});
test("holes isolated through resolved dependencies", () => {
  const r = check(
    'flow payment() -> Unit { unknown "reconcile"; } flow pure() -> Unit { return unit; } flow consumer() -> Unit { call payment(); }',
  );
  assert.equal(r.code, 2);
  const byName = (name) =>
    r.report.results.find((x) => x.propertyId.includes("#" + name + "/"));
  assert.equal(byName("pure").outcome, "established");
  assert.equal(byName("payment").completion, "incomplete");
  assert.equal(byName("consumer").completion, "incomplete");
});
test("outcome addition breaks consumer and valid propagation remains valid", () => {
  const src =
    "type Error = Declined | OutcomeUnknown; op pay() -> Result<Int, Error>; flow f() -> Result<Int, Error> { call pay() as r; propagate r; }";
  assert.equal(check(src).code, 0);
  const bad = src.replace(
    "propagate r;",
    "match r { Ok(v) => { return Ok(v); } Declined => { return Declined; } }",
  );
  assert.ok(codes(check(bad)).includes("C002"));
  assert.ok(
    codes(check(src.replace("propagate r;", "return Bogus;"))).includes("N002"),
  );
});
test("pure rule cannot hide an operation call", () =>
  assert.ok(
    codes(
      check("op io() -> Bool effects(remote.X); rule hidden() -> Bool = io();"),
    ).includes("E001"),
  ));
test("parser recovery cannot establish costs/types", () => {
  const r = check(
    "flow broken() -> Unit { let x = ; } flow healthy() -> Unit { return unit; }",
  );
  assert.equal(r.code, 1);
  assert.ok(r.report.results.every((x) => x.outcome !== "established"));
});
const work = "op tick() -> Unit cost calls exact 1; ";
const cost = (r, name, metric = "calls") =>
  r.report.results.find((x) =>
    x.propertyId.includes("#" + name + "/cost/" + metric),
  ).witnessOrDerivation;
test("cost composition derives 3N, hoisted 1+2N, budget is not work", () => {
  const r = check(
    work +
      "flow q(N: Nat) -> Unit bound N <= 200 budget calls <= 600 { for i in N { call tick(); call tick(); call tick(); } } flow better(N: Nat) -> Unit bound N <= 200 { call tick(); for i in N { call tick(); call tick(); } }",
  );
  assert.equal(r.code, 0);
  assert.equal(cost(r, "q").expression, "3 * N");
  assert.equal(cost(r, "q").maximum, "600");
  assert.equal(cost(r, "better").expression, "1 + 2 * N");
  assert.equal(cost(r, "better").maximum, "401");
});
test("cost zero, exclusive branch, early return, bounded retry and nested scan", () => {
  const r = check(
    work +
      'type Err = Retry; flow zero() -> Unit { for i in 0 { unknown "unreachable"; } } flow branch(b: Bool) -> Unit { if b { call tick(); } else { call tick(); call tick(); } } flow early() -> Unit { for i in 100 { call tick(); return unit; } call tick(); } flow retrying() -> Unit { retry 3 on Retry { call tick(); } } flow scan(N: Nat) -> Unit bound N <= 20 { for i in N { for j in N { call tick(); } } } op failing() -> Result<Unit, Err> cost calls exact 1;',
  );
  assert.equal(cost(r, "zero").maximum, "0");
  assert.equal(cost(r, "branch").maximum, "2");
  assert.equal(cost(r, "early").maximum, "1");
  assert.equal(cost(r, "retrying").maximum, "3");
  assert.equal(cost(r, "scan").maximum, "400");
  assert.equal(cost(r, "scan").expression, "N * N");
});
test("unknown costs and recursive costs never become zero", () => {
  const r = check(
    work +
      "op mystery() -> Unit; flow f() -> Unit { call mystery(); } flow recurse() -> Unit { call recurse(); }",
  );
  assert.equal(cost(r, "f").classification, "unknown");
  assert.equal(cost(r, "recurse").classification, "unknown");
  assert.equal(r.code, 2);
});
test("cost units and summaries reject negative/double-counting inputs", () => {
  assert.ok(
    codes(check("op bad() -> Unit cost calls exact -1;")).includes("T002"),
  );
  assert.ok(
    codes(
      check(work + "flow f() -> Unit cost calls exact 10 { call tick(); }"),
    ).includes("K001"),
  );
  assert.ok(
    codes(
      check(work + "flow f() -> Unit budget bytes <= 10 { call tick(); }"),
    ).includes("K004"),
  );
});
test("integer bounds are never rounded through Number", () => {
  const r = check(
    work +
      "flow f(N: Nat) -> Unit bound N <= 9007199254740993 { for i in N { call tick(); call tick(); call tick(); } }",
  );
  assert.equal(cost(r, "f").maximum, "27021597764222979");
});
test("alpha copies detected while different resolved rules and shared references stay distinct", () => {
  const r = check(
    "rule a(x: Int) -> Bool = x > 0; rule b(y: Int) -> Bool = y > 0; rule different(x: Int) -> Bool = x > 1; rule c(x: Int) -> Bool = a(x); rule d(x: Int) -> Bool = different(x); flow f() -> Unit { let a = a(1); let b = a(2); }",
  );
  const dup = r.report.diagnostics.filter((d) => d.code === "D001");
  assert.equal(dup.length, 1);
  assert.match(dup[0].message, /a, b/);
  assert.equal(r.report.measurements.rulePairComparisons, 0);
});
const resource =
  "resource File { states Open, Closed; initial Open; terminal Closed; Open -> Closed; Closed -> Closed; } ";
test("file success/error exits and cleanup correction", () => {
  const src =
    resource +
    "type Parse = Good | Bad; flow process(take f: File, p: Parse) -> Unit effects(state.File) { match p { Good => { transition f -> Closed; return unit; } Bad => { return unit; } } } on cancel { transition f -> Closed; }";
  const bad = check(src);
  assert.ok(codes(bad).includes("O004"));
  const fixed = check(
    src.replace(
      "Bad => { return unit;",
      "Bad => { transition f -> Closed; return unit;",
    ),
  );
  assert.equal(fixed.code, 0);
  assert.equal(
    fixed.report.results.find((r) => r.analysisKind === "ownership-lifecycle")
      .outcome,
    "established",
  );
});
test("transfer is not cleanup; failing callee and use after move", () => {
  const src =
    resource +
    "type E = Failed; op receiver(take f: File) -> Result<Unit, E> effects(state.File) settles f on (Ok); flow sender(take f: File) -> Result<Unit, E> effects(state.File) { call receiver(take f) as r; propagate r; } on cancel { transition f -> Closed; }";
  const r = check(src);
  assert.equal(r.code, 2);
  assert.ok(codes(r).includes("O006"));
  assert.match(
    r.report.results
      .find((x) => x.propertyId.includes("#sender/ownership"))
      .outstandingObligations.join(),
    /transferred/,
  );
  const fixed = check(src.replace("on (Ok)", "on (Ok, Failed, Cancelled)"));
  assert.equal(fixed.code, 0);
  assert.ok(
    codes(
      check(
        src.replace("propagate r;", "transition f -> Closed; propagate r;"),
      ),
    ).includes("O003"),
  );
});
test("borrows cannot mutate, transfer or escape; own per iteration settles", () => {
  assert.ok(
    codes(
      check(
        resource +
          "flow bad(borrow f: File) -> Unit effects(state.File) { transition f -> Closed; }",
      ),
    ).includes("O005"),
  );
  const r = check(
    resource +
      "flow good() -> Unit effects(state.File) { for i in 3 { own f: File; transition f -> Closed; } } on cancel { transition f -> Closed; }",
  );
  assert.equal(r.code, 0);
});
test("cancellation cleanup checked at intermediate resource states", () => {
  const r = check(
    resource +
      'flow f(take file: File) -> Unit effects(state.File) { transition file -> Closed; } on cancel { unknown "cleanup"; }',
  );
  assert.ok(codes(r).includes("O004"));
  assert.notEqual(r.code, 0);
});
test("early-return loop with only an upper cardinality bound can execute zero times", () => {
  const r = check(
    work +
      "flow f(N: Nat) -> Unit bound N <= 200 { for i in N { call tick(); return unit; } call tick(); call tick(); call tick(); }",
  );
  assert.equal(cost(r, "f").maximum, "3");
});
test("a bounded zero variable loop erases unknown work", () => {
  const r = check(
    work +
      "op unknownWork() -> Unit; flow f(N: Nat) -> Unit bound N <= 0 { for i in N { call unknownWork(); } }",
  );
  assert.equal(cost(r, "f").maximum, "0");
});
test("pure recursion explicitly rejected and literal false precondition is vacuous", () => {
  assert.ok(
    codes(check("rule cycle(x: Int) -> Int = cycle(x);")).includes("T007"),
  );
  const r = check("flow impossible() -> Unit requires false { return unit; }");
  assert.ok(codes(r).includes("V001"));
  assert.equal(r.code, 1);
  assert.equal(
    check(
      "flow unproved(x: Int) -> Unit requires x > 0 || x < -10 { return unit; }",
    ).code,
    2,
  );
});
test("conjunctive integer/Bool feasibility exposes contradiction and witnesses", () => {
  const bad = check(
    "flow f(x: Int) -> Unit requires x > 3 requires x <= 3 { return unit; }",
  );
  assert.ok(codes(bad).includes("V001"));
  const good = check(
    "flow f(x: Int, b: Bool) -> Unit requires x > 3 requires b { return unit; }",
  );
  assert.equal(good.code, 0);
  assert.equal(
    good.report.results.find((r) => r.analysisKind === "feasibility")
      .witnessOrDerivation.entryWitness.x,
    "4",
  );
});
test("repeated work remains a candidate until a stability contract exists", () => {
  const src =
    "op read() -> Unit effects(remote.Store) cost calls exact 1 STABILITY; flow f(N: Nat) -> Unit effects(remote.Store) bound N <= 20 { for i in N { call read(); } }";
  for (const [stable, expected] of [
    ["", false],
    ["stable", true],
  ]) {
    const r = check(src.replace("STABILITY", stable));
    const candidate = r.report.results.find(
      (r) => r.analysisKind === "repeated-work",
    );
    assert.equal(
      candidate.witnessOrDerivation.safeToInvestigateHoist,
      expected,
    );
  }
});
test("empty collection has zero cost and foreach element retains declared type", () => {
  const r = check(
    work +
      'flow empty() -> Unit { for x in [] { unknown "never"; } } flow elements(xs: List<Int>) -> Unit bound xs <= 5 { for x in xs { let ok = isPositive(x); } } rule isPositive(x: Int) -> Bool = x > 0;',
  );
  assert.equal(cost(r, "empty").maximum, "0");
  assert.ok(!codes(r).includes("T002"));
});
test("short-circuit pure calls and retry return preserve work boundaries", () => {
  const r = check(
    "rule expensive() -> Bool overhead calls exact 2 = true; rule never() -> Bool = false && expensive(); rule maybe(b: Bool) -> Bool = b && expensive(); type E = Again; op retryable() -> Result<Unit, E> cost calls exact 1; flow stop() -> Unit { retry 3 on Again { let x = expensive(); return unit; } let x = expensive(); }",
  );
  assert.equal(cost(r, "never").maximum, "0");
  assert.equal(cost(r, "maybe").maximum, "2");
  assert.equal(cost(r, "stop").maximum, "2");
});
test("a newly added error variant breaks a previously exhaustive source consumer", () => {
  const src =
    "type E = Declined; op pay() -> Result<Unit, E>; flow f() -> Unit { call pay() as r; match r { Ok(v) => { return unit; } Declined => { return unit; } } }";
  assert.equal(check(src).code, 0);
  assert.ok(
    codes(
      check(src.replace("E = Declined;", "E = Declined | OutcomeUnknown;")),
    ).includes("C002"),
  );
});
test("incompatible result propagation and invalid lifecycle transitions have real failures", () => {
  assert.ok(
    codes(
      check(
        "type E = Failed; op f() -> Result<Int, E>; flow g() -> Result<Unit, E> { call f() as r; propagate r; }",
      ),
    ).includes("T002"),
  );
  assert.ok(
    codes(
      check(
        resource +
          "flow f(take file: File) -> Unit effects(state.File) { transition file -> Closed; transition file -> Open; } on cancel { transition file -> Closed; }",
      ),
    ).includes("R002"),
  );
  const r = check(
    "type E = Failed; op f() -> Result<Unit, E>; flow g() -> Unit { call f() as r; match r { Wrong => { return unit; } } }",
  );
  assert.ok(r.report.diagnostics.find((d) => d.code === "T006").related.length);
});
test("Result errors are closed unions and cannot override the success tag", () => {
  assert.ok(codes(check("op bad() -> Result<Int, Int>;")).includes("T001"));
  assert.ok(
    codes(check("type E = Ok | Failed; op bad() -> Result<Int, E>;")).includes(
      "T001",
    ),
  );
});
test("nested resource containers cannot silently lose ownership obligations", () => {
  assert.ok(
    codes(
      check(
        resource +
          "type Box = { file: File }; flow bad(box: Box) -> Unit { return unit; }",
      ),
    ).includes("O007"),
  );
  assert.ok(
    codes(
      check(resource + "flow bad(files: List<File>) -> Unit { return unit; }"),
    ).includes("O007"),
  );
});
test("identifier spelling cannot access object prototypes in symbolic bounds", () => {
  const r = check(
    work +
      "flow f(constructor: Nat, __proto__: Nat) -> Unit bound constructor <= 3 bound __proto__ <= 2 { for i in constructor { for j in __proto__ { call tick(); } } }",
  );
  assert.equal(r.code, 0);
  assert.equal(cost(r, "f").maximum, "6");
});
test("call contracts distinguish literal violation, discharge, and pending proof", () => {
  const src =
    "op positive(x: Int) -> Unit requires x > 0 ensures true; flow f() -> Unit { call positive(ARG); }";
  assert.ok(codes(check(src.replace("ARG", "0"))).includes("C004"));
  assert.equal(check(src.replace("ARG", "1")).code, 0);
  const r = check(
    "op positive(x: Int) -> Unit requires x > 0; flow f(x: Int) -> Unit { call positive(x); }",
  );
  assert.equal(r.code, 1);
  const replay = r.report.results.find(
    (x) => x.analysisKind === "call-contract",
  );
  assert.equal(replay.completion, "complete");
  assert.equal(replay.witnessValidation, "source_replayed");
  assert.deepEqual(replay.witnessOrDerivation.examples[0].inputs, { x: "0" });
});
test("an inferred local collection cannot hide an owned resource alias", () => {
  assert.ok(
    codes(
      check(
        resource +
          "flow f(take file: File) -> Unit effects(state.File) { let aliases = [file]; transition file -> Closed; } on cancel { transition file -> Closed; }",
      ),
    ).includes("O007"),
  );
});
