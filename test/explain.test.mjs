import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
import { findingPresenter } from "../dist/reporting/explain.js";
import { renderText } from "../dist/reporting/report.js";
async function fixture(source, fn) {
  const root = await mkdtemp(join(tmpdir(), "pym-explain-"));
  try {
    const file = join(root, "main.pym");
    await writeFile(file, source);
    const { report } = analyseFile(file);
    await fn(report);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("a wrong argument is explained with the call, expected interface and a decision to make", () =>
  fixture(
    "op save(n: Nat) -> Unit;\nflow main() -> Unit { call save(true); }",
    (report) => {
      const diagnostic = report.diagnostics.find((d) => d.code === "T002");
      assert.ok(diagnostic);
      const explanation = findingPresenter(report)(diagnostic);
      assert.equal(
        explanation.title,
        "This value does not match the required type",
      );
      assert.match(explanation.message, /Expected Nat, got Bool/);
      assert.match(explanation.why, /caller/);
      assert.match(explanation.nextStep, /argument/);
      assert.equal(explanation.location.line, 2);
      assert.ok(
        explanation.relatedLocations.some((s) => s.excerpt.includes("op save")),
      );
    },
  ));

test("common type notation mistakes explain the supported replacement", async () => {
  for (const [source, hint] of [
    ["op read(n: int) -> Unit;", /did you mean Int/],
    ["op read(n: String[]) -> Unit;", /List<String>/],
    ["type Status = | Ready | Done;", /without a leading/],
    ['type Status = "ready" | "done";', /Ready \| Done/],
    ["op read(n: Option<String>) -> Unit;", /Some\(String\).*None/],
    ["op read(n: Map<String, Nat>) -> Unit;", /record.*List/i],
  ])
    await fixture(source, (report) => {
      assert.ok(report.diagnostics.length);
      assert.match(report.diagnostics[0].message, hint);
      assert.equal(report.diagnostics[0].span.file.endsWith("main.pym"), true);
      const text = renderText(report, {
        sources: [],
        diagnostics: [],
        measurements: {},
        id: "test",
      });
      assert.doesNotMatch(text, /counterexample/);
    });
});

test("empty loaded source has a real first location while absent source stays unlocated", () =>
  fixture("", (report) => {
    const finding = {
      code: "P002",
      severity: "error",
      message: "Expected a declaration",
      span: { file: report.snapshot.files[0].file, start: 0, end: 0 },
      related: [],
      path: [],
    };
    const present = findingPresenter(report);
    assert.equal(present(finding).location.line, 1);
    assert.equal(present(finding).location.column, 1);
    assert.equal(
      present({ ...finding, span: { ...finding.span, file: "/missing" } })
        .location.line,
      null,
    );
  }));
test("budget guidance does not present a conservative work bound as measured runtime", () =>
  fixture(
    "op read() -> Unit cost calls exact 1; flow main(N: Nat) -> Unit bound N <= 5 budget calls <= 2 { for i in N { call read(); } }",
    (report) => {
      const diagnostic = report.diagnostics.find((d) => d.code === "K002");
      assert.ok(diagnostic);
      const explanation = findingPresenter(report)(diagnostic);
      assert.match(explanation.why, /calculated work bound/);
      assert.match(explanation.nextStep, /contributing calls/);
      assert.doesNotMatch(explanation.why, /measured|milliseconds/);
    },
  ));
test("missing decisions remain unresolved in the explanation", () =>
  fixture(
    'flow main() -> Unit { unknown "what happens on failure?"; }',
    (report) => {
      const diagnostic = report.diagnostics.find((d) => d.code === "U001");
      const explanation = findingPresenter(report)(diagnostic);
      assert.match(explanation.why, /cannot establish/);
      assert.match(explanation.nextStep, /decision/);
      assert.match(explanation.evidenceNote, /incomplete/);
    },
  ));

test("arity, unreachable statements and absent work metrics have distinct actionable guidance", () =>
  fixture(
    "op f(n: Nat) -> Unit; flow main() -> Unit budget reads <= 2 { call f(); return unit; call f(1); }",
    (report) => {
      const present = findingPresenter(report);
      assert.match(
        present(report.diagnostics.find((d) => d.code === "T004")).nextStep,
        /number of arguments/,
      );
      assert.match(
        present(report.diagnostics.find((d) => d.code === "C001")).why,
        /earlier return/,
      );
      assert.match(
        present(report.diagnostics.find((d) => d.code === "K004")).why,
        /limit alone/,
      );
    },
  ));

test("direct lifecycle effects name the missing declaration without inventing a call", () =>
  fixture(
    "resource File { states Open, Closed; initial Open; terminal Closed; Open -> Closed; } flow main() -> Unit { own f: File; transition f -> Closed; }",
    (report) => {
      const diagnostic = report.diagnostics.find((d) => d.code === "E002");
      assert.ok(diagnostic);
      const explanation = findingPresenter(report)(diagnostic);
      assert.match(
        explanation.nextStep,
        /add state.File to effects\(\.\.\.\) on main/,
      );
      assert.doesNotMatch(explanation.why, /indirect call/);
    },
  ));

test("a unique misspelt declaration gets a bounded hint, not implicit resolution", () =>
  fixture(
    "rule eligible(age: Nat) -> Bool = age >= 18; flow main(age: Nat) -> Bool { return eligble(age); }",
    (report) => {
      assert.match(
        report.diagnostics.find((d) => d.code === "N002").message,
        /did you mean eligible/,
      );
      assert.ok(report.results.some((r) => r.completion === "incomplete"));
    },
  ));

test("an operation in an expression gets call syntax guidance rather than an unrelated effect-declaration fix", () =>
  fixture(
    "op charge(order: Nat) -> Bool effects(remote.Payments); flow pay(order: Nat) -> Bool { let r = charge(order); return r; }",
    (report) => {
      const finding = report.diagnostics.find((d) => d.code === "E001");
      assert.ok(finding);
      const explanation = findingPresenter(report)(finding);
      assert.match(explanation.title, /separate step/);
      assert.match(explanation.nextStep, /call charge\(order\) as result;/);
      assert.doesNotMatch(explanation.nextStep, /Declare the effect/);
      const missing = report.diagnostics.find((d) => d.code === "E002");
      assert.ok(missing);
      assert.match(
        findingPresenter(report)(missing).nextStep,
        /remote.Payments/,
      );
    },
  ));

test("newcomer syntax errors give an actionable first correction without false spelling advice", async () => {
  for (const [source, hint] of [
    ["type T = { a?: Nat };", /Optional fields.*None.*Some\(Nat\)/],
    [
      "flow f(a?: Nat) -> Bool { return true; }",
      /Optional inputs.*None.*Some\(Nat\)/,
    ],
    ["flow f(n: Nat) -> Bool { while n > 0 {} return true; }", /bounded.*for/],
    [
      "flow f(n: Nat) -> Bool { await g(n); return true; }",
      /call.*finite.*event/i,
    ],
    [
      "op g(n: Nat) -> Bool; flow f(n: Nat) -> Bool { let r = g(n); return r; }",
      /call g\(n\) as result;/,
    ],
  ])
    await fixture(source, (report) => {
      assert.match(report.diagnostics[0].message, hint);
      if (source.includes("?:")) assert.equal(report.diagnostics.length, 1);
    });
  await fixture(
    "type T = { a: Nat }\nflow f(x: T) -> Bool { return x.a > 0; }",
    (report) => {
      assert.match(report.diagnostics[0].message, /Expected ';'/);
      const unresolved = report.diagnostics.find((d) => d.code === "N002");
      assert.match(unresolved.message, /syntax error/);
      assert.doesNotMatch(unresolved.message, /did you mean f/);
      assert.ok(unresolved.related.length);
    },
  );
});

test("ordinary repeated work is information; a stable hoisting opportunity remains a warning", async () => {
  for (const [stable, severity] of [
    ["", "info"],
    ["stable", "warning"],
  ])
    await fixture(
      `op read() -> Unit effects(remote.Store) ${stable}; flow f(N: Nat) -> Unit effects(remote.Store) bound N <= 3 { for i in N { call read(); } }`,
      (report) => {
        assert.equal(
          report.diagnostics.find((d) => d.code === "W001").severity,
          severity,
        );
        assert.ok(
          report.results.some((r) => r.analysisKind === "repeated-work"),
        );
      },
    );
});

test("cancellation cleanup explains an already-closed path without assuming a real close is repeatable", () =>
  fixture(
    "resource File { states Open, Closed; initial Open; terminal Closed; Open -> Closed; } flow process(take file: File) -> Unit effects(state.File) { transition file -> Closed; return unit; } on cancel { transition file -> Closed; }",
    (report) => {
      const diagnostic = report.diagnostics.find((d) => d.code === "R002");
      assert.match(diagnostic.message, /during cancellation cleanup/);
      const explanation = findingPresenter(report)(diagnostic);
      assert.match(explanation.why, /already completed cleanup/);
      assert.match(explanation.nextStep, /Closed -> Closed/);
      assert.match(explanation.nextStep, /If cleanup can safely do nothing/);
      assert.ok(explanation.relatedLocations.length);
    },
  ));
