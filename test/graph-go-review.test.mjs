// Regressions for the first W2-B review: each case was a confidently wrong link
// or a candidate set missing the true target. Item numbers follow the review.
import assert from "node:assert/strict";
import { test } from "node:test";
import { call, project } from "./fixtures/graph-go/harness.mjs";

const MOD = "module example.com/m\n\ngo 1.22\n";
const lines = (...items) => [...items, ""].join("\n");
const implementsOf = (links) =>
  links
    .filter((link) => link.kind === "implements")
    .map(
      (link) =>
        `${link.at.split(" ")[0]}->${link.targetName}${link.data.pointerReceiver ? "*" : ""}`,
    )
    .sort();

test("1: a reassigned function value is the set of assigned values, or unresolved", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "func F() {}",
      "func G() {}",
      "type T struct{}",
      "func (T) A() {}",
      "func (T) B() {}",
      "func Once() { f := F; f() }",
      "func Twice() { f := F; f = G; f() }",
      "func Multi() { var f, g = F, G; f, g = g, f; f() }",
      "func Method(t T) { m := t.A; m = t.B; m() }",
      "func Closure() { f := F; func() { f = G }(); f() }",
      "func Address() { f := F; p := &f; _ = p; f() }",
      "func Param(f func()) { f = F; f() }",
      "func Redeclare() (int, error) { f, err := F, error(nil); f, err = G, nil; f(); return 0, err }",
    ),
  });
  const result = links
    .filter((link) => link.kind === "calls" && ["f", "m"].includes(link.at))
    .map((link) => [link.target, link.candidates]);
  assert.deepEqual(result, [
    // Positive: never reassigned.
    ["p/p.go:function:F", []],
    // Reassigned to G: both assigned values are candidates, never F alone.
    [null, ["p/p.go:function:F", "p/p.go:function:G"]],
    // Multi-assign swap: the values depend on each other (a cycle), so unresolved.
    [null, []],
    // Reassigned method values.
    [null, ["p/p.go:method:(T).A", "p/p.go:method:(T).B"]],
    // Written inside a closure.
    [null, ["p/p.go:function:F", "p/p.go:function:G"]],
    // Address taken: any value possible.
    [null, []],
    // A parameter's incoming value is unknown.
    [null, []],
    // `:=` redeclaration in the same scope is a write, not a new variable.
    [null, ["p/p.go:function:F", "p/p.go:function:G"]],
  ]);
});

test("2: promoted methods follow Go's depth rules; ambiguity and fields remove them", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type I interface{ M() }",
      "type A struct{}",
      "func (A) M() {}",
      "type B struct{}",
      "func (B) M() {}",
      "type Amb struct{ A; B }",
      "type Block struct{ A; M int }",
      "type Deep struct{ A }",
      "type Shallow struct{ X; B }",
      "type X struct{ Deep }",
      "type Own struct{ A; B }",
      "func (Own) M() {}",
      "func Use(a Amb, b Block, s Shallow, o Own) { a.M(); s.M(); o.M() }",
    ),
  });
  // Negative: Amb (two depth-1 M) and Block (field M at depth 0) do not implement I.
  // Positive: Shallow takes B.M at depth 1 over A.M at depth 3; Own declares M itself.
  assert.deepEqual(implementsOf(links), [
    "A->I",
    "B->I",
    "Deep->I",
    "Own->I",
    "Shallow->I",
    "X->I",
  ]);
  // Ambiguous selector: candidates, never a definite pick.
  assert.equal(call(links, "p/p.go", "a.M").target, null);
  assert.deepEqual(call(links, "p/p.go", "a.M").candidates, [
    "p/p.go:method:(A).M",
    "p/p.go:method:(B).M",
  ]);
  assert.equal(call(links, "p/p.go", "s.M").target, "p/p.go:method:(B).M");
  assert.equal(call(links, "p/p.go", "o.M").target, "p/p.go:method:(Own).M");
});

test("2: interface dispatch takes implementations from the same method sets", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type I interface{ M() }",
      "type A struct{}",
      "func (A) M() {}",
      "type B struct{}",
      "func (B) M() {}",
      "type Amb struct{ A; B }",
      "type Wrap struct{ B }",
      "func Use(i I) { i.M() }",
    ),
  });
  // Amb is not an implementer, Wrap's M is B's (promoted): no extra or wrong targets.
  assert.deepEqual(call(links, "p/p.go", "i.M").candidates, [
    "p/p.go:method:(A).M",
    "p/p.go:method:(B).M",
    "p/p.go:method:I.M",
  ]);
});

test("3: the same method reached by two embedding paths is ambiguous, not definite", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type I interface{ M() }",
      "type Base struct{}",
      "func (Base) M() {}",
      "type Left struct{ Base }",
      "type Right struct{ Base }",
      "type Outer struct{ Left; Right }",
      "type Single struct{ Left }",
      "func Use(o Outer, s Single) { o.M(); s.M() }",
    ),
  });
  const ambiguous = call(links, "p/p.go", "o.M");
  assert.equal(ambiguous.target, null);
  assert.deepEqual(ambiguous.candidates, []);
  assert.equal(call(links, "p/p.go", "s.M").target, "p/p.go:method:(Base).M");
  assert.ok(!implementsOf(links).includes("Outer->I"));
  assert.ok(implementsOf(links).includes("Single->I"));
});

test("4: an external embedded type at or above the match depth stops a definite answer", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      'import (\n\t"io"\n\t"strings"\n)',
      "type Lener interface{ Len() int }",
      "type Closer interface{ Close() error }",
      "type In3 struct{}",
      "func (In3) Len() int { return 0 }",
      "type Wrap struct{ In3 }",
      "type ExtShallow struct {",
      "\tstrings.Builder",
      "\tWrap",
      "}",
      "type Res struct{}",
      "func (Res) Close() error { return nil }",
      "type Both struct {",
      "\tRes",
      "\tio.Closer",
      "}",
      "type Own struct{ strings.Builder }",
      "func (Own) Len() int { return 1 }",
      "func Use(e ExtShallow, b Both, o Own, w Wrap) { e.Len(); b.Close(); o.Len(); w.Len() }",
    ),
  });
  assert.equal(call(links, "p/p.go", "e.Len").target, null);
  assert.deepEqual(call(links, "p/p.go", "e.Len").candidates, []);
  assert.equal(call(links, "p/p.go", "b.Close").target, null);
  assert.deepEqual(call(links, "p/p.go", "b.Close").candidates, []);
  // Positive: a depth-0 declaration beats any embedded type; no external involved.
  assert.equal(
    call(links, "p/p.go", "o.Len").target,
    "p/p.go:method:(Own).Len",
  );
  assert.equal(
    call(links, "p/p.go", "w.Len").target,
    "p/p.go:method:(In3).Len",
  );
  const impl = implementsOf(links);
  assert.ok(!impl.includes("ExtShallow->Lener"), impl.join());
  assert.ok(!impl.includes("Both->Closer"), impl.join());
  assert.ok(impl.includes("Own->Lener"));
  assert.ok(impl.includes("Wrap->Lener"));
});

test("5: embedded pointers put pointer-receiver methods in the value method set", async () => {
  const { links, symbols } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type I interface{ M() }",
      "type A struct{}",
      "func (*A) M() {}",
      "type ByPointer struct{ *A }",
      "type ByValue struct{ A }",
    ),
  });
  assert.deepEqual(implementsOf(links), [
    "A->I*",
    "ByPointer->I",
    "ByValue->I*",
  ]);
  const field = (name) =>
    symbols.find((symbol) => symbol.identity === `${name}.A`).data.pointer;
  assert.equal(field("ByPointer"), true);
  assert.equal(field("ByValue"), false);
});

test("6: imports resolve in the importing module's context and respect nested modules", async () => {
  const { links } = await project({
    "go.mod": lines("module example.com/m", "replace example.com/dep => ./one"),
    "sub/go.mod": "module example.com/sub\n",
    "sub/s.go": "package sub\nfunc S() {}\n",
    "nested/go.mod": "module example.com/nest\n",
    "nested/sub/n.go": "package sub\nfunc N() {}\n",
    "one/go.mod": "module example.com/dep\n",
    "one/d.go": "package dep\nfunc F() {}\n",
    "other/go.mod": lines(
      "module example.com/other",
      "replace example.com/dep => ./two",
    ),
    "other/two/go.mod": "module example.com/dep\n",
    "other/two/d.go": "package dep\nfunc F() {}\n",
    "other/o.go":
      'package other\nimport "example.com/dep"\nfunc O() { dep.F() }\n',
    "main.go": lines(
      "package main",
      'import (\n\t"example.com/m/sub"\n\t"example.com/m/nested/sub"\n\t"example.com/dep"\n)',
      "func main() { sub.S(); dep.F() }",
    ),
    "nested/x.go":
      'package nest\nimport "example.com/nest/sub"\nfunc X() { sub.N() }\n',
  });
  const imp = (file, path) =>
    links.find(
      (link) =>
        link.kind === "imports" &&
        link.file === file &&
        link.targetName === path,
    ).target;
  // Negative: those directories belong to other modules.
  assert.equal(imp("main.go", "example.com/m/sub"), null);
  assert.equal(imp("main.go", "example.com/m/nested/sub"), null);
  // Each go.mod's own replace applies to its own files.
  assert.equal(imp("main.go", "example.com/dep"), "one/d.go:package:dep");
  assert.equal(call(links, "main.go", "dep.F").target, "one/d.go:function:F");
  assert.equal(
    call(links, "other/o.go", "dep.F").target,
    "other/two/d.go:function:F",
  );
  // Positive: the nested module imports its own package.
  assert.equal(
    call(links, "nested/x.go", "sub.N").target,
    "nested/sub/n.go:function:N",
  );
});

test("6: go.work makes used modules main modules and its replaces apply", async () => {
  const { links } = await project({
    "go.work":
      "go 1.22\nuse (\n\t./a\n\t./b\n)\nreplace example.com/w => ./w\n",
    "a/go.mod": "module example.com/a\n",
    "a/a.go":
      'package a\nimport (\n\t"example.com/b"\n\t"example.com/w"\n)\nfunc A() { b.B(); w.W() }\n',
    "b/go.mod": "module example.com/b\n",
    "b/b.go": "package b\nfunc B() {}\n",
    "w/go.mod": "module example.com/w\n",
    "w/w.go": "package w\nfunc W() {}\n",
    "c/go.mod": "module example.com/c\n",
    "c/c.go": 'package c\nimport "example.com/b"\nfunc C() { b.B() }\n',
  });
  assert.equal(call(links, "a/a.go", "b.B").target, "b/b.go:function:B");
  assert.equal(call(links, "a/a.go", "w.W").target, "w/w.go:function:W");
  // Negative: c is not in the workspace; b would come from the module cache.
  assert.equal(call(links, "c/c.go", "b.B").target, null);
});

test("7: unexported members are only selectable from their own package", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type Inner struct{ secret int }",
      "func (Inner) hidden() {}",
      "type T struct{ Inner }",
      "func (T) private() {}",
      "func (T) Public() {}",
      "func Own(x T) { x.private(); x.hidden(); _ = x.secret }",
    ),
    "p/p_ext_test.go": lines(
      "package p_test",
      'import "example.com/m/p"',
      "func Ext() { var x p.T; x.private(); x.hidden(); _ = x.secret; x.Public() }",
    ),
    "q/q.go": lines(
      "package q",
      'import "example.com/m/p"',
      "func Q(x p.T) { x.private() }",
    ),
  });
  assert.equal(
    call(links, "p/p.go", "x.private").target,
    "p/p.go:method:(T).private",
  );
  assert.equal(
    call(links, "p/p.go", "x.hidden").target,
    "p/p.go:method:(Inner).hidden",
  );
  for (const [file, at] of [
    ["p/p_ext_test.go", "x.private"],
    ["p/p_ext_test.go", "x.hidden"],
    ["q/q.go", "x.private"],
  ]) {
    assert.equal(call(links, file, at).target, null, `${file} ${at}`);
    assert.deepEqual(call(links, file, at).candidates, [], `${file} ${at}`);
  }
  const secret = (file) =>
    links.find(
      (link) =>
        link.kind === "references" &&
        link.file === file &&
        link.at === "x.secret",
    ).target;
  assert.equal(secret("p/p.go"), "p/p.go:field:Inner.secret");
  assert.equal(secret("p/p_ext_test.go"), null);
  assert.equal(
    call(links, "p/p_ext_test.go", "x.Public").target,
    "p/p.go:method:(T).Public",
  );
});

test("8: values known to come from outside the project never get project candidates", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/types.go": lines(
      "package p",
      'import "os"',
      "type F struct{}",
      "func (F) Close() error { return nil }",
      "func (F) Done() {}",
      'func (F) Name() string { return "" }',
      "func (F) Wait() error { return nil }",
      "type G struct{}",
      "func (G) Close() error { return nil }",
      "func (G) Done() {}",
      'func (G) Name() string { return "" }',
      "func (G) Wait() error { return nil }",
      "type Holder struct{ file *os.File }",
    ),
    "p/use.go": lines(
      "package p",
      'import (\n\t"context"\n\t"os"\n\t"golang.org/x/sync/errgroup"\n)',
      "func Use(h Holder, files []*os.File, m map[string]*os.File, ch chan *os.File, any interface{}) {",
      '\tf, _ := os.Open("x")',
      "\tf.Close()",
      "\tctx := context.Background()",
      "\tctx.Done()",
      "\twg, _ := errgroup.WithContext(ctx)",
      "\twg.Wait()",
      "\th.file.Close()",
      "\tfor _, item := range files { item.Name() }",
      "\tfor _, v := range m { v.Name() }",
      "\tc := <-ch",
      "\tc.Close()",
      "\tfiles[0].Close()",
      "\tst, _ := f.Stat()",
      "\tst.Name()",
      "\tx := any.(*os.File)",
      "\tx.Close()",
      "\tl := os.File{}",
      "\tl.Close()",
      "\tmode := os.FileMode(0)",
      "\tmode.String()",
      "\tvar g G",
      "\tg.Close()",
      "\tfor _, u := range []interface{ Close() error }{} { u.Close() }",
      "}",
    ),
  });
  for (const at of [
    "f.Close",
    "ctx.Done",
    "wg.Wait",
    "h.file.Close",
    "item.Name",
    "v.Name",
    "c.Close",
    "files[0].Close",
    "st.Name",
    "x.Close",
    "l.Close",
    "mode.String",
  ]) {
    const link = call(links, "p/use.go", at);
    assert.equal(link.target, null, at);
    assert.deepEqual(link.candidates, [], at);
  }
  // Positive control: a project type still resolves.
  assert.equal(
    call(links, "p/use.go", "g.Close").target,
    "p/types.go:method:(G).Close",
  );
  // Ambiguous control: an anonymous interface value is genuinely unknown → project candidates
  // (documented: such a set may omit external implementations).
  assert.deepEqual(call(links, "p/use.go", "u.Close").candidates, [
    "p/types.go:method:(F).Close",
    "p/types.go:method:(G).Close",
  ]);
});

test("9: a call on a type-parameter value includes the constraint method, or is unresolved", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type Closer interface{ Close() error }",
      "type A struct{}",
      "func (A) Close() error { return nil }",
      "type B struct{}",
      "func (B) Close() error { return nil }",
      "func Gen[T Closer](v T) { v.Close() }",
      "func Any[T any](v T, w *T) { v.Close(); w.Close() }",
      "type Box[T Closer] struct{ v T }",
      "func (b Box[T]) Shut() { b.v.Close() }",
    ),
  });
  const constrained = links.find(
    (link) => link.at === "v.Close" && link.data.expr.x.c,
  );
  assert.equal(constrained.target, null);
  assert.deepEqual(constrained.candidates, [
    "p/p.go:method:(A).Close",
    "p/p.go:method:(B).Close",
    "p/p.go:method:Closer.Close",
  ]);
  const anyCalls = links.filter(
    (link) =>
      link.kind === "calls" &&
      ["v.Close", "w.Close"].includes(link.at) &&
      link.data.expr.x.k === "tval" &&
      !link.data.expr.x.c,
  );
  assert.equal(anyCalls.length, 2);
  for (const link of anyCalls) {
    assert.equal(link.target, null);
    assert.deepEqual(link.candidates, []);
  }
  // Generic struct field typed by a type parameter: receiver type params carry no constraint here.
  const field = call(links, "p/p.go", "b.v.Close");
  assert.equal(field.target, null);
  assert.ok(
    !field.candidates.length ||
      field.candidates.includes("p/p.go:method:Closer.Close"),
  );
});

test("10: a file with a syntax error has failed and contributes nothing", async () => {
  const { links, report, symbols } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "var pw = 1",
      "func err() {}",
      "func Broken() {",
      // A real syntax error (missing `)`). `new(io.NopCloser(x), y)` itself
      // parses since the vendored grammar (W2-S): a user-declared `new`.
      "\tterm := new(io.NopCloser(x), y",
      "\tpw, err := term.Read()",
      "\t_ = pw",
      "\terr()",
      "}",
      "func Fine() { err() }",
    ),
  });
  assert.deepEqual(report.failed, ["p/p.go"]);
  assert.deepEqual(symbols, []);
  assert.deepEqual(links, []);
});

test("interface dispatch keeps sets up to its own cap; unknown receivers keep the smaller cap", async () => {
  const types = (prefix, count, method) =>
    Array.from(
      { length: count },
      (_, index) =>
        `type ${prefix}${index} struct{}\nfunc (${prefix}${index}) ${method}() {}`,
    ).join("\n");
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type I interface{ M() }",
      types("T", 30, "M"),
      "type J interface{ N() }",
      types("U", 60, "N"),
      "func Use(i I, j J) { i.M(); j.N(); for _, x := range []interface{ M() }{} { x.M() } }",
    ),
  });
  // Under the cap: the complete set, with no overflow note.
  const listed = call(links, "p/p.go", "i.M");
  assert.equal(listed.candidates.length, 31);
  assert.equal(listed.data.overflow, undefined);
  // Over the cap: unresolved, name kept, never a truncated list; the reason is on the link.
  const dispatch = call(links, "p/p.go", "j.N");
  assert.equal(dispatch.target, null);
  assert.deepEqual(dispatch.candidates, []);
  assert.equal(dispatch.targetName, "j.N");
  assert.deepEqual(dispatch.data.overflow, { candidates: 61, cap: 50 });
  // 30 possible methods by name exceed the unknown-receiver cap of 20.
  const byName = call(links, "p/p.go", "x.M");
  assert.deepEqual(byName.candidates, []);
  assert.equal(byName.targetName, "x.M");
  assert.deepEqual(byName.data.overflow, { candidates: 30, cap: 20 });
});

test("the overflow reason distinguishes 'too many' from 'nothing found' and follows other files' changes", async () => {
  const method = (prefix, count) =>
    Array.from(
      { length: count },
      (_, index) =>
        `type ${prefix}${index} struct{}\nfunc (${prefix}${index}) Close() error { return nil }`,
    ).join("\n");
  const use = lines(
    "package p",
    'import "os"',
    "func Use(f *os.File) {",
    "\tfor _, c := range []interface{ Close() error }{} { c.Close() }",
    "\tf.Close()",
    "\tfor _, n := range []interface{ Nothing() }{} { n.Nothing() }",
    "}",
  );
  const [before, after, back] = await project(
    {
      "go.mod": MOD,
      "p/use.go": use,
      "p/a.go": lines("package p", method("A", 19)),
    },
    [
      { "p/b.go": lines("package p", method("B", 2)) },
      { "p/b.go": "package p\n" },
    ],
  );
  const close = (state) => call(state.links, "p/use.go", "c.Close");
  // 19 candidates: listed in full.
  assert.equal(close(before).candidates.length, 19);
  assert.equal(close(before).data.overflow, undefined);
  // Another file adds two more: use.go is unchanged, yet its link is now over the cap.
  assert.equal(after.report.indexed, 1);
  assert.deepEqual(close(after).candidates, []);
  assert.deepEqual(close(after).data.overflow, { candidates: 21, cap: 20 });
  // And back under the cap: the note disappears and the full list returns.
  assert.equal(close(back).candidates.length, 19);
  assert.equal(close(back).data.overflow, undefined);
  // "Nothing found" and "external receiver" are unresolved without an overflow note.
  for (const state of [before, after, back])
    for (const at of ["f.Close", "n.Nothing"]) {
      const link = call(state.links, "p/use.go", at);
      assert.equal(link.target, null, at);
      assert.deepEqual(link.candidates, [], at);
      assert.equal(link.data.overflow, undefined, at);
    }
});

test("range: one variable over a channel is its element; over a slice it is the index", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type R struct{ Blobs []int }",
      "func (R) Use() {}",
      "type S struct{}",
      "func (S) Use() {}",
      "func Each() <-chan R { return nil }",
      "func Use(rs []R) {",
      "\tfor r := range Each() { _ = r.Blobs; r.Use() }",
      "\tfor i := range rs { i.Use() }",
      "\tfor k, v := range map[R]R{} { k.Use(); v.Use() }",
      "}",
    ),
  });
  assert.equal(call(links, "p/p.go", "r.Use").target, "p/p.go:method:(R).Use");
  assert.equal(
    links.find((link) => link.at === "r.Blobs").target,
    "p/p.go:field:R.Blobs",
  );
  // Negative: a slice index is an int, never a project method.
  assert.equal(call(links, "p/p.go", "i.Use").target, null);
  assert.deepEqual(call(links, "p/p.go", "i.Use").candidates, []);
  assert.equal(call(links, "p/p.go", "k.Use").target, "p/p.go:method:(R).Use");
  assert.equal(call(links, "p/p.go", "v.Use").target, "p/p.go:method:(R).Use");
});
