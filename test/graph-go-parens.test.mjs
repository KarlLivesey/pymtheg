// Redundant parentheses around a type or an expression mean nothing in Go:
// the graph must be the same with and without them (W2-B2, post-merge review
// items 1 and 2). Every case, in both forms, passes `go build ./...` (Go
// 1.27.4). Parenthesised embedded fields (`struct{ (T) }`, `*(T)`, `(*T)`)
// and parenthesised composite-literal types (`(T){}`) are not legal Go
// (go build: "cannot parenthesize embedded type", "cannot parenthesize type in
// composite literal") and are not cases.
import assert from "node:assert/strict";
import { test } from "node:test";
import { call, project } from "./fixtures/graph-go/harness.mjs";

const MOD = "module example.com/m\n\ngo 1.22\n";
const PRE = [
  "package p",
  "type T struct{ x int }",
  "func (T) M() {}",
  "func (*T) PM() {}",
  "type I interface{ M() }",
  "type G[X any] struct{ v X }",
  "func (G[X]) Get() X { var x X; return x }",
  "func F() {}",
  "type Fn func()",
];
// [label, with redundant parentheses, without]
const CASES = [
  [
    "receiver (T), named",
    "func (t (T)) N() { t.M() }",
    "func (t T) N() { t.M() }",
  ],
  [
    "receiver (T), unnamed",
    "func ((T)) N() {}\nfunc U(t T) { t.N() }",
    "func (T) N() {}\nfunc U(t T) { t.N() }",
  ],
  [
    "receiver (*T)",
    "func (t (*T)) N() { t.PM() }",
    "func (t *T) N() { t.PM() }",
  ],
  [
    "receiver *(T)",
    "func (t *(T)) N() { t.PM() }",
    "func (t *T) N() { t.PM() }",
  ],
  [
    "receiver variable shadows a function",
    "func (F (Fn)) N() { F() }",
    "func (F Fn) N() { F() }",
  ],
  [
    "parameter (T)",
    "func U(t (T), u *(T)) { t.M(); u.PM() }",
    "func U(t T, u *T) { t.M(); u.PM() }",
  ],
  [
    "result (T)",
    "func New() (T) { return T{} }\nfunc U() { New().M() }",
    "func New() T { return T{} }\nfunc U() { New().M() }",
  ],
  [
    "named result (T)",
    "func New() (r (T)) { r.M(); return }",
    "func New() (r T) { r.M(); return }",
  ],
  [
    "field (T)",
    "type S struct{ f (T) }\nfunc U(s S) { s.f.M() }",
    "type S struct{ f T }\nfunc U(s S) { s.f.M() }",
  ],
  [
    "slice, map, chan and func of (T)",
    'type S struct {\n\tg [](T)\n\th map[(string)](T)\n\tc chan (T)\n\tk func((T)) (T)\n}\nfunc U(s S) { s.g[0].M(); s.h["a"].M(); (<-s.c).M(); s.k(T{}).M() }',
    'type S struct {\n\tg []T\n\th map[string]T\n\tc chan T\n\tk func(T) T\n}\nfunc U(s S) { s.g[0].M(); s.h["a"].M(); (<-s.c).M(); s.k(T{}).M() }',
  ],
  [
    "type W (T)",
    "type W (T)\nfunc (W) N() {}\nfunc U(w W) { w.N(); _ = w.x }",
    "type W T\nfunc (W) N() {}\nfunc U(w W) { w.N(); _ = w.x }",
  ],
  [
    "type W (struct{ A }) (review case 2)",
    "type J interface { M(); N() }\ntype A struct{}\nfunc (A) M() {}\ntype W (struct{ A })\nfunc (W) N() {}\ntype B struct{}\nfunc (B) M() {}\nfunc (B) N() {}\nvar _ J = W{}\nfunc Use(j J) { j.M() }",
    "type J interface { M(); N() }\ntype A struct{}\nfunc (A) M() {}\ntype W struct{ A }\nfunc (W) N() {}\ntype B struct{}\nfunc (B) M() {}\nfunc (B) N() {}\nvar _ J = W{}\nfunc Use(j J) { j.M() }",
  ],
  [
    "type J (interface{ … })",
    "type J (interface{ M() })\nfunc Use(j J) { j.M() }",
    "type J interface{ M() }\nfunc Use(j J) { j.M() }",
  ],
  [
    "alias type A = (T)",
    "type A = (T)\nfunc U(a A) { a.M() }",
    "type A = T\nfunc U(a A) { a.M() }",
  ],
  [
    "generic instantiation (G[int])",
    "type S struct{ l (G[int]) }\nfunc U(s S) { s.l.Get() }",
    "type S struct{ l G[int] }\nfunc U(s S) { s.l.Get() }",
  ],
  [
    "conversion (T)(x)",
    "func U(t T) { (T)(t).M() }",
    "func U(t T) { T(t).M() }",
  ],
  [
    "conversion ((*T))(nil)",
    "func U() { ((*T))(nil).PM() }",
    "func U() { (*T)(nil).PM() }",
  ],
  [
    "method expression (T).M",
    "func U(t T) { (T).M(t) }",
    "func U(t T) { T.M(t) }",
  ],
  [
    "method expression ((*T)).PM",
    "func U(t T) { ((*T)).PM(&t) }",
    "func U(t T) { (*T).PM(&t) }",
  ],
  ["operand (x).M()", "func U(t T) { (t).M() }", "func U(t T) { t.M() }"],
  [
    "operand ((*p)).M()",
    "func U(p *T) { ((*p)).M() }",
    "func U(p *T) { (*p).M() }",
  ],
  [
    "operand ((&v)).PM()",
    "func U(v T) { ((&v)).PM() }",
    "func U(v T) { (&v).PM() }",
  ],
  ["callee ((F))()", "func U() { ((F))() }", "func U() { F() }"],
  [
    "triple-nested parentheses",
    "func U(t (((T))), u *(((T)))) { (((t))).M(); (((u))).PM() }",
    "func U(t T, u *T) { t.M(); u.PM() }",
  ],
  [
    "type switch case (T): and case (*T):",
    "func U(x any) {\n\tswitch y := x.(type) {\n\tcase (T):\n\t\ty.M()\n\tcase (*T):\n\t\ty.PM()\n\t}\n}",
    "func U(x any) {\n\tswitch y := x.(type) {\n\tcase T:\n\t\ty.M()\n\tcase *T:\n\t\ty.PM()\n\t}\n}",
  ],
  [
    "embedded interface (I)",
    "type J interface{ (I) }\nfunc U(j J) { j.M() }",
    "type J interface{ I }\nfunc U(j J) { j.M() }",
  ],
];

const file = (text) => [...PRE, text, ""].join("\n");
/** The graph without what depends on source offsets (keys, ids, link order). */
const shape = ({ links, symbols }) => {
  const byId = new Map(symbols.map((s) => [s.id, `${s.kind}:${s.identity}`]));
  const norm = (data) => {
    const { child, interfaceId, ...rest } = data ?? {};
    void child;
    return {
      ...rest,
      ...(interfaceId ? { interface: byId.get(interfaceId) } : {}),
    };
  };
  return {
    symbols: symbols
      .map((s) => `${s.kind} ${s.identity} ${JSON.stringify(s.data ?? {})}`)
      .sort(),
    links: links
      .map((l) =>
        JSON.stringify({
          kind: l.kind,
          target: l.target,
          candidates: l.candidates,
          data: norm(l.data),
        }),
      )
      .sort(),
  };
};

test("redundant parentheses do not change the graph (matrix)", async () => {
  assert.equal(CASES.length, 26);
  for (const [label, withParens, without] of CASES) {
    const a = shape(
      await project({ "go.mod": MOD, "p/p.go": file(withParens) }),
    );
    const b = shape(await project({ "go.mod": MOD, "p/p.go": file(without) }));
    assert.deepEqual(a, b, label);
  }
});

test("review 1: a parenthesised receiver type still declares the receiver variable", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": [
      "package p",
      "type Fn func()",
      "func F() {}",
      "func (F (Fn)) M() { F() }",
      "",
    ].join("\n"),
  });
  // Go calls the receiver variable F, never the package-level func F.
  const inner = call(links, "p/p.go", "F");
  assert.equal(inner.target, null);
  assert.ok(
    links.some(
      (link) =>
        link.kind === "contains" && link.target === "p/p.go:method:(Fn).M",
    ),
  );
});

test("review 2: a parenthesised struct type keeps its implementer and promoted dispatch target", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": [
      "package p",
      "type I interface { M(); N() }",
      "type A struct{}",
      "func (A) M() {}",
      "type W (struct{ A })",
      "func (W) N() {}",
      "type B struct{}",
      "func (B) M() {}",
      "func (B) N() {}",
      "var _ I = W{}",
      "func Use(i I) { i.M() }",
      "",
    ].join("\n"),
  });
  assert.ok(
    links.some(
      (link) => link.kind === "implements" && link.at.startsWith("W "),
    ),
  );
  assert.deepEqual(call(links, "p/p.go", "i.M").candidates, [
    "p/p.go:method:(A).M",
    "p/p.go:method:(B).M",
    "p/p.go:method:I.M",
  ]);
});
