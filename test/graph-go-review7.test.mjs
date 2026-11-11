// Regressions for the seventh W2-B review: package-unique local type identities
// everywhere a local type is compared or keyed, and a defined type's own methods
// staying known when its underlying type is not.
import assert from "node:assert/strict";
import { test } from "node:test";
import { call, project } from "./fixtures/graph-go/harness.mjs";

const MOD = "module example.com/m\n\ngo 1.22\n";
const lines = (...items) => [...items, ""].join("\n");
const implementsOf = (links) =>
  links
    .filter((link) => link.kind === "implements")
    .map((link) => `${link.at.split(" ")[0]}->${link.targetName}`)
    .sort();

test("1a: local types in signatures compare by their scoped identity, not their spelling", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "func F() {",
      "\ttype t int",
      "\ttype i interface{ M(t); hidden() }",
      "\ttype w struct{ i }",
      "\t_ = w{}",
      "}",
      "func G() {",
      "\ttype t string",
      "\ttype j interface{ M(t); hidden() }",
      "\ttype v struct{ j }",
      "\t_ = v{}",
      "}",
    ),
  });
  const impl = links
    .filter((link) => link.kind === "implements")
    .map((link) => `${link.at.split(" ")[0]}->${link.targetName}`);
  // The legitimate links, within one scope.
  assert.ok(impl.includes("w->p.go:F.i"), impl.join());
  assert.ok(impl.includes("v->p.go:G.j"), impl.join());
  // The two `t` are different types: no cross-scope links.
  assert.ok(!impl.includes("w->p.go:G.j"), impl.join());
  assert.ok(!impl.includes("v->p.go:F.i"), impl.join());
});

test("1b: local types are unique per package: same-shaped init structs in several files", async () => {
  const p = lines(
    "package p",
    "type I interface{ M(); N() }",
    "type a struct{}",
    "func (a) M() {}",
    "type b struct{}",
    "func (b) N() {}",
    "type d struct{}",
    "func (d) M() {}",
    "func (d) N() {}",
    "func init() { var v I = struct{ a; b }{}; v.M() }",
  );
  const withoutQ = await project({ "go.mod": MOD, "p/p.go": p });
  const withQ = await project({
    "go.mod": MOD,
    "p/p.go": p,
    "p/q.go": lines(
      "package p",
      "type c struct{}",
      "func init() { _ = struct{ c; M int }{} }",
    ),
    "p/r.go": lines("package p", "func init() { _ = struct{ a; b }{} }"),
  });
  for (const { links } of [withoutQ, withQ]) {
    assert.deepEqual(call(links, "p/p.go", "v.M").candidates, [
      "p/p.go:method:(a).M",
      "p/p.go:method:(d).M",
      "p/p.go:method:I.M",
    ]);
    assert.ok(
      links.some(
        (link) =>
          link.kind === "implements" &&
          link.file === "p/p.go" &&
          link.at === "struct{ a; b }",
      ),
    );
  }
  // r.go's same-shaped struct is its own type, and implements I too.
  assert.ok(
    withQ.links.some(
      (link) => link.kind === "implements" && link.file === "p/r.go",
    ),
  );
  // q.go's struct (field M) does not.
  assert.ok(
    !withQ.links.some(
      (link) => link.kind === "implements" && link.file === "p/q.go",
    ),
  );
  const ids = withQ.symbols
    .filter((symbol) => symbol.data?.local)
    .map((symbol) => symbol.identity)
    .sort();
  assert.deepEqual(ids, [
    "p.go:init.struct#1",
    "q.go:init.struct#1",
    "r.go:init.struct#1",
  ]);
});

test("1b: a function and its local types in two build-variant files stay apart", async () => {
  const variant = (field) =>
    lines(
      "package p",
      "type I interface{ M() }",
      `func Make() I { type l struct{ ${field} }; return l{} }`,
    );
  const { links } = await project({
    "go.mod": MOD,
    "p/types.go": lines(
      "package p",
      "type a struct{}",
      "func (a) M() {}",
      "type z struct{}",
    ),
    "p/make_linux.go": variant("a"),
    "p/make_windows.go": variant("z").replace("type I interface{ M() }\n", ""),
  });
  const impl = links
    .filter((link) => link.kind === "implements")
    .map((link) => `${link.file}:${link.at.split(" ")[0]}`);
  assert.ok(impl.includes("p/make_linux.go:l"), impl.join());
  assert.ok(!impl.includes("p/make_windows.go:l"), impl.join());
});

test("2: a defined type over an unresolvable type keeps its own methods (depth 0)", async () => {
  for (const extra of [
    ["type w Base", "func (w) M() {}"],
    ["type w struct{ Base }", "func (w) M() {}"],
  ]) {
    const { links } = await project({
      "go.mod": MOD,
      "p/p.go": lines(
        "package p",
        "type I interface{ M() }",
        "type a struct{}",
        "func (a) M() {}",
        "type b struct{}",
        "func (b) M() {}",
        "func Use(x I) { x.M() }",
        ...extra,
      ),
      "p/broken.go": lines("package p", "type Base struct {", "func"),
    });
    const link = call(links, "p/p.go", "x.M");
    assert.ok(
      link.candidates.includes("p/p.go:method:(w).M"),
      link.candidates.join(),
    );
    assert.ok(implementsOf(links).includes("w->I"), implementsOf(links).join());
  }
  // Methods not declared on w itself: unproven (open), not definite.
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type J interface{ M(); N() }",
      "type a struct{}",
      "func (a) M() {}",
      "func (a) N() {}",
      "func Use(x J) { x.M() }",
      "type w Missing",
      "func (w) M() {}",
    ),
  });
  const link = call(links, "p/p.go", "x.M");
  assert.ok(
    link.candidates.includes("p/p.go:method:(w).M"),
    link.candidates.join(),
  );
  assert.ok(!implementsOf(links).includes("w->J"));
  assert.deepEqual(link.data.open, {
    reason: "external-implementers-possible",
  });
});

test("2: a defined type over an external type: its own methods are provable", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      'import "example.com/ext"',
      "type I interface{ M() }",
      "type w ext.T",
      "func (w) M() {}",
      "func Use(x I) { x.M() }",
    ),
  });
  assert.ok(implementsOf(links).includes("w->I"), implementsOf(links).join());
  assert.ok(
    call(links, "p/p.go", "x.M").candidates.includes("p/p.go:method:(w).M"),
  );
});
