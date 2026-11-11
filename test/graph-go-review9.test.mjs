// Regressions for the ninth W2-B review: declarations swallowed by error recovery
// become UNKNOWN, never disappear.
import assert from "node:assert/strict";
import { test } from "node:test";
import go from "../dist/graph/languages/go/index.js";
import { call, project } from "./fixtures/graph-go/harness.mjs";

const MOD = "module example.com/m\n\ngo 1.22\n";
const lines = (...items) => [...items, ""].join("\n");
const OPEN = { reason: "external-implementers-possible" };

test("a: a type truncated at end of file becomes a broken symbol of unknown structure", async () => {
  const { links, symbols } = await project({
    "go.mod": MOD,
    "p/clean.go": lines(
      "package p",
      "type i interface{ M(); h() }",
      "type a struct{}",
      "func (a) M() {}",
      "func (a) h() {}",
      "type c struct{}",
      "func (c) M() {}",
      "func (Pub) h() {}",
      "func Use(x i) { x.M() }",
    ),
    "p/broken.go": "package p\ntype Pub struct { c",
  });
  assert.ok(
    symbols.some((symbol) => symbol.name === "Pub" && symbol.data?.broken),
  );
  const link = call(links, "p/clean.go", "x.M");
  assert.ok(
    link.candidates.includes("p/clean.go:method:(c).M"),
    link.candidates.join(),
  );
  assert.deepEqual(link.data.open, OPEN);
  // Pub's intact method elsewhere still has its receiver.
  assert.ok(
    links.some(
      (item) =>
        item.kind === "receiver" && item.target === "p/broken.go:struct:Pub",
    ),
  );
});

const promotion = (broken) =>
  project({
    "go.mod": MOD,
    "p/a.go": lines("package p", "type a struct{}", "func (a) h() {}"),
    "p/p.go": lines("package p", "func U(v b) { v.h() }"),
    "p/b.go": broken,
  });

test("b/c: a broken or swallowed method header makes promotion through its receiver not definite", async () => {
  for (const broken of [
    lines("package p", "type b struct{ a }", "func (b h() {}"),
    lines("package p", "type b struct{ a }", "func (b) h( {"),
    lines("package p", "type b struct{ a }", "func (b) h[T any() {}"),
    lines(
      "package p",
      "type b struct{ a }",
      "func (b) X() {",
      "if true {",
      "println(1)",
      "}",
      "func (b) h() {}",
    ),
  ]) {
    const { links } = await promotion(broken);
    const link = call(links, "p/p.go", "v.h");
    assert.equal(link.target, null, broken);
  }
  // A recovered header keeps the identity (and so the ID) of the intact declaration.
  const { symbols } = await promotion(
    lines("package p", "type b struct{ a; z map[ }", "func (v *b) h( {"),
  );
  assert.ok(
    symbols.some(
      (symbol) => symbol.kind === "method" && symbol.identity === "(*b).h",
    ),
    symbols.map((symbol) => symbol.identity).join(),
  );
  // Control: intact, the promoted method resolves.
  const { links } = await promotion(lines("package p", "type b struct{ a }"));
  assert.equal(call(links, "p/p.go", "v.h").target, "p/a.go:method:(a).h");
});

test("d: a method whose following code was swallowed is still a possible target; the set is open", async () => {
  const p = lines(
    "package p",
    "type i interface{ M(); h() }",
    "type a struct{}",
    "func (a) M() {}",
    "func (a) h() {}",
    "func Use(x i) { x.M() }",
  );
  for (const broken of [
    lines(
      "package p",
      "type b struct{}",
      "func (b) M() {",
      "if true {",
      "}",
      "func (b) h() {}",
    ),
    lines("package p", "type b struct{}", "func (b) M() {}", "func (b) h( {"),
  ]) {
    const { links } = await project({
      "go.mod": MOD,
      "p/p.go": p,
      "p/b.go": broken,
    });
    const link = call(links, "p/p.go", "x.M");
    assert.ok(
      link.candidates.includes("p/b.go:method:(b).M"),
      `${broken}: ${link.candidates.join()}`,
    );
    assert.deepEqual(link.data.open, OPEN, broken);
  }
  // Control: without b.go the set is closed.
  const { links } = await project({ "go.mod": MOD, "p/p.go": p });
  assert.equal(call(links, "p/p.go", "x.M").data.open, undefined);
});

test("e: a lost import makes unmatched qualifiers unknown, not external", async () => {
  const q = lines(
    "package q",
    "type i interface{ M(); h() }",
    "type Carrier struct{}",
    "func (Carrier) M() {}",
    "func (Carrier) h() {}",
    "func Use(x i) { x.M() }",
  );
  for (const head of [
    'imprt "example.com/m/internal/q"',
    'import (\n\t"example.com/m/internal/q"\nimport "fmt"',
  ]) {
    const { links } = await project({
      "go.mod": MOD,
      "internal/q/q.go": q,
      "cmd/main.go": lines(
        "package main",
        head,
        "type W struct{ q.Carrier }",
        "func (W) M() {}",
        "func main() { q.Use(W{}) }",
      ),
    });
    const link = call(links, "internal/q/q.go", "x.M");
    assert.ok(
      link.candidates.includes("cmd/main.go:method:(W).M"),
      `${head}: ${link.candidates.join()}`,
    );
    assert.deepEqual(link.data.open, OPEN, head);
  }
});

test("containment: intact declarations in the same file, and unrelated packages, still resolve", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/b.go": lines(
      "package p",
      "type Good struct{}",
      "func (Good) M() {}",
      "func G() { var g Good; g.M() }",
      "type Pub struct { c",
    ),
    "r/r.go": lines(
      "package r",
      "type i interface{ M(); h() }",
      "type a struct{}",
      "func (a) M() {}",
      "func (a) h() {}",
      "func Use(x i) { x.M() }",
      "func D(v a) { v.M() }",
    ),
  });
  assert.equal(call(links, "p/b.go", "g.M").target, "p/b.go:method:(Good).M");
  assert.equal(call(links, "r/r.go", "v.M").target, "r/r.go:method:(a).M");
  assert.equal(call(links, "r/r.go", "x.M").data.open, undefined);
});

test("an unreadable method header makes every method set of its package unknown, with a diagnostic", async () => {
  const p = lines(
    "package p",
    "type i interface{ M(); h() }",
    "type a struct{}",
    "func (a) M() {}",
    "func (a) h() {}",
    "type b struct{}",
    "func (b) M() {}",
    "func Use(x i) { x.M() }",
    "func D(v b) { v.M() }",
  );
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": p,
    "p/z.go": lines("package p", "type z struct{ a }", "func ( {"),
    "r/r.go": lines(
      "package r",
      "type j interface{ M(); h() }",
      "type a struct{}",
      "func (a) M() {}",
      "func (a) h() {}",
      "func Use(x j) { x.M() }",
    ),
  });
  assert.deepEqual(call(links, "p/p.go", "x.M").data.open, OPEN);
  assert.equal(call(links, "p/p.go", "v.M").target, "p/p.go:method:(b).M");
  // Another package is not affected.
  assert.equal(call(links, "r/r.go", "x.M").data.open, undefined);
  const parsed = await go.parse({
    path: "p/z.go",
    text: lines("package p", "type z struct{ a }", "func ( {"),
  });
  assert.equal(parsed.status, "partial");
  assert.ok(
    parsed.diagnostics.some((item) => /method sets/.test(item.message)),
    JSON.stringify(parsed.diagnostics),
  );
});
