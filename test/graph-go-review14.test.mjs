// Regressions for the fourteenth W2-B review: a failure caused by a failed file
// propagates to every link that depends on it; one lookup path for every scope;
// over-inclusion where the module answers "could this type have this method?"
// (build variants, pointer aliases, interface merging). Expected answers for
// valid Go were checked with `go build` (Go 1.27.4).
import assert from "node:assert/strict";
import { test } from "node:test";
import { call, project } from "./fixtures/graph-go/harness.mjs";

const MOD = "module example.com/m\n\ngo 1.22\n";
const lines = (...items) => [...items, ""].join("\n");
const failedWith = (link, files, label) => {
  assert.equal(link.target, null, label);
  assert.deepEqual(link.candidates, [], label);
  assert.equal(link.data.reason, "invalid-code", label);
  assert.deepEqual(link.data.cause, { files }, label);
};

test("safety: B1 a value whose type is in a failed file fails, never a name-only set", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/bad.go": lines("package p", "type T struct{}", "func (*T) M() { (( }"),
    "p/ok.go": lines("package p", "func New() *T { return nil }"),
    "r/r.go": lines(
      "package r",
      "type A struct{}",
      "func (A) M() {}",
      "type B struct{}",
      "func (B) M() {}",
    ),
    "q/q.go": lines(
      "package q",
      'import "example.com/m/p"',
      "func U() { x := p.New(); x.M(); var y p.T; y.M(); z := []*p.T{}; z[0].M() }",
    ),
  });
  for (const at of ["x.M", "y.M", "z[0].M", "p.T"])
    failedWith(
      links.find((link) => link.file === "q/q.go" && link.at === at),
      ["p/bad.go"],
      at,
    );
  // The function itself is valid: still definite.
  assert.equal(call(links, "q/q.go", "p.New").target, "p/ok.go:function:New");
});

test("B3 every lookup route carries the failed files as the cause", async () => {
  // (a) a dot import.
  let { links } = await project({
    "go.mod": MOD,
    "p/bad.go": lines("package p", "func G() { (( }"),
    "p/ok.go": lines("package p", "func H() {}"),
    "q/q.go": lines(
      "package q",
      'import . "example.com/m/p"',
      "func U() { G(); H() }",
    ),
  });
  failedWith(call(links, "q/q.go", "G"), ["p/bad.go"], "dot import");
  assert.equal(call(links, "q/q.go", "H").target, "p/ok.go:function:H");
  // (b) the export_test.go pattern: an external test package sees p's test files.
  ({ links } = await project({
    "go.mod": MOD,
    "p/p.go": lines("package p", "type Z struct{}"),
    "p/bad_test.go": lines("package p", "func G() { (( }"),
    "p/ext_test.go": lines(
      "package p_test",
      'import "example.com/m/p"',
      "func U(t p.Z) { p.G() }",
    ),
  }));
  failedWith(
    call(links, "p/ext_test.go", "p.G"),
    ["p/bad_test.go"],
    "external test package",
  );
  // (c) promotion through a failed package's type.
  ({ links } = await project({
    "go.mod": MOD,
    "p/bad.go": lines("package p", "type T struct{}", "func (T) M() { (( }"),
    "p/ok.go": lines("package p", "func Ok() {}"),
    "r/r.go": lines("package r", "type U struct{}", "func (U) N() {}"),
    "q/q.go": lines(
      "package q",
      'import "example.com/m/p"',
      'import "example.com/m/r"',
      "type W struct{ p.T; r.U }",
      "func F(w W) { w.M() }",
    ),
  }));
  failedWith(call(links, "q/q.go", "w.M"), ["p/bad.go"], "promotion");
  // (d) a non-test file's builtin when a same-package _test.go file failed: in
  // the test build that file could declare `len` for the whole package.
  ({ links } = await project({
    "go.mod": MOD,
    "p/p.go": lines("package p", 'func F() int { return len("x") }'),
    "p/bad_test.go": lines("package p", "func T() { (( }"),
  }));
  failedWith(call(links, "p/p.go", "len"), ["p/bad_test.go"], "universe name");
  // Control: a failed external-test-package file is not in p's scope.
  ({ links } = await project({
    "go.mod": MOD,
    "p/p.go": lines("package p", "func G() {}"),
    "q/q.go": lines(
      "package q",
      'import "example.com/m/p"',
      "func U() { p.Missing() }",
    ),
  }));
  assert.equal(call(links, "q/q.go", "p.Missing").data.reason, undefined);
});

test("B2 one build variant failing the count test does not refute the type", async () => {
  // GOOS=linux go build accepts `var _ I = T{}`.
  const { links } = await project({
    "go.mod": MOD,
    "p/i.go": lines(
      "package p",
      "type I interface{ M(int) }",
      "type T struct{}",
      "type U struct{}",
      "func (U) M(int) {}",
      "func Use(i I) { i.M(1) }",
    ),
    "p/t_linux.go": lines("package p", "func (T) M(a int) {}"),
    "p/t_windows.go": lines("package p", "func (T) M(a, b int) {}"),
  });
  const dispatch = call(links, "p/i.go", "i.M");
  assert.ok(
    dispatch.candidates.includes("p/t_linux.go:method:(T).M"),
    dispatch.candidates.join(),
  );
  assert.ok(
    links.some(
      (link) => link.kind === "implements" && link.at.startsWith("T "),
    ),
  );
});

test("S1 pointer aliases keep pointer method sets through chains and embedding", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type I interface{ M() }",
      "type T struct{}",
      "func (*T) M() {}",
      "type A = *T",
      "type B = A",
      "type S struct{ B }",
      "var _ I = S{}",
      "func Use(a A, b B, s S, i I) { a.M(); b.M(); s.M(); i.M() }",
    ),
  });
  for (const at of ["a.M", "b.M", "s.M"])
    assert.equal(call(links, "p/p.go", at).target, "p/p.go:method:(*T).M", at);
  const s = links.find(
    (link) => link.kind === "implements" && link.at.startsWith("S "),
  );
  assert.ok(s, "S implements I");
  assert.equal(s.target, null);
  assert.equal(s.data.pointerReceiver, false);
});

test("S1 a matrix of aliases, embeddings and receivers matches go build", async () => {
  // `value`/`pointer`: does `var _ I = E{}` / `var _ I = &E{}` compile (go build).
  const ORACLE = [
    ["type X = T", "X", "value", true, true],
    ["type X = T", "X", "pointer", false, true],
    ["type X = T", "*X", "value", true, true],
    ["type X = T", "*X", "pointer", true, true],
    ["type X = *T", "X", "value", true, true],
    ["type X = *T", "X", "pointer", true, true],
    ["type A = T\ntype X = A", "X", "value", true, true],
    ["type A = T\ntype X = A", "X", "pointer", false, true],
    ["type A = T\ntype X = A", "*X", "value", true, true],
    ["type A = T\ntype X = A", "*X", "pointer", true, true],
    ["type A = *T\ntype X = A", "X", "value", true, true],
    ["type A = *T\ntype X = A", "X", "pointer", true, true],
  ];
  for (const [alias, embedded, receiver, value, pointer] of ORACLE) {
    const label = `${alias.replace("\n", "; ")}; E{ ${embedded} }; ${receiver} receiver`;
    const { links } = await project({
      "go.mod": MOD,
      "p/p.go": lines(
        "package p",
        "type I interface{ M() }",
        "type T struct{}",
        receiver === "value" ? "func (T) M() {}" : "func (*T) M() {}",
        alias,
        `type E struct{ ${embedded} }`,
      ),
    });
    const link = links.find(
      (item) => item.kind === "implements" && item.at.startsWith("E "),
    );
    assert.equal(!!link, value || pointer, label);
    if (link) {
      assert.equal(link.target, null, label);
      assert.equal(!!link.data.pointerReceiver, !value, label);
    }
  }
});

test("S2 interface methods inherited along several paths merge by name, without identity", async () => {
  // go build accepts `var _ J = T{}`; [N]int with N = 2 is [2]int.
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "const N = 2",
      "type I interface{ M([N]int) }",
      "type J interface{ I; M([2]int) }",
      "type T struct{}",
      "func (T) M([2]int) {}",
      "var _ J = T{}",
      "func Use(j J) { j.M([2]int{}) }",
    ),
  });
  const targets = links
    .filter((link) => link.kind === "implements" && link.at.startsWith("T "))
    .map((link) => link.targetName)
    .sort();
  assert.deepEqual(targets, ["I", "J"]);
  assert.ok(
    call(links, "p/p.go", "j.M").candidates.includes("p/p.go:method:(T).M"),
  );
});
