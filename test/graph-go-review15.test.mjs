// Regressions for the fifteenth W2-B review: a link about to be emitted as not
// resolved fails (`invalid-code`) when any type its source mentions needs a
// failed file, however resolution reached it (the backstop).
import assert from "node:assert/strict";
import { test } from "node:test";
import { call, project } from "./fixtures/graph-go/harness.mjs";

const MOD = "module example.com/m\n\ngo 1.22\n";
const lines = (...items) => [...items, ""].join("\n");

const P = {
  "p/bad.go": lines(
    "package p",
    "type R struct{}",
    "func (R) M() {}",
    "type T struct{ R }",
    "func Broken() { (( }",
  ),
  "p/ok.go": lines(
    "package p",
    "type Good struct{}",
    "func (Good) M() {}",
    "type W struct{ T }",
    "func NewT() T { return T{} }",
    "type I interface{ Get() T }",
  ),
};

test("safety: every way of reaching a failed file's type fails with it as the cause", async () => {
  const { links } = await project({
    "go.mod": MOD,
    ...P,
    "q/q.go": lines(
      "package q",
      'import "example.com/m/p"',
      "type Q p.T",
      "type QA = p.T",
      "type Box[A any] struct{ X A }",
      "type A struct{ B B2 }",
      "type B2 struct{ T p.T }",
      "func F(q Q, qa QA, b Box[p.T], a A, s []p.T, m map[string]p.T, c chan p.T, f func() p.T, x any, pt *p.T, w p.W, i p.I) {",
      "\tq.M()",
      "\tqa.M()",
      "\tb.X.M()",
      "\ta.B.T.M()",
      "\ts[0].M()",
      '\tm["a"].M()',
      "\t(<-c).M()",
      "\tfor _, v := range s { v.M() }",
      "\tf().M()",
      "\tx.(p.T).M()",
      "\tswitch y := x.(type) {",
      "\tcase p.T:",
      "\t\ty.M()",
      "\t}",
      "\tg := func() p.T { return p.T{} }",
      "\tg().M()",
      "\tp.T{}.M()",
      "\tpt.M()",
      "\th := p.NewT",
      "\th().M()",
      "\ti.Get().M()",
      "\tw.M()",
      "}",
    ),
  });
  for (const at of [
    "q.M",
    "qa.M",
    "b.X.M",
    "a.B.T.M",
    "s[0].M",
    'm["a"].M',
    "(<-c).M",
    "v.M",
    "f().M",
    "x.(p.T).M",
    "y.M",
    "g().M",
    "p.T{}.M",
    "pt.M",
    "h().M",
    "i.Get().M",
    "w.M",
  ]) {
    const link = links.find(
      (item) =>
        item.file === "q/q.go" && item.kind === "calls" && item.at === at,
    );
    assert.ok(link, at);
    assert.equal(link.target, null, at);
    assert.deepEqual(link.candidates, [], at);
    assert.equal(link.data.reason, "invalid-code", at);
    assert.deepEqual(link.data.cause, { files: ["p/bad.go"] }, at);
  }
});

test("the backstop leaves valid code alone", async () => {
  const { links } = await project({
    "go.mod": MOD,
    ...P,
    "q/q.go": lines(
      "package q",
      'import (\n\t"fmt"\n\t"example.com/m/p"\n)',
      "func F(g p.Good) { g.M(); fmt.Println(1) }",
    ),
    "r/r.go": lines(
      "package r",
      "type U struct{}",
      "func (U) N() {}",
      "func F(u U) { u.N(); u.Missing() }",
    ),
  });
  const at = (file, text) =>
    links.find(
      (item) => item.file === file && item.kind === "calls" && item.at === text,
    );
  // A concrete method on a type wholly in valid files of the failed package.
  assert.equal(at("q/q.go", "g.M").target, "p/ok.go:method:(Good).M");
  // A plain unresolved external call.
  assert.equal(at("q/q.go", "fmt.Println").data.reason, undefined);
  // An unrelated package.
  assert.equal(at("r/r.go", "u.N").target, "r/r.go:method:(U).N");
  assert.equal(at("r/r.go", "u.Missing").data.reason, undefined);
});

test("the backstop follows only what the lookup depends on", async () => {
  const { links } = await project({
    "go.mod": MOD,
    ...P,
    "q/q.go": lines(
      "package q",
      'import (\n\t"sync"\n\t"example.com/m/p"\n)',
      "type S struct {",
      "\tp.T",
      "\tmu sync.Mutex",
      "}",
      "func open() (p.T, func()) { return p.T{}, func() {} }",
      "func F(s S) {",
      "\t_, unlock := open()",
      "\tunlock()",
      "\ts.mu.Lock()",
      "\ts.M()",
      "\tfor _, c := range []struct {",
      "\t\tname string",
      "\t\tuse  func(p.T)",
      "\t}{} {",
      "\t\tc.name.Len()",
      "\t\tc.use(p.T{})",
      "\t}",
      "}",
    ),
  });
  const at = (text) =>
    links.find(
      (item) =>
        item.file === "q/q.go" && item.kind === "calls" && item.at === text,
    );
  // Result 1 of open is a func(): result 0's failed type does not matter.
  assert.equal(at("unlock").data.reason, undefined);
  // mu is a field of S itself: what S embeds cannot change it.
  assert.equal(at("s.mu.Lock").data.reason, undefined);
  // M can only come from the embedded p.T: failed.
  assert.equal(at("s.M").data.reason, "invalid-code");
  assert.deepEqual(at("s.M").data.cause, { files: ["p/bad.go"] });
  // A named field of an anonymous struct: the other fields' types do not
  // matter (restic's table tests: `test.name`, `test.damage(...)`).
  assert.equal(at("c.name.Len").data.reason, undefined);
  assert.equal(at("c.use").data.reason, undefined);
});

const failedWith = (link, label) => {
  assert.ok(link, label);
  assert.equal(link.target, null, label);
  assert.deepEqual(link.candidates, [], label);
  assert.equal(link.data.reason, "invalid-code", label);
  assert.deepEqual(link.data.cause, { files: ["p/bad.go"] }, label);
};

test("safety: B1 types written in the receiver expression itself are involved", async () => {
  // The reviewer's acceptance cases (round 15). `r` gives every name a
  // name-only match elsewhere, so a missed cause shows as a candidate set.
  const { links } = await project({
    "go.mod": MOD,
    "p/bad.go": lines(
      "package p",
      "type T struct{}",
      "func (T) N() { (( }",
      "func (*T) M() {}",
    ),
    "p/ok.go": lines("package p", "func Id[X any](x X) X { return x }"),
    "r/r.go": lines(
      "package r",
      "type A struct{}",
      "func (A) N() {}",
      "func (A) M() {}",
      "type B struct{}",
      "func (B) N() {}",
      "func (B) M() {}",
    ),
    "q/q.go": lines(
      "package q",
      'import "example.com/m/p"',
      "type Box[X any] struct{ V X }",
      "func (b Box[X]) Get() X { return b.V }",
      "func F() {",
      "\tstruct{ p.T }{}.N()",
      "\tinterface{ Get() p.T }(nil).Get().N()",
      "\tvar arr [2]struct{ p.T }",
      "\tarr[1].N()",
      "\th := [](func() p.T){}",
      "\th[0]().N()",
      "\t(*p.T)(nil).M()",
      "\tvar b Box[*p.T]",
      "\tb.Get().M()",
      "\tp.Id[*p.T](nil).M()",
      "\tvar w struct{ F p.T }",
      "\tw.F.N()",
      "}",
    ),
  });
  for (const at of [
    "struct{ p.T }{}.N",
    "interface{ Get() p.T }(nil).Get().N",
    "arr[1].N",
    "h[0]().N",
    "*p.T",
    "(*p.T)(nil).M",
    "b.Get().M",
    "p.Id[*p.T](nil).M",
    "w.F.N",
  ])
    failedWith(
      links.find(
        (item) =>
          item.file === "q/q.go" && item.kind === "calls" && item.at === at,
      ),
      at,
    );
  // Control: the generic method and function themselves are valid and definite.
  const at = (text) =>
    links.find(
      (item) =>
        item.file === "q/q.go" && item.kind === "calls" && item.at === text,
    );
  assert.equal(at("b.Get").target, "q/q.go:method:(Box).Get");
  assert.equal(at("p.Id").target, "p/ok.go:function:Id");
});

test("safety: B3 a failed build-variant alternative and a failed container fail the value", async () => {
  // GOOS picks one New; on linux its result's type is in the failed file.
  const { links } = await project({
    "go.mod": MOD,
    "p/bad.go": lines(
      "package p",
      "type T struct{}",
      "type S []*T",
      "func (*T) M() { (( }",
    ),
    "p/ok.go": lines("package p", "type U struct{}", "func (*U) M() {}"),
    "p/v_linux.go": lines("package p", "func New() *T { return nil }"),
    "p/v_windows.go": lines("package p", "func New() *U { return nil }"),
    "q/q.go": lines(
      "package q",
      'import "example.com/m/p"',
      "func F(s p.S) {",
      "\tp.New().M()",
      "\ts[0].M()",
      "\tfor _, e := range s { e.M() }",
      "}",
    ),
  });
  for (const at of ["p.New().M", "s[0].M", "e.M"])
    failedWith(
      links.find(
        (item) =>
          item.file === "q/q.go" && item.kind === "calls" && item.at === at,
      ),
      at,
    );
});

test("(i) dispatch where a failed file could declare a member says so", async () => {
  const files = (bad) => ({
    "go.mod": MOD,
    "p/i.go": lines(
      "package p",
      "type I interface{ M() }",
      "type J interface{ N() }",
      "type A struct{}",
      "func (A) M() {}",
      "func Use(i I, j J) { i.M(); j.N() }",
    ),
    ...(bad
      ? {
          "p/bad.go": lines(
            "package p",
            "type B struct{}",
            "func (B) N() {}",
            "func F() { (( }",
          ),
        }
      : {}),
    "r/r.go": lines(
      "package r",
      'import "example.com/m/p"',
      "func Use(i p.I) { i.M() }",
    ),
    // A clean package: a type in p's failed file may still implement S.
    "s/s.go": lines(
      "package s",
      "type S interface{ M() }",
      "type C struct{}",
      "func (C) M() {}",
      "func Use(x S) { x.M() }",
    ),
  });
  const reasons = (link) => link.data.open?.reasons ?? [link.data.open?.reason];
  let { links } = await project(files(true));
  assert.ok(
    reasons(call(links, "s/s.go", "x.M")).includes(
      "declarations-may-be-unseen",
    ),
  );
  // A set with valid members: open, and its members may be unseen.
  for (const file of ["p/i.go", "r/r.go"]) {
    const set = call(links, file, "i.M");
    assert.ok(set.candidates.includes("p/i.go:method:(A).M"), file);
    assert.ok(reasons(set).includes("declarations-may-be-unseen"), file);
  }
  // Its only implementer was in the failed file: unresolved, with that reason.
  const lone = call(links, "p/i.go", "j.N");
  assert.equal(lone.target, null);
  assert.deepEqual(lone.candidates, []);
  assert.deepEqual(lone.data.open, { reason: "declarations-may-be-unseen" });
  // Control: no failed file, no such reason.
  ({ links } = await project(files(false)));
  assert.ok(
    !reasons(call(links, "s/s.go", "x.M")).includes(
      "declarations-may-be-unseen",
    ),
  );
  assert.ok(
    !reasons(call(links, "p/i.go", "i.M")).includes(
      "declarations-may-be-unseen",
    ),
  );
  assert.equal(call(links, "p/i.go", "j.N").data.open, undefined);
  // A directory whose only file failed may declare an implementer too.
  ({ links } = await project({
    "go.mod": MOD,
    "t/bad.go": lines("package t", "func F() { (( }"),
    "s/s.go": files(false)["s/s.go"],
  }));
  assert.ok(
    reasons(call(links, "s/s.go", "x.M")).includes(
      "declarations-may-be-unseen",
    ),
  );
});

test("(i) a sealed interface a failed file's package reaches: unseen, never outside implementers", async () => {
  const files = (bad) => ({
    "go.mod": MOD,
    "internal/x/x.go": lines(
      "package x",
      "type I interface{ M(); h() }",
      "type Carrier struct{}",
      "func (Carrier) M() {}",
      "func (Carrier) h() {}",
      "func Use(v I) { v.M() }",
    ),
    "internal/x/z/z.go": lines(
      "package z",
      'import "example.com/m/internal/x"',
      "type Z struct{ x.Carrier }",
      "var _ x.I = Z{}",
    ),
    ...(bad
      ? { "internal/x/z/bad.go": lines("package z", "func F() { (( }") }
      : {}),
  });
  // Z's method set is unknown while z has a failed file; only the project can
  // implement I (unexported h), so no outside implementer is claimed.
  let { links } = await project(files(true));
  assert.deepEqual(call(links, "internal/x/x.go", "v.M").data.open, {
    reason: "declarations-may-be-unseen",
    reasons: ["declarations-may-be-unseen", "structural-match-unverified"],
  });
  ({ links } = await project(files(false)));
  assert.deepEqual(call(links, "internal/x/x.go", "v.M").data.open, {
    reason: "structural-match-unverified",
  });
});
