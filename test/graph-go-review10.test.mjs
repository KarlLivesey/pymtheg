// Regressions for the tenth W2-B review: soundness rests on layer 1 (a package
// with a declaration-lossy file may hold unseen declarations), never on the
// lexical recovery (layer 2). Every reproduction runs with recovery on and off;
// the safety assertions ("safety:" tests) must hold in both modes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { recoveryOptions } from "../dist/graph/languages/go/recover.js";
import { call, project } from "./fixtures/graph-go/harness.mjs";

const MOD = "module example.com/m\n\ngo 1.22\n";
const lines = (...items) => [...items, ""].join("\n");
const OPEN = { reason: "external-implementers-possible" };

/** Runs `check(on)` with recovery on, then off; restores it either way. */
async function both(check) {
  for (const on of [true, false]) {
    recoveryOptions.enabled = on;
    try {
      await check(on);
    } finally {
      recoveryOptions.enabled = true;
    }
  }
}
const recovered = (symbols, name) =>
  symbols.filter((symbol) => symbol.name === name && symbol.data?.recovered);

test("safety: 1a a declaration inside a raw string never becomes a target", async () => {
  await both(async (on) => {
    const { links, symbols } = await project({
      "go.mod": MOD,
      "q/q.go": lines("package q", 'func Render() string { return "" }'),
      "p/p_test.go": lines(
        "package p",
        "import (",
        '\t"testing"',
        '\t. "example.com/m/q"',
        ")",
        "func TestUse(t *testing.T) { _ = Render() }",
      ),
      "p/gen_test.go": lines(
        "package p",
        'import "testing"',
        "func TestGen(t *testing.T) {",
        "\twant := `package out",
        "",
        'func Render() string { return "x" }',
        "`",
        '\tif want == "" {',
        "\t\tt.Fatal()",
      ),
    });
    const link = call(links, "p/p_test.go", "Render");
    // The package is lossy: a name from a dot-import is uncertain.
    assert.equal(link.target, null, `recovery ${on}`);
    assert.deepEqual(link.candidates, []);
    assert.deepEqual(recovered(symbols, "Render"), []);
  });
});

test("safety: 1b-1d phantoms from string literals and comments", async () => {
  await both(async (on) => {
    const { links, symbols } = await project({
      "go.mod": MOD,
      "q/q.go": lines("package q", "func Foo() {}"),
      "p/b.go": lines(
        "package p",
        'x := "func Foo() {}"',
        'y := "func len(s string) int { return 0 }"',
      ),
      "p/broken.go": lines(
        "package p",
        "type B struct {",
        "// func Ghost() {}",
        "f map[",
      ),
      "p/c.go": lines(
        "package p",
        'import . "example.com/m/q"',
        'func U() int { Foo(); Ghost(); return len("x") }',
      ),
    });
    for (const at of ["Foo", "Ghost", "len"]) {
      const link = call(links, "p/c.go", at);
      assert.equal(link.target, null, `${at}, recovery ${on}`);
      assert.deepEqual(link.candidates, [], at);
      assert.equal(recovered(symbols, at).length, 0, at);
    }
    // An unseen declaration may shadow the builtin: the flag is not asserted.
    assert.equal(call(links, "p/c.go", "len").data.builtin, undefined);
  });
});

test("safety: 1e a phantom never takes an intact declaration's ID", async () => {
  await both(async (on) => {
    const ids = [];
    for (const head of [[], ['x := "type Foo struct{}"']]) {
      const { symbols } = await project({
        "go.mod": MOD,
        "p/p.go": lines(
          "package p",
          ...head,
          "type c struct{}",
          "type Foo struct{ c }",
        ),
      });
      const foo = symbols.filter(
        (symbol) => symbol.file === "p/p.go" && symbol.identity === "Foo",
      );
      assert.equal(foo.length, 1, `recovery ${on}`);
      assert.equal(foo[0].data?.recovered, undefined);
      ids.push(foo[0].id);
    }
    assert.equal(ids[0], ids[1]);
  });
});

test("safety: 2 an indented header swallowed by an unclosed body", async () => {
  await both(async (on) => {
    let { links, symbols } = await project({
      "go.mod": MOD,
      "p/clean.go": lines(
        "package p",
        "type a struct{}",
        "func (a) h() {}",
        "func U(v b) { v.h() }",
      ),
      "p/broken.go": lines(
        "package p",
        "type b struct{ a }",
        "func (b) X() {",
        "if true {",
        "println(1)",
        "}",
        "  func (b) h() {}",
      ),
    });
    assert.equal(call(links, "p/clean.go", "v.h").target, null, `${on}`);
    if (on) assert.equal(recovered(symbols, "h").length, 1);
    ({ links } = await project({
      "go.mod": MOD,
      "p/clean.go": lines(
        "package p",
        "type i interface{ M(); h() }",
        "type a struct{}",
        "func (a) M() {}",
        "func (a) h() {}",
        "func Use(x i) { x.M() }",
      ),
      "p/broken.go": lines(
        "package p",
        "type b struct{ a }",
        "func (b) X() {",
        "if true {",
        "}",
        "  func (b) M() {}",
      ),
    }));
    const link = call(links, "p/clean.go", "x.M");
    assert.deepEqual(link.data.open, OPEN, `recovery ${on}`);
    if (on)
      assert.ok(
        link.candidates.includes("p/broken.go:method:(b).M"),
        link.candidates.join(),
      );
  });
});

test("safety: 3 grouped and Unicode types truncated at end of file", async () => {
  const clean = (name) =>
    lines(
      "package p",
      "type i interface{ M(); h() }",
      "type a struct{}",
      "func (a) M() {}",
      "func (a) h() {}",
      "type c struct{}",
      "func (c) M() {}",
      `func (${name}) h() {}`,
      "func U(v i) { v.M() }",
    );
  await both(async (on) => {
    for (const [name, broken] of [
      ["Pub", lines("package p", "type (", "Pub struct{ c")],
      ["Ω", lines("package p", "type Ω struct{ c")],
    ]) {
      const { links, symbols } = await project({
        "go.mod": MOD,
        "p/clean.go": clean(name),
        "p/broken.go": broken,
      });
      const link = call(links, "p/clean.go", "v.M");
      assert.deepEqual(link.data.open, OPEN, `${name}, recovery ${on}`);
      if (on) {
        assert.deepEqual(
          recovered(symbols, name).map((symbol) => symbol.kind),
          ["struct"],
          name,
        );
        assert.ok(link.candidates.includes("p/clean.go:method:(c).M"));
      }
    }
  });
});

test("safety: 4 an unknown structure reaches a hidden method through a chain of imports", async () => {
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
    "internal/w/w.go": w,
  });
  await both(async (on) => {
    const { links } = await project(
      files(
        lines(
          "package w",
          'import "example.com/m/internal/y"',
          "type W struct{ y.Mid; z map[ }",
          "func (W) M() {}",
        ),
      ),
    );
    const link = call(links, "internal/x/x.go", "v.M");
    assert.ok(
      link.candidates.includes("internal/w/w.go:method:(W).M"),
      `recovery ${on}: ${link.candidates.join()}`,
    );
    assert.deepEqual(link.data.open, OPEN);
  });
  // Control: intact, W carries h through y.Mid and x.Carrier: proven, closed.
  const { links } = await project(
    files(
      lines(
        "package w",
        'import "example.com/m/internal/y"',
        "type W struct{ y.Mid }",
        "func (W) M() {}",
      ),
    ),
  );
  const link = call(links, "internal/x/x.go", "v.M");
  assert.ok(link.candidates.includes("internal/w/w.go:method:(W).M"));
  assert.equal(link.data.open, undefined);
});

test("safety: layer 1 keeps intact same-package names and depth-0 members definite, and contains the rest", async () => {
  await both(async (on) => {
    const { links } = await project({
      "go.mod": MOD,
      "p/p.go": lines(
        "package p",
        "type T struct{ f int; e }",
        "type e struct{}",
        "func (e) P() {}",
        "func (T) M() {}",
        "func F() {}",
        "func setFlags() {}",
        "func U(t T) int { F(); t.M(); t.P(); return t.f }",
      ),
      "p/flags_windows.go": lines("package p", "func variant() {}"),
      "p/broken.go": lines("package p", "func B() {", "if true {"),
      "r/r.go": lines(
        "package r",
        "type i interface{ M(); h() }",
        "type a struct{}",
        "func (a) M() {}",
        "func (a) h() {}",
        "func Use(x i) { x.M() }",
      ),
    });
    // Intact package-level name and depth-0 members: definite.
    assert.equal(
      call(links, "p/p.go", "F").target,
      "p/p.go:function:F",
      `${on}`,
    );
    assert.equal(call(links, "p/p.go", "t.M").target, "p/p.go:method:(T).M");
    assert.equal(
      links.find((link) => link.at === "t.f").target,
      "p/p.go:field:T.f",
    );
    // Promoted: an unseen method on T could shadow it.
    assert.equal(call(links, "p/p.go", "t.P").target, null);
    // A package that p cannot reach keeps its closed set.
    assert.equal(call(links, "r/r.go", "x.M").data.open, undefined);
  });
});

test("safety: a body error that is provably confined is not lossy", async () => {
  const { links, report } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type T struct{ e }",
      "type e struct{}",
      "func (e) P() {}",
      "func U(t T) { t.P() }",
    ),
    "p/broken.go": lines(
      "package p",
      "func B() {",
      "\tx := f(1, false)",
      "\terr := 2",
      "}",
      "func f(int, bool) int { return 0 }",
    ),
  });
  assert.deepEqual(report.partial, []);
  assert.equal(call(links, "p/p.go", "t.P").target, "p/p.go:method:(e).P");
  // A misparse confined to the body (an expression error, the body closed by a
  // real brace, no brace or declaration keyword in the error): still definite.
  const confined = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type T struct{ e }",
      "type e struct{}",
      "func (e) P() {}",
      "func U(t T) { t.P() }",
    ),
    "p/broken.go": lines(
      "package p",
      "func B() {",
      "\tx := g(new(int), false))",
      "\t_ = x",
      "}",
      "func g(*int, bool) int { return 0 }",
    ),
  });
  assert.deepEqual(confined.report.partial, ["p/broken.go"]);
  assert.equal(
    call(confined.links, "p/p.go", "t.P").target,
    "p/p.go:method:(e).P",
  );
});

test("safety: build variants of a lossy package are an open set", async () => {
  await both(async (on) => {
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
    assert.equal(link.candidates.length, 2, `${on}`);
    assert.deepEqual(link.data.open, { reason: "declarations-may-be-unseen" });
  });
});

test("safety: an unseen type of a lossy package may implement a sealed interface it reaches", async () => {
  const base = lines(
    "package p",
    "type i interface{ M(); h() }",
    "type a struct{}",
    "func (a) M() {}",
    "func (a) h() {}",
    "func Use(x i) { x.M() }",
  );
  // Control: closed.
  let { links } = await project({ "go.mod": MOD, "p/p.go": base });
  assert.equal(call(links, "p/p.go", "x.M").data.open, undefined);
  await both(async (on) => {
    // The lossy file declares no type anyone can see: only the reach rule opens it.
    ({ links } = await project({
      "go.mod": MOD,
      "p/p.go": base,
      "p/broken.go": lines("package p", "func B() {", "if true {"),
    }));
    assert.deepEqual(call(links, "p/p.go", "x.M").data.open, OPEN, `${on}`);
  });
});

test("safety: a recovered type never gets an implements link", async () => {
  await both(async (on) => {
    const { links, symbols } = await project({
      "go.mod": MOD,
      "p/clean.go": lines(
        "package p",
        "type J interface{ M() }",
        "func (Q) M() {}",
        "func Use(x J) { x.M() }",
      ),
      "p/broken.go": lines("package p", "type Q struct{ z map["),
    });
    if (on) assert.equal(recovered(symbols, "Q").length, 1);
    assert.ok(
      !links.some(
        (link) => link.kind === "implements" && link.at.startsWith("Q"),
      ),
      `${on}`,
    );
    // Never a closed set: open (recovery on lists (Q).M), or unresolved.
    const link = call(links, "p/clean.go", "x.M");
    if (link.candidates.length) assert.deepEqual(link.data.open, OPEN);
    else assert.equal(link.target, null);
    if (on) assert.ok(link.candidates.includes("p/clean.go:method:(Q).M"));
  });
});

test("safety: e an unclosed import block: the set stays open with recovery off", async () => {
  const q = lines(
    "package q",
    "type i interface{ M(); h() }",
    "type Carrier struct{}",
    "func (Carrier) M() {}",
    "func (Carrier) h() {}",
    "func Use(x i) { x.M() }",
  );
  await both(async (on) => {
    const { links } = await project({
      "go.mod": MOD,
      "internal/q/q.go": q,
      "cmd/main.go": lines(
        "package main",
        'import (\n\t"example.com/m/internal/q"\nimport "fmt"',
        "type W struct{ q.Carrier }",
        "func (W) M() {}",
        "func main() { q.Use(W{}) }",
      ),
    });
    const link = call(links, "internal/q/q.go", "x.M");
    assert.deepEqual(link.data.open, OPEN, `${on}`);
    if (on) assert.ok(link.candidates.includes("cmd/main.go:method:(W).M"));
  });
});

test("safety: in a lossy package a signature naming a predeclared type proves nothing", async () => {
  await both(async (on) => {
    const { links } = await project({
      "go.mod": MOD,
      "p/p.go": lines(
        "package p",
        "type J interface{ M() error }",
        "type T struct{}",
        "func (T) M() error { return nil }",
      ),
      "p/broken.go": lines("package p", "func B() {", "if true {"),
    });
    // An unseen `type error …` in p would change both signatures' meaning.
    assert.ok(!links.some((link) => link.kind === "implements"), `${on}`);
  });
  // Control: the same package intact proves it.
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type J interface{ M() error }",
      "type T struct{}",
      "func (T) M() error { return nil }",
    ),
  });
  assert.ok(links.some((link) => link.kind === "implements"));
});
