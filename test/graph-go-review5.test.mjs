// Regressions for the fifth W2-B review: one reachability rule for closed dispatch
// sets, inherited hidden methods, local/anonymous implementers, shadowed names in
// call positions. Item numbers follow the review.
import assert from "node:assert/strict";
import { test } from "node:test";
import { call, project } from "./fixtures/graph-go/harness.mjs";

const MOD = "module example.com/m\n\ngo 1.22\n";
const lines = (...items) => [...items, ""].join("\n");
const OPEN = { reason: "external-implementers-possible" };

const internalP = lines(
  "package p",
  "type I interface{ M(); hidden() }",
  "type A struct{}",
  "func (A) M() {}",
  "func (A) hidden() {}",
  "type B struct{}",
  "func (B) M() {}",
  "func (B) hidden() {}",
  "func Use(x I) { x.M() }",
);
const dispatch = async (files, file = "internal/p/p.go", at = "x.M") => {
  const { links } = await project(files);
  return call(links, file, at);
};

test("1: an internal package's sealed interface stays closed only without a re-exposed carrier", async () => {
  // Control: genuinely internal, nothing re-exposed.
  let link = await dispatch({ "go.mod": MOD, "internal/p/p.go": internalP });
  assert.equal(link.candidates.length, 3);
  assert.equal(link.data.open, undefined);
  // Re-exposure through an exported struct in a public package.
  link = await dispatch({
    "go.mod": MOD,
    "internal/p/p.go": internalP,
    "api/api.go": lines(
      "package api",
      'import "example.com/m/internal/p"',
      "type Carrier struct{ p.A }",
      "func Use(x p.I) { p.Use(x) }",
    ),
  });
  assert.deepEqual(link.data.open, OPEN);
  // Re-exposure through an exported interface embedding the hidden method.
  link = await dispatch(
    {
      "go.mod": MOD,
      "internal/p/p.go": lines(
        "package p",
        "type Hidden interface{ hidden() }",
        "type A struct{}",
        "func (A) M() {}",
        "func (A) hidden() {}",
      ),
      "q/q.go": lines(
        "package q",
        'import "example.com/m/internal/p"',
        "type I interface{ p.Hidden; M() }",
        "func Use(x I) { x.M() }",
      ),
    },
    "q/q.go",
  );
  assert.deepEqual(link.data.open, OPEN);
  // Facade alias, and an exported struct embedding a carrier, in another package.
  for (const facade of [
    lines(
      "package api",
      'import "example.com/m/internal/p"',
      "type Thing = p.I",
      "func Run(t Thing) { p.Use(t) }",
    ),
    lines(
      "package api",
      'import "example.com/m/internal/p"',
      "type Pub struct{ p.A }",
    ),
    lines(
      "package api",
      'import "example.com/m/internal/p"',
      "type Ptr struct{ *p.B }",
    ),
  ]) {
    link = await dispatch({
      "go.mod": MOD,
      "internal/p/p.go": internalP,
      "api/api.go": facade,
    });
    assert.deepEqual(link.data.open, OPEN, facade);
  }
});

test("1: a nested module under internal/ is its own module with a plain, reachable path", async () => {
  const link = await dispatch(
    {
      "go.mod": MOD,
      "internal/sub/go.mod": "module example.com/sub\n",
      "internal/sub/p.go": internalP,
    },
    "internal/sub/p.go",
  );
  assert.deepEqual(link.data.open, OPEN);
  // Inside that module, an internal/ directory is internal again.
  const inner = await dispatch(
    {
      "go.mod": MOD,
      "internal/sub/go.mod": "module example.com/sub\n",
      "internal/sub/internal/p/p.go": internalP,
    },
    "internal/sub/internal/p/p.go",
  );
  assert.equal(inner.data.open, undefined);
});

test("1: defined types keep an interface's method set and a struct's promoted methods", async () => {
  const unexported = (...extra) =>
    lines(
      "package p",
      "type i interface{ M(); hidden() }",
      "type a struct{}",
      "func (a) M() {}",
      "func (a) hidden() {}",
      ...extra,
      "func Use(x i) { x.M() }",
    );
  // Control: everything unexported, no exported carrier anywhere.
  let link = await dispatch(
    { "go.mod": MOD, "p/p.go": unexported() },
    "p/p.go",
  );
  assert.equal(link.data.open, undefined);
  for (const extra of [
    ["type Pub i"],
    ["type s2 struct{ a }", "type Pub s2"],
    ["type s2 struct{ *a }", "type Pub = s2"],
    ["type G[T any] struct{ a; v T }", "type Pub = G[int]"],
  ]) {
    link = await dispatch(
      { "go.mod": MOD, "p/p.go": unexported(...extra) },
      "p/p.go",
    );
    assert.deepEqual(link.data.open, OPEN, extra.join("; "));
  }
  // package main: nothing can import it.
  link = await dispatch(
    {
      "go.mod": MOD,
      "p/p.go": unexported("type Pub i").replace("package p", "package main"),
    },
    "p/p.go",
  );
  assert.equal(link.data.open, undefined);
});

test("1: the same cases inside a go.work workspace", async () => {
  const files = {
    "go.work": "go 1.22\nuse ./core\nuse ./api\n",
    "core/go.mod": "module example.com/core\n",
    "core/internal/p/p.go": internalP,
    "api/go.mod": "module example.com/api\n",
  };
  // Control: internal to module core, no re-exposure.
  let link = await dispatch(files, "core/internal/p/p.go");
  assert.equal(link.data.open, undefined);
  // core re-exposes a carrier in a public package of its own.
  link = await dispatch(
    {
      ...files,
      "core/pub/pub.go": lines(
        "package pub",
        'import "example.com/core/internal/p"',
        "type Carrier struct{ p.A }",
      ),
    },
    "core/internal/p/p.go",
  );
  assert.deepEqual(link.data.open, OPEN);
});

test("2: in an open set, a type embedding an external type may have inherited the hidden method", async () => {
  const pub = lines(
    "package p",
    "type I interface{ M(); hidden() }",
    "type A struct{}",
    "func (A) M() {}",
    "func (A) hidden() {}",
    "func Use(x I) { x.M() }",
  );
  const w = lines(
    "package q",
    'import "example.com/ext"',
    "type W struct{ ext.Carrier }",
    "func (W) M() {}",
  );
  // Public p: ext.Carrier may embed p.A; W.M is a possible target; open.
  let link = await dispatch(
    { "go.mod": MOD, "p/p.go": pub, "q/q.go": w },
    "p/p.go",
  );
  assert.ok(
    link.candidates.includes("q/q.go:method:(W).M"),
    link.candidates.join(),
  );
  assert.deepEqual(link.data.open, OPEN);
  assert.ok(!link.candidates.some((id) => id.includes("(W).hidden")));
  // Control: internal p with no reachable carrier: no external type can have it.
  link = await dispatch(
    {
      "go.mod": MOD,
      "internal/p/p.go": pub,
      "q/q.go": w,
    },
    "internal/p/p.go",
  );
  assert.ok(!link.candidates.includes("q/q.go:method:(W).M"));
  assert.equal(link.data.open, undefined);
});

test("3: function-local and anonymous struct types are implementers", async () => {
  const body = (iface, ...extra) =>
    lines(
      "package p",
      `type ${iface} interface{ M(); hidden() }`,
      "type a struct{}",
      "func (a) M() {}",
      "func (a) hidden() {}",
      "type b struct{}",
      "func (b) M() {}",
      "type c struct{}",
      "func (c) hidden() {}",
      ...extra,
      `func Use(x ${iface}) { x.M() }`,
    );
  const expected = [
    "p/p.go:method:(a).M",
    "p/p.go:method:(b).M",
    "p/p.go:method:i.M",
  ];
  // Anonymous struct literal: closed (everything unexported), and complete.
  let link = await dispatch(
    {
      "go.mod": MOD,
      "p/p.go": body("i", "func Make() i { return struct{ b; c }{} }"),
    },
    "p/p.go",
  );
  assert.deepEqual(link.candidates, expected);
  assert.equal(link.data.open, undefined);
  // A type declared inside the function.
  link = await dispatch(
    {
      "go.mod": MOD,
      "p/p.go": body(
        "i",
        "func Make() i { type l struct{ b; c }; return l{} }",
      ),
    },
    "p/p.go",
  );
  assert.deepEqual(link.candidates, expected);
  // Exported interface: open, still listing (b).M.
  link = await dispatch(
    {
      "go.mod": MOD,
      "p/p.go": body("I", "func Make() I { return struct{ b; c }{} }"),
    },
    "p/p.go",
  );
  assert.deepEqual(link.candidates, [
    "p/p.go:method:(a).M",
    "p/p.go:method:(b).M",
    "p/p.go:method:I.M",
  ]);
  assert.deepEqual(link.data.open, OPEN);
  // Package-level control.
  link = await dispatch(
    { "go.mod": MOD, "p/p.go": body("i", "type l struct{ b; c }") },
    "p/p.go",
  );
  assert.deepEqual(link.candidates, expected);
});

test("4: shadowed predeclared names resolve in call, selector, composite-literal and type-argument positions", async () => {
  const { links, report } = await project({
    "go.mod": MOD,
    "p/decl.go": lines(
      "package p",
      "func nil() {}",
      "func true() int { return 1 }",
      "func false() bool { return false }",
      "func iota(v int) int { return v }",
      "type string struct{ Field int }",
      "func G[T any]() {}",
    ),
    "p/use.go": lines(
      "package p",
      "func CallNil() { nil() }",
      "func CallTrue() int { return true() }",
      "func CallFalse() bool { return false() }",
      "func CallIota() int { return iota(2) }",
      "func Composite() int { s := string{Field: 1}; return s.Field }",
      "func TypeArgument() { G[string]() }",
    ),
    "q/q.go": lines(
      "package q",
      "type T struct{ Field int }",
      "var nil = T{}",
      "func Sel() int { return nil.Field }",
    ),
  });
  assert.deepEqual(report.partial, []);
  const at = (file, text) =>
    links
      .filter(
        (link) =>
          link.file === file &&
          link.at === text &&
          ["calls", "references"].includes(link.kind),
      )
      .map((link) => `${link.kind}:${link.target}`)
      .sort();
  assert.deepEqual(at("p/use.go", "nil"), ["calls:p/decl.go:function:nil"]);
  assert.deepEqual(at("p/use.go", "true"), ["calls:p/decl.go:function:true"]);
  assert.deepEqual(at("p/use.go", "false"), ["calls:p/decl.go:function:false"]);
  assert.deepEqual(at("p/use.go", "iota"), ["calls:p/decl.go:function:iota"]);
  // Composite-literal type and type argument: the shadowing `string` type.
  assert.deepEqual(at("p/use.go", "string"), [
    "references:p/decl.go:struct:string",
    "references:p/decl.go:struct:string",
  ]);
  assert.equal(
    links.find((link) => link.at === "s.Field").target,
    "p/decl.go:field:string.Field",
  );
  // Selector base: a user variable named nil.
  assert.equal(
    links.find((link) => link.at === "nil.Field" && link.file === "q/q.go")
      .target,
    "q/q.go:field:T.Field",
  );
  assert.deepEqual(at("q/q.go", "nil"), ["references:q/q.go:var:nil"]);
});

test("4: a composite literal of a type named like a keyword-value is a grammar limit (partial, no links)", async () => {
  const { links, report } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type false struct{ Field int }",
      "func Bad() { _ = false{Field: 1} }",
      "func Good() {}",
    ),
  });
  // tree-sitter-go parses nil/true/false/iota as keywords: `false{…}` is a syntax
  // error. The file is partial and the erroneous declaration emits no links.
  assert.deepEqual(report.partial, ["p/p.go"]);
  assert.deepEqual(
    links.filter((link) => ["calls", "references"].includes(link.kind)),
    [],
  );
});
