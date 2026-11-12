// A file that cannot be read is not valid code: it has failed, and nothing in it
// is a target (W2-B.md, "Failed files"). Links that need code in a failed file
// fail too (`invalid-code`), naming the failed files as the cause. The failed
// file's package may hold unseen declarations (layer 1).
import assert from "node:assert/strict";
import { test } from "node:test";
import go from "../dist/graph/languages/go/index.js";
import { call, project } from "./fixtures/graph-go/harness.mjs";

const MOD = "module example.com/m\n\ngo 1.22\n";
const lines = (...items) => [...items, ""].join("\n");
const UNSEEN = "declarations-may-be-unseen";
const reasonsOf = (open) => open?.reasons ?? (open ? [open.reason] : []);

test("safety: a syntax error inside one function body fails the whole file", async () => {
  const text = lines(
    "package p",
    "func Good() {}",
    "func Bad() {",
    "\tx := f(1, false))",
    "}",
  );
  const parsed = await go.parse({ path: "p/bad.go", text });
  assert.equal(parsed.status, "failed");
  assert.deepEqual(parsed.symbols, []);
  assert.deepEqual(parsed.links, []);
  const { symbols, report } = await project({
    "go.mod": MOD,
    "p/bad.go": text,
  });
  assert.deepEqual(report.failed, ["p/bad.go"]);
  assert.deepEqual(symbols, []);
});

test("a failed file says where and why, like a compiler's first error (checked against gofmt -e)", async () => {
  // Each expected line is gofmt -e's (Go 1.27.4). Columns count UTF-16 units;
  // gofmt counts bytes, and the reported token can differ.
  for (const [text, message, gofmt] of [
    // An ERROR node may enclose valid statements before the fault.
    [
      lines(
        "package p",
        "",
        "func F() {",
        "\ta := 1",
        "\tb := 2",
        "\ta++ ++",
        "\t_ = b",
        "}",
      ),
      "line 6, column 6: unexpected `+`",
      "6:6: expected ';', found '++'",
    ],
    [
      lines("package p", "", "func F() {", "\tx := f(1, false))", "}"),
      "line 4, column 18: unexpected `)`",
      "4:18: expected statement, found ')'",
    ],
    [
      lines("package p", "", "func Good() {}", "", "func Bad( {", "}"),
      "line 5, column 11: missing `)`",
      "5:11: expected ')', found '{'",
    ],
    [
      lines(
        "package p",
        "",
        "func F() {",
        "\tif true {",
        "\t\tprintln(1)",
        "\t}",
        "\tvar x = [",
        "\t_ = x",
        "}",
      ),
      "line 8, column 4: unexpected `=`",
      "8:4: expected '==', found '='",
    ],
    [
      lines("package p", "", "type T struct {", "\tA int", "\tB map[", "}"),
      "line 6, column 1: unexpected `}`",
      "6:1: expected ']', found '}'",
    ],
    [
      lines("package p", "", "func F() {", "\tx := 1 +", "}"),
      "line 5, column 1: unexpected `}`",
      "5:1: expected operand, found '}'",
    ],
    // Same line as gofmt, a later column.
    [
      lines(
        "package p",
        "",
        "func F() {",
        "\tfor i := 0; i < 3 i++ {",
        "\t}",
        "}",
      ),
      "line 4, column 24: unexpected `{`",
      "4:20: expected ';', found i",
    ],
    [
      lines("package p", "", "var x = struct{ a int }{a: 1,, }"),
      "line 3, column 30: unexpected `,`",
      "3:30: expected operand, found ','",
    ],
    // Top-level text the grammar accepts but Go does not, and package clauses.
    [lines("packge p", "func F() {}"), "line 1, column 1: unexpected `packge`"],
    [
      lines("// a comment", "func F() {}"),
      "line 1, column 1: no package clause",
    ],
    [
      lines("package p", "package q"),
      "line 2, column 1: second package clause",
    ],
  ]) {
    const parsed = await go.parse({ path: "p/x.go", text });
    assert.equal(parsed.status, "failed", text);
    assert.deepEqual(
      parsed.diagnostics.map((item) => item.message),
      [message],
      gofmt ?? text,
    );
    if (gofmt)
      assert.equal(
        message.split(",")[0],
        `line ${gofmt.split(":")[0]}`,
        "gofmt's line",
      );
  }
  // A MISSING node, reported at the next real token.
  const missing = await go.parse({
    path: "p/x.go",
    text: lines("package p", "func F() { g(1 }"),
  });
  assert.match(
    missing.diagnostics[0].message,
    /^line 2, column \d+: missing `\)`$/,
  );
});

const PACKAGE = (bad) => ({
  "go.mod": MOD,
  "p/bad.go": bad,
  "p/ok.go": lines("package p", "func Other() {}"),
  "p/use.go": lines(
    "package p",
    "type i interface{ M(); h() }",
    "type a struct{}",
    "func (a) M() {}",
    "func (a) h() {}",
    "func Use(x i) { Gone(); Other(); x.M() }",
  ),
});
const BROKEN = lines("package p", "func Gone() {", "\tif true {");

test("safety: a call into a failed file fails with the file as its cause; a valid one resolves", async () => {
  const [before, fixed] = await project(PACKAGE(BROKEN), [
    { "p/bad.go": lines("package p", "func Gone() {}") },
  ]);
  const gone = call(before.links, "p/use.go", "Gone");
  assert.equal(gone.target, null);
  assert.deepEqual(gone.candidates, []);
  assert.equal(gone.data.reason, "invalid-code");
  assert.deepEqual(gone.data.cause, { files: ["p/bad.go"] });
  assert.equal(
    call(before.links, "p/use.go", "Other").target,
    "p/ok.go:function:Other",
  );
  // The package may hold unseen declarations: dispatch there is open with it.
  assert.ok(
    reasonsOf(call(before.links, "p/use.go", "x.M").data.open).includes(UNSEEN),
  );
  // Fixing the file clears the failure and the cause.
  const now = call(fixed.links, "p/use.go", "Gone");
  assert.equal(now.target, "p/bad.go:function:Gone");
  assert.equal(now.data.reason, undefined);
  assert.equal(now.data.cause, undefined);
  assert.deepEqual(fixed.report.failed, []);
});

test("a name missing from a package with no failed files is plainly unresolved", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/use.go": lines("package p", "func Use() { Gone() }"),
  });
  const link = call(links, "p/use.go", "Gone");
  assert.equal(link.target, null);
  assert.equal(link.data.reason, undefined);
  assert.equal(link.data.cause, undefined);
});

test("an import of a package whose every file failed is itself failed; names through it too", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "q/a.go": lines("package q", "func F() {"),
    "q/b.go": lines("package q", "func G() { ) }"),
    "p/p.go": lines(
      "package p",
      'import "example.com/m/q"',
      "func Use() { q.F() }",
    ),
  });
  const cause = { files: ["q/a.go", "q/b.go"] };
  const imports = links.find(
    (link) => link.kind === "imports" && link.file === "p/p.go",
  );
  assert.equal(imports.target, null);
  assert.equal(imports.data.reason, "invalid-code");
  assert.deepEqual(imports.data.cause, cause);
  const use = call(links, "p/p.go", "q.F");
  assert.equal(use.data.reason, "invalid-code");
  assert.deepEqual(use.data.cause, cause);
});

test("a qualified name missing from a package with failed files names them; test files only for tests", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "q/ok.go": lines("package q", "func Ok() {}"),
    "q/bad.go": lines("package q", "func F() {"),
    "q/bad_test.go": lines("package q", "func T() {"),
    "p/p.go": lines(
      "package p",
      'import "example.com/m/q"',
      "func Use() { q.Ok(); q.F(); q.Nowhere() }",
    ),
  });
  assert.equal(call(links, "p/p.go", "q.Ok").target, "q/ok.go:function:Ok");
  for (const at of ["q.F", "q.Nowhere"]) {
    const link = call(links, "p/p.go", at);
    assert.equal(link.target, null, at);
    assert.equal(link.data.reason, "invalid-code", at);
    // Any failed non-test file might have declared it; a _test.go file cannot.
    assert.deepEqual(link.data.cause, { files: ["q/bad.go"] }, at);
  }
});

test("a method whose receiver type is in a failed file, and members of types there, fail", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/t.go": lines("package p", "type T struct{", "\tx int"),
    "p/m.go": lines("package p", "func (T) M() {}"),
    "p/u.go": lines(
      "package p",
      "type U struct{ v int }",
      "func (U) N() {}",
      "func Use(u U) { u.N(); u.Gone() }",
    ),
  });
  const receiver = links.find(
    (link) => link.kind === "receiver" && link.file === "p/m.go",
  );
  assert.equal(receiver.target, null);
  assert.equal(receiver.data.reason, "invalid-code");
  assert.deepEqual(receiver.data.cause, { files: ["p/t.go"] });
  // A member declared on the type itself (depth 0) stays definite.
  assert.equal(call(links, "p/u.go", "u.N").target, "p/u.go:method:(U).N");
  // Anything else on a type of that package may be in the failed file.
  const gone = call(links, "p/u.go", "u.Gone");
  assert.equal(gone.data.reason, "invalid-code");
  assert.deepEqual(gone.data.cause, { files: ["p/t.go"] });
});

test("safety: layer 1 with a failed file: intact names and depth-0 members definite, the rest uncertain", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type T struct{ f int; e }",
      "type e struct{}",
      "func (e) P() {}",
      "func (T) M() {}",
      "func F() {}",
      'func U(t T) int { F(); t.M(); t.P(); _ = len("x"); return t.f }',
    ),
    "p/broken.go": BROKEN,
    "q/internal/r/r.go": lines(
      "package r",
      "type i interface{ M(); h() }",
      "type a struct{}",
      "func (a) M() {}",
      "func (a) h() {}",
      "func Use(x i) { x.M() }",
    ),
  });
  assert.equal(call(links, "p/p.go", "F").target, "p/p.go:function:F");
  assert.equal(call(links, "p/p.go", "t.M").target, "p/p.go:method:(T).M");
  assert.equal(
    links.find((link) => link.at === "t.f").target,
    "p/p.go:field:T.f",
  );
  // Promoted: an unseen depth-0 method on T could shadow it.
  assert.equal(call(links, "p/p.go", "t.P").target, null);
  // An unseen declaration may shadow the builtin.
  assert.equal(call(links, "p/p.go", "len").data.builtin, undefined);
  // A package p may not import (another tree's internal/) is unaffected.
  assert.ok(
    !reasonsOf(call(links, "q/internal/r/r.go", "x.M").data.open).includes(
      UNSEEN,
    ),
  );
});

test("safety: an unseen type of a failed file's package may implement any interface it reaches", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "internal/x/x.go": lines(
      "package x",
      "type I interface{ M(); h() }",
      "type Carrier struct{}",
      "func (Carrier) M() {}",
      "func (Carrier) h() {}",
      "func Use(v I) { v.M() }",
    ),
    "b/w.go": lines("package w", "func B() {", "if true {"),
    "b/ok.go": lines("package w", "func Ok() {}"),
  });
  assert.ok(
    reasonsOf(call(links, "internal/x/x.go", "v.M").data.open).includes(UNSEEN),
  );
});

test("safety: build variants of a package with a failed file are an open set", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/a_linux.go": lines("package p", "func setFlags() {}"),
    "p/a_other.go": lines(
      "//go:build !linux",
      "",
      "package p",
      "func setFlags() {}",
    ),
    "p/use.go": lines("package p", "func U() { setFlags() }"),
    "p/broken_windows.go": lines("package p", "func W() {"),
  });
  const link = call(links, "p/use.go", "setFlags");
  assert.equal(link.candidates.length, 2);
  assert.deepEqual(link.data.open, { reason: UNSEEN });
});

test("safety: a failed _test.go file makes the external test package uncertain too", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines("package p", "func F() {}"),
    "p/x_test.go": lines(
      "package p_test",
      "type i interface{ M(); h() }",
      "type a struct{}",
      "func (a) M() {}",
      "func (a) h() {}",
      "func Use(x i) { x.M() }",
    ),
    "p/broken_test.go": lines("packge p_test", "type b struct{}"),
  });
  assert.ok(
    reasonsOf(call(links, "p/x_test.go", "x.M").data.open).includes(UNSEEN),
  );
});

test("safety: an unknown structure reaches a hidden method only through a chain of imports", async () => {
  const files = (w) => ({
    "go.mod": MOD,
    "internal/x/x.go": lines(
      "package x",
      "type I interface{ M(); h() }",
      "type Carrier struct{}",
      "func (Carrier) M() {}",
      "func (Carrier) h() {}",
      "func Use(v I) { v.M() }",
    ),
    "internal/y/y.go": lines(
      "package y",
      'import "example.com/m/internal/x"',
      "type Mid struct{ x.Carrier }",
    ),
    "w/w.go": w,
  });
  // No failed file. W's structure is unknown to the model (a defined pointer
  // type); w imports only y, which imports x.
  let { links } = await project(
    files(
      lines(
        "package w",
        'import "example.com/m/internal/y"',
        "var _ y.Mid",
        "type W *int",
      ),
    ),
  );
  assert.equal(
    call(links, "internal/x/x.go", "v.M").data.open.reason,
    "external-implementers-possible",
  );
  // Control: without the import, w cannot reach x: open only as unverified.
  ({ links } = await project(files(lines("package w", "type W *int"))));
  assert.deepEqual(call(links, "internal/x/x.go", "v.M").data.open, {
    reason: "structural-match-unverified",
  });
});

test("safety: in a package with a failed file, a signature naming a predeclared type is not proven identical", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type J interface{ M() error }",
      "type T struct{}",
      "func (T) M() error { return nil }",
    ),
    "p/broken.go": BROKEN,
  });
  // An unseen `type error …` in p would change both signatures' meaning.
  const link = links.find((item) => item.kind === "implements");
  assert.equal(link.target, null);
  assert.equal(link.data.identity, "unknown");
});
