// Regressions for the eighth W2-B review: nothing recovered from inside a syntax
// error, or from a declaration whose header contains one, may support a definite
// link or a closed set anywhere in the project.
import assert from "node:assert/strict";
import { test } from "node:test";
import { call, project } from "./fixtures/graph-go/harness.mjs";

const MOD = "module example.com/m\n\ngo 1.22\n";
const lines = (...items) => [...items, ""].join("\n");
/** Open, for whichever reason applies (a lossy package is one). */
const assertOpen = (open, message) =>
  assert.ok(open?.reason, message ?? JSON.stringify(open));
const implementsOf = (links) =>
  links
    .filter((link) => link.kind === "implements")
    .map((link) => `${link.at.split(/[ \n]/)[0]}->${link.targetName}`)
    .sort();

test("repro 1: a broken struct's recovered embedding gives no definite link in a clean file", async () => {
  const { links, report } = await project({
    "go.mod": MOD,
    "p/b.go": lines(
      "package p",
      "type c struct{}",
      "func (c) M() {}",
      "type Base struct{ c map[ }",
    ),
    "p/p.go": lines(
      "package p",
      "type I interface{ M() }",
      "func G(b Base) { b.M() }",
      "func U(x I) { x.M() }",
    ),
  });
  assert.deepEqual(report.partial, ["p/b.go"]);
  // No structure from the broken declaration.
  assert.deepEqual(
    links.filter((link) => link.kind === "embeds"),
    [],
  );
  assert.ok(
    !links.some(
      (link) => link.kind === "contains" && link.targetName.startsWith("Base."),
    ),
  );
  // No definite member lookup or implements through it.
  const sel = call(links, "p/p.go", "b.M");
  assert.equal(sel.target, null);
  assert.ok(
    !implementsOf(links).includes("Base->I"),
    implementsOf(links).join(),
  );
  // It may still be an I: the dispatch set is open and lists (c).M.
  const dispatch = call(links, "p/p.go", "x.M");
  assert.ok(
    dispatch.candidates.includes("p/b.go:method:(c).M"),
    dispatch.candidates.join(),
  );
  assertOpen(dispatch.data.open);
});

test("repro 2: an embedding recovery dropped still makes its method a possible target", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/b.go": lines(
      "package p",
      "type c struct{}",
      "func (c) M() {}",
      "type Base struct{ x []int{}; c }",
    ),
    "p/p.go": lines(
      "package p",
      "type i interface{ M(); h() }",
      "type a struct{}",
      "func (a) M() {}",
      "func (a) h() {}",
      "func Use(x i) { x.M() }",
      "type w Base",
      "func (w) h() {}",
    ),
  });
  const link = call(links, "p/p.go", "x.M");
  assert.ok(
    link.candidates.includes("p/b.go:method:(c).M"),
    link.candidates.join(),
  );
  assert.ok(link.candidates.includes("p/p.go:method:(a).M"));
  assertOpen(link.data.open);
});

test("a broken interface has no trusted method set", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/j.go": lines("package p", "type J interface{ M(); N( }"),
    "p/p.go": lines(
      "package p",
      "type a struct{}",
      "func (a) M() {}",
      "func Use(x J) { x.M() }",
    ),
  });
  assert.ok(!implementsOf(links).some((item) => item.endsWith("->J")));
  assert.equal(call(links, "p/p.go", "x.M").target, null);
  assert.ok(
    !links.some(
      (link) => link.kind === "contains" && link.targetName === "J.M",
    ),
  );
});

test("a broken exported type might carry a hidden method: the sealed set is open", async () => {
  const base = lines(
    "package p",
    "type i interface{ M(); h() }",
    "type a struct{}",
    "func (a) M() {}",
    "func (a) h() {}",
    "func Use(x i) { x.M() }",
  );
  let { links } = await project({ "go.mod": MOD, "p/p.go": base });
  assert.equal(call(links, "p/p.go", "x.M").data.open, undefined);
  ({ links } = await project({
    "go.mod": MOD,
    "p/p.go": base,
    "p/pub.go": lines("package p", "type Pub struct{ a; z map[ }"),
  }));
  assertOpen(call(links, "p/p.go", "x.M").data.open);
});

test("broken method and function headers support no definite link", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type I interface{ M(); N() }",
      "type A struct{}",
      "func (A) M() {}",
      "type B struct{}",
      "func (B) M() {}",
      "func (B) N() {}",
      "func Use(a A, x I) { a.N(); a.M(); x.M() }",
      "func Make() *B { return nil }",
      "func Value() { v := Make(); v.M(); w := Broken(); w.M() }",
    ),
    "p/broken.go": lines(
      "package p",
      "func (A) N(x map[ ) {}",
      "func Broken() *B[ { return nil }",
    ),
  });
  // A's N has a broken header: no resolution to it, no definite implements.
  assert.equal(call(links, "p/p.go", "a.N").target, null);
  assert.ok(!implementsOf(links).includes("A->I"), implementsOf(links).join());
  // A's intact M still resolves (declared on A itself).
  assert.equal(call(links, "p/p.go", "a.M").target, "p/p.go:method:(A).M");
  // A may be an I: listed in the open dispatch set.
  const dispatch = call(links, "p/p.go", "x.M");
  assert.ok(
    dispatch.candidates.includes("p/p.go:method:(A).M"),
    dispatch.candidates.join(),
  );
  assertOpen(dispatch.data.open);
  // A clean function's result types its value; a broken one's does not.
  assert.equal(call(links, "p/p.go", "v.M").target, "p/p.go:method:(B).M");
  assert.equal(call(links, "p/p.go", "w.M").target, null);
});

test("a var with a broken type, and a broken import declaration, support no definite link", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "q/q.go": lines(
      "package q",
      "type T struct{}",
      "func (T) M() {}",
      "func F() {}",
    ),
    "p/v.go": lines(
      "package p",
      'import "example.com/m/q"',
      "var good q.T",
      "var bad map[q.T",
    ),
    "p/p.go": lines("package p", "func Use() { good.M(); bad.M() }"),
    "r/r.go": lines(
      "package r",
      'import (\n\t"example.com/m/q"\n\t"example.com/m/\n)',
      "func Use() { q.F() }",
    ),
  });
  assert.equal(call(links, "p/p.go", "good.M").target, "q/q.go:method:(T).M");
  assert.equal(call(links, "p/p.go", "bad.M").target, null);
  // The broken import spec yields no import link and no import fact.
  const imports = links.filter(
    (link) => link.kind === "imports" && link.file === "r/r.go",
  );
  assert.ok(imports.every((link) => !link.at.includes('"example.com/m/\n')));
});

test("local types inside a broken declaration have unknown structure", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type i interface{ M(); h() }",
      "type a struct{}",
      "func (a) M() {}",
      "func (a) h() {}",
      "type b struct{}",
      "func (b) M() {}",
      "func Use(x i) { x.M() }",
    ),
    "p/make.go": lines(
      "package p",
      "func Make() i { type l struct{ b; z map[ }; return l{} }",
    ),
  });
  const link = call(links, "p/p.go", "x.M");
  assert.ok(
    link.candidates.includes("p/p.go:method:(b).M"),
    link.candidates.join(),
  );
  assertOpen(link.data.open);
  assert.ok(!implementsOf(links).some((item) => item.startsWith("make.go:")));
});
