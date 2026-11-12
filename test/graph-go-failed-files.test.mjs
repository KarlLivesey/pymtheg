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

test("a failed file says which lines bracket the error, and gofmt's line is inside", async () => {
  // Each case: the file, the line of the first error `gofmt -e <file>` reports
  // (recorded here; the test does not run gofmt), and the expected message.
  // The range brackets the error; the exact position needs the Go toolchain.
  const CASES = [
    // c1: gofmt -e (Go 1.27.4) reports 6:6: expected ';', found '++'
    [
      "package p\n\nfunc F() {\n\ta := 1\n\tb := 2\n\ta++ ++\n\t_ = b\n}\n",
      6,
      "syntax error in lines 3\u20136: unexpected `+`",
    ],
    // c2: gofmt -e (Go 1.27.4) reports 4:18: expected statement, found ')'
    [
      "package p\n\nfunc F() {\n\tx := f(1, false))\n}\n",
      4,
      "syntax error in lines 4\u20135: unexpected `)`",
    ],
    // c3: gofmt -e (Go 1.27.4) reports 5:11: expected ')', found '{'
    [
      "package p\n\nfunc Good() {}\n\nfunc Bad( {\n}\n",
      5,
      "syntax error in line 5: missing `)`",
    ],
    // c4: gofmt -e (Go 1.27.4) reports 8:4: expected '==', found '='
    [
      "package p\n\nfunc F() {\n\tif true {\n\t\tprintln(1)\n\t}\n\tvar x = [\n\t_ = x\n}\n",
      8,
      "syntax error in lines 7\u20138: unexpected `=`",
    ],
    // c5: gofmt -e (Go 1.27.4) reports 6:1: expected ']', found '}'
    [
      "package p\n\ntype T struct {\n\tA int\n\tB map[\n}\n",
      6,
      "syntax error in lines 5\u20136: unexpected `}`",
    ],
    // c6: gofmt -e (Go 1.27.4) reports 5:1: expected operand, found '}'
    [
      "package p\n\nfunc F() {\n\tx := 1 +\n}\n",
      5,
      "syntax error in lines 4\u20135: unexpected `}`",
    ],
    // c7: gofmt -e (Go 1.27.4) reports 4:20: expected ';', found i
    [
      "package p\n\nfunc F() {\n\tfor i := 0; i < 3 i++ {\n\t}\n}\n",
      4,
      "syntax error in line 4: unexpected `{`",
    ],
    // c8: gofmt -e (Go 1.27.4) reports 3:30: expected operand, found ','
    [
      "package p\n\nvar x = struct{ a int }{a: 1,, }\n",
      3,
      "syntax error in line 3: unexpected `,`",
    ],
    // m1: gofmt -e (Go 1.27.4) reports 4:9: missing ',' before newline in composite literal
    [
      'package p\nfunc F() {\n\tx := map[string]int{\n\t\t"a": 1\n\t\t"b": 2,\n\t}\n\t_ = x\n}\n',
      4,
      'syntax error in lines 4\u20135: unexpected `"`',
    ],
    // m10: gofmt -e (Go 1.27.4) reports 3:15: expected ')', found '{'
    [
      "package p\ntype T struct{ a int }\nfunc (t T) M( { return }\n",
      3,
      "syntax error in line 3: unexpected `{`",
    ],
    // m11: gofmt -e (Go 1.27.4) reports 7:1: expected operand, found '}'
    [
      "package p\n\nfunc F() {\n\tdefer func() {\n\t\trecover()\n\t}(\n}\n",
      7,
      "syntax error in lines 6\u20137: unexpected `}`",
    ],
    // m12: gofmt -e (Go 1.27.4) reports 6:1: expected operand, found ')'
    [
      "package p\n\nvar (\n\ta = 1\n\tb = \n)\n",
      6,
      "syntax error in lines 4\u20136: unexpected `)`",
    ],
    // m2: gofmt -e (Go 1.27.4) reports 5:3: expected ';', found 'EOF'
    [
      "package p\nfunc F() {\n\tfor {\n\t\tbreak\n}\n",
      5,
      "syntax error in lines 5\u20136: missing `}`",
    ],
    // m4: gofmt -e (Go 1.27.4) reports 6:1: missing import path
    [
      'package p\nimport (\n\t"fmt"\n\t"os"\n\nfunc F() { fmt.Println(os.Args) }\n',
      6,
      "syntax error in lines 4\u20136: unexpected `)`",
    ],
    // m5: gofmt -e (Go 1.27.4) reports 4:4: expected type, found ')'
    [
      "package p\ntype I interface {\n\tM(\n\tN()\n}\n",
      4,
      "syntax error in line 4: unexpected `)`",
    ],
    // m7: gofmt -e (Go 1.27.4) reports 2:23: missing ',' before newline in composite literal
    [
      "package p\nvar x = [3]int{1, 2, 3\n\nfunc F() {}\n",
      2,
      "syntax error in lines 2\u20134: unexpected `(`",
    ],
    // m8: gofmt -e (Go 1.27.4) reports 4:6: expected operand, found '='
    [
      "package p\nfunc F() {\n\tx := 1\n\tx = = 2\n\t_ = x\n}\n",
      4,
      "syntax error in line 4: unexpected `2`",
    ],
    // m9: gofmt -e (Go 1.27.4) reports 3:9: string literal not terminated
    [
      'package p\nfunc F() string {\n\treturn "abc\n}\n',
      3,
      "syntax error in lines 3\u20134: string not terminated",
    ],
    // ra: gofmt -e (Go 1.27.4) reports 5:2: expected statement, found 'ILLEGAL'
    [
      "package p\nfunc F(){\n x := []int{1,\n }\n @\n}\n",
      5,
      "syntax error in lines 4\u20136: unexpected `}`",
    ],
    // rb: gofmt -e (Go 1.27.4) reports 3:15: expected type, found newline
    [
      "package p\ntype T struct {\n x map[string]\n}\n",
      3,
      "syntax error in lines 3\u20134: missing `type_identifier`",
    ],
    // rc: gofmt -e (Go 1.27.4) reports 4:13: expected '{', found newline
    [
      "package p\nfunc F(x bool) {\n\tif x\n\t\tprintln(1)\n\t}\n}\n",
      4,
      "syntax error in lines 2\u20136: unexpected `}`",
    ],
    // rd: gofmt -e (Go 1.27.4) reports 4:8: expected ':', found newline
    [
      "package p\nfunc F(x int) {\n\tswitch x {\n\tcase 1\n\t\tprintln(1)\n\t}\n}\n",
      4,
      "syntax error in lines 4\u20135: unexpected `println`",
    ],
    // B2 (round 15 review): an unterminated string starts the range at its quote.
    // b2a: gofmt -e (Go 1.27.4) reports 5:2: string literal not terminated
    [
      'package p\n\nimport (\n\t"fmt"\n\t"os\n)\n\nfunc F() { fmt.Println(os.Args) }\n',
      5,
      "syntax error in lines 5\u20136: string not terminated",
    ],
    // b2b: gofmt -e (Go 1.27.4) reports 5:9: missing ',' before newline in composite literal
    [
      'package p\n\nfunc F() {\n\tx := map[string]int{\n\t\t"a": 1\n\t\t"b": 2,\n\t}\n\t_ = x\n}\n',
      5,
      'syntax error in lines 5\u20136: unexpected `"`',
    ],
    // b2c: gofmt -e (Go 1.27.4) reports 4:15: expected ')', found newline
    [
      "package p\n\nfunc F() int {\n\treturn (1 + 2\n}\n",
      4,
      "syntax error in lines 4\u20135: missing `)`",
    ],
    // b2d: gofmt -e (Go 1.27.4) reports 7:4: expected ';', found 'EOF'
    [
      "package p\n\nfunc F() {\n\tif true {\n\t\tprintln(1)\n\t}\n\t{\n",
      7,
      "syntax error in lines 3\u20138: unexpected end of file",
    ],
    // e1: gofmt -e (Go 1.27.4) reports 5:2: string literal not terminated
    [
      'package p\n\nimport (\n\t"fmt"\n\t"os\n\t"strings"\n)\n\nfunc F() { fmt.Println(os.Args, strings.ToUpper("")) }\n',
      5,
      'syntax error in lines 4\u20136: unexpected `"`',
    ],
    // e7: gofmt -e (Go 1.27.4) reports 3:9: string literal not terminated
    [
      'package p\n\nvar s = "abc\nvar t = 1\n',
      3,
      "syntax error in lines 3\u20134: string not terminated",
    ],
    // e8: gofmt -e (Go 1.27.4) reports 4:7: raw string literal not terminated
    [
      "package p\n\nfunc F() {\n\tx := `abc\n}\n",
      4,
      "syntax error in lines 3\u20136: unexpected end of file",
    ],
    // Round 16: an unterminated literal after an earlier error never narrows the range.
    // z1 (Opus round 16): gofmt -e (Go 1.27.4) reports 4:17: missing ',' before newline in composite literal
    [
      'package p\n\nfunc f() {\n\ta := []int{1, 2\n\tb := "x\n}\n',
      4,
      "syntax error in lines 4\u20135: unexpected `x`",
    ],
    // z2 (Opus round 16): gofmt -e (Go 1.27.4) reports 3:30: missing ',' before newline in composite literal
    [
      'package p\n\nvar m = map[string]int{"a": 1\nvar s = "abc\n',
      3,
      "syntax error in lines 1\u20135: unexpected end of file",
    ],
    // z3 (Opus round 16): gofmt -e (Go 1.27.4) reports 5:4: expected '==', found '='
    [
      "package p\n\nfunc f() {\n\tx := ((\n\t_ = x\n\ty := `abc\n}\n",
      5,
      "syntax error in lines 3\u20138: unexpected end of file",
    ],
    // z4 (Sol round 16): gofmt -e (Go 1.27.4) reports 3:7: expected operand, found ')'
    [
      'package p\nfunc F(){\n x := )\n y := "abc\n}\n',
      3,
      'syntax error in lines 3\u20134: unexpected `"`',
    ],
    // z5 (Sol round 16): gofmt -e (Go 1.27.4) reports 3:7: expected operand, found ')'
    [
      "package p\nfunc F(){\n x := )\n y := 'a\n}\n",
      3,
      "syntax error in lines 3\u20134: unexpected `)`",
    ],
    // z6 (Sol round 16): gofmt -e (Go 1.27.4) reports 3:7: expected operand, found ')'
    [
      "package p\nfunc F(){\n x := )\n y := `abc\n}\n",
      3,
      "syntax error in lines 2\u20136: unexpected end of file",
    ],
    // z7 (Sol round 16): gofmt -e (Go 1.27.4) reports 2:9: expected operand, found ')'
    [
      'package p\nvar x = )\nvar y = "abc\n',
      2,
      "syntax error in lines 1\u20134: unexpected end of file",
    ],
  ];
  assert.equal(CASES.length, 36);
  for (const [text, gofmtLine, message] of CASES) {
    const parsed = await go.parse({ path: "p/x.go", text });
    assert.equal(parsed.status, "failed", text);
    assert.deepEqual(
      parsed.diagnostics.map((item) => item.message),
      [message],
      text,
    );
    const [, first, last = first] = /lines? (\d+)(?:–(\d+))?/.exec(message);
    assert.ok(
      Number(first) <= gofmtLine && gofmtLine <= Number(last),
      `${message} does not contain gofmt's line ${gofmtLine}`,
    );
  }
  // Package-clause failures keep their exact position.
  for (const [text, message] of [
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
    assert.deepEqual(
      parsed.diagnostics.map((item) => item.message),
      [message],
    );
  }
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
