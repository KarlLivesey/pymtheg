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
  // Round 16 ruling: type arguments are not followed. `X` is a type
  // parameter of Box; that it is instantiated with p.T is not modelled.
  const generic = links.find(
    (item) => item.file === "q/q.go" && item.at === "b.X.M",
  );
  assert.equal(generic.data.reason, undefined);
  assert.equal(generic.data.cause, undefined);
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

test("safety: B1 types written in the receiver expression itself are involved; the callee itself is not", async () => {
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
    "(*p.T)(nil).M",
    "w.F.N",
  ])
    failedWith(
      links.find(
        (item) =>
          item.file === "q/q.go" && item.kind === "calls" && item.at === at,
      ),
      at,
    );
  // Controls (round 16 ruling). The anonymous-typed callee itself does not
  // depend on p.T, and type arguments are not followed: plainly unresolved.
  for (const text of [
    "interface{ Get() p.T }(nil).Get",
    "h[0]",
    "*p.T",
    "b.Get().M",
    "p.Id[*p.T](nil).M",
  ]) {
    const link = links.find(
      (item) =>
        item.file === "q/q.go" && item.kind === "calls" && item.at === text,
    );
    assert.ok(link, text);
    assert.equal(link.data.reason, undefined, text);
    assert.equal(link.data.cause, undefined, text);
  }
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

test("round 16 B1: a cause only where the dependence is certain", async () => {
  // Each snippet passes `go build` with bad.go fixed (Go 1.27.4).
  const { links } = await project({
    "go.mod": MOD,
    "p/bad.go": lines(
      "package p",
      "type T struct{}",
      "func (T) M() {}",
      "func F() { (( }",
    ),
    "p/ok.go": lines("package p", "func G() {}"),
    "r/r.go": lines("package r", "type A struct{}", "func (A) N() {}"),
    "q/q.go": lines(
      "package q",
      "import (",
      '\t"bytes"',
      '\t"example.com/m/p"',
      '\t"example.com/m/r"',
      ")",
      "type Pair[L, R any] struct {",
      "\tL L",
      "\tR R",
      "}",
      "type S struct {",
      "\tp.T",
      "\tB bytes.Buffer",
      "}",
      "var gs S",
      "func Use(m map[p.T]*bytes.Buffer, k p.T, pr Pair[p.T, r.A], sl []S) {",
      "\tfor _, v := range m {",
      "\t\tv.Write(nil)",
      "\t}",
      "\tm[k].Write(nil)",
      "\tpr.R.N()",
      "\tgs.B.Write(nil)",
      "\tvar s S",
      "\tps := &s",
      "\tps.B.Write(nil)",
      "\ts.B.Write(nil)",
      "\tsl[0].B.Write(nil)",
      "\tvar x struct{ S }",
      "\tx.B.Write(nil)",
      "\tfor key := range m {",
      "\t\tkey.M()",
      "\t}",
      "}",
    ),
  });
  const at = (text) =>
    links.find(
      (item) =>
        item.file === "q/q.go" && item.kind === "calls" && item.at === text,
    );
  // The map's key type failed, but only the element is used.
  for (const text of [
    "v.Write",
    "m[k].Write",
    // A type argument failed: not followed.
    "pr.R.N",
    // A depth-0 named field beside an embedded failed type, on every route.
    "gs.B.Write",
    "ps.B.Write",
    "s.B.Write",
    "sl[0].B.Write",
    "x.B.Write",
  ]) {
    const link = at(text);
    assert.ok(link, text);
    assert.equal(link.data.reason, undefined, text);
    assert.equal(link.data.cause, undefined, text);
  }
  // The range key is the failed type: certain.
  assert.equal(at("key.M").data.reason, "invalid-code");
  assert.deepEqual(at("key.M").data.cause, { files: ["p/bad.go"] });
});

test("round 16 Sol: a used map value and a generic's other argument are what they are with the file fixed", async () => {
  const files = (broken) => ({
    "go.mod": MOD,
    "p/bad.go": lines(
      "package p",
      "type T struct{}",
      "func (T) M() {}",
      broken ? "func F() { (( }" : "func F() {}",
    ),
    "r/r.go": lines("package r", "type A struct{}", "func (A) M() {}"),
    "q/q.go": lines(
      "package q",
      "import (",
      '\t"time"',
      '\t"example.com/m/p"',
      '\t"example.com/m/r"',
      ")",
      "type Pair[F, S any] struct {",
      "\tFirst  F",
      "\tSecond S",
      "}",
      "func (v Pair[F, S]) Get() S { return v.Second }",
      "func F(m map[p.T]time.Time, key p.T, v Pair[p.T, r.A]) {",
      "\tvalue := m[key]",
      "\tvalue.IsZero()",
      "\tv.Second.M()",
      "\tv.Get().M()",
      "}",
    ),
  });
  const shape = (links, text) => {
    const link = links.find(
      (item) =>
        item.file === "q/q.go" && item.kind === "calls" && item.at === text,
    );
    assert.ok(link, text);
    return {
      target: link.target,
      candidates: link.candidates,
      reason: link.data.reason,
      cause: link.data.cause,
      open: link.data.open,
    };
  };
  const broken = (await project(files(true))).links;
  const fixed = (await project(files(false))).links;
  for (const text of ["value.IsZero", "v.Second.M", "v.Get().M"])
    assert.deepEqual(shape(broken, text), shape(fixed, text), text);
  assert.equal(shape(broken, "value.IsZero").reason, undefined);
});

test("round 16 B3: a directory whose every file failed still reaches a sealed interface", async () => {
  const files = (extra) => ({
    "go.mod": MOD,
    "a/internal/s/s.go": lines(
      "package s",
      "type Sealed interface{ M(); seal() }",
      "type impl struct{}",
      "func (impl) M() {}",
      "func (impl) seal() {}",
      "func Use(a Sealed) { a.M() }",
    ),
    ...extra,
  });
  const reasons = async (extra) => {
    const { links } = await project(files(extra));
    const open = call(links, "a/internal/s/s.go", "a.M").data.open;
    return open.reasons ?? [open.reason];
  };
  const bad = { "a/c/bad.go": lines("package c", "func Bad() { (( }") };
  // The failed file alone in its directory, and with a valid file beside it.
  assert.ok((await reasons(bad)).includes("declarations-may-be-unseen"));
  assert.ok(
    (
      await reasons({
        ...bad,
        "a/c/ok.go": lines("package c", "func Ok() {}"),
      })
    ).includes("declarations-may-be-unseen"),
  );
  // Control: a failed-only directory that may not import a/internal/s.
  assert.deepEqual(
    await reasons({ "b/bad.go": lines("package b", "func Bad() { (( }") }),
    ["structural-match-unverified"],
  );
});

test("round 16 Sol 4: combined decisions keep every property of every part", async () => {
  const reasonsOf = (link) =>
    link.data.open?.reasons ?? (link.data.open ? [link.data.open.reason] : []);
  const UNSEEN = "declarations-may-be-unseen";
  // The reviewer's repro: a reassigned interface method value.
  const repro = (bad) => ({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type I interface{ M() }",
      "type A struct{}",
      "func (A) M() {}",
      "func F(i I, a A, change bool) { f := i.M; if change { f = a.M }; f() }",
    ),
    ...(bad ? { "q/bad.go": lines("package q", "func Broken() { (( }") } : {}),
  });
  let { links } = await project(repro(true));
  const f = call(links, "p/p.go", "f");
  assert.deepEqual(f.candidates, ["p/p.go:method:(A).M", "p/p.go:method:I.M"]);
  assert.ok(reasonsOf(f).includes(UNSEEN));
  ({ links } = await project(repro(false)));
  assert.ok(!reasonsOf(call(links, "p/p.go", "f")).includes(UNSEEN));
  // Two interface method values: only one dispatch could gain an unseen
  // member (E is sealed and nothing lossy reaches internal/j); the union
  // keeps the reason.
  ({ links } = await project({
    "go.mod": MOD,
    "internal/j/j.go": lines(
      "package j",
      "type E interface{ M(); h() }",
      "type B struct{}",
      "func (B) M() {}",
      "func (B) h() {}",
      "type I interface{ M() }",
      "type A struct{}",
      "func (A) M() {}",
      "func F(i I, k E, change bool) { f := i.M; if change { f = k.M }; f() }",
      // The sealed E's dispatch first (by ID too): only a union keeps I's outside
      // implementers.
      "func G(i I, k E, change bool) { g := k.M; if change { g = i.M }; g() }",
    ),
    "q/bad.go": lines("package q", "func Broken() { (( }"),
  }));
  const both = call(links, "internal/j/j.go", "f");
  assert.ok(both.candidates.length >= 3, both.candidates.join());
  assert.ok(reasonsOf(both).includes(UNSEEN));
  const reversed = call(links, "internal/j/j.go", "g");
  assert.deepEqual(reversed.candidates, both.candidates);
  assert.ok(reasonsOf(reversed).includes("external-implementers-possible"));
  assert.ok(reasonsOf(reversed).includes(UNSEEN));
  // A part with no valid member (its only implementer was in the failed
  // file): the whole is unresolved, with that part's reason.
  ({ links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type I interface{ M() }",
      "type J interface{ N() }",
      "type A struct{}",
      "func (A) M() {}",
      "func F(i I, j J, change bool) { f := i.M; if change { f = j.N }; f() }",
    ),
    "p/bad.go": lines("package p", "type B struct{}", "func (B) N() { (( }"),
  }));
  const lone = call(links, "p/p.go", "f");
  assert.deepEqual(lone.candidates, []);
  assert.ok(reasonsOf(lone).includes(UNSEEN), JSON.stringify(lone.data));
});

test("round 16 Sol 4: the one combining function merges every field", async () => {
  const { combine } = await import("../dist/graph/languages/go/resolve.js");
  const a = {
    ids: ["x"],
    definite: false,
    limit: 50,
    open: ["structural-match-unverified"],
    dispatch: true,
  };
  const b = {
    ids: ["y", "x"],
    definite: false,
    limit: 20,
    open: ["external-implementers-possible", "declarations-may-be-unseen"],
    unseen: true,
  };
  assert.deepEqual(combine([a, b]), {
    ids: ["x", "y"],
    definite: false,
    limit: 20,
    open: [
      "structural-match-unverified",
      "external-implementers-possible",
      "declarations-may-be-unseen",
    ],
    dispatch: true,
    unseen: true,
  });
  // A part without targets leaves the whole without targets, keeping its
  // reasons; a failure fails the whole.
  assert.deepEqual(combine([a, { ids: [], definite: false, unseen: true }]), {
    ids: [],
    definite: false,
    limit: 50,
    open: ["structural-match-unverified"],
    dispatch: true,
    unseen: true,
  });
  assert.deepEqual(
    combine([a, { ids: [], definite: false, invalid: ["p/bad.go"] }]).ids,
    [],
  );
  assert.deepEqual(
    combine([a, { ids: [], definite: false, invalid: ["p/bad.go"] }]).invalid,
    ["p/bad.go"],
  );
  // Definite only if every part is.
  assert.equal(
    combine([
      { ids: ["x"], definite: true },
      { ids: ["x"], definite: true },
    ]).definite,
    true,
  );
});
