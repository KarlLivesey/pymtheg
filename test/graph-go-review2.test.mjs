// Regressions for the second W2-B review: corner cases found by combining
// features. Item numbers follow the review.
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

test("1: an unexported interface method keeps its declaring package", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type I interface{ hidden() }",
      "type Right struct{}",
      "func (Right) hidden() {}",
    ),
    "q/q.go": lines(
      "package q",
      'import "example.com/m/p"',
      "type J interface{ p.I }",
      "type Wrong struct{}",
      "func (Wrong) hidden() {}",
      "type Promoted struct{ p.Right }",
      "type Local interface{ hidden() }",
    ),
  });
  const impl = implementsOf(links);
  // Negative: q.hidden is a different identifier from p.hidden.
  assert.ok(!impl.includes("Wrong->J"), impl.join());
  assert.ok(!impl.includes("Wrong->I"), impl.join());
  // Positive: p's own method satisfies both I and J (directly and promoted).
  assert.ok(
    impl.includes("Right->I") && impl.includes("Right->J"),
    impl.join(),
  );
  assert.ok(impl.includes("Promoted->J"), impl.join());
  // q's own unexported interface is satisfied by q's method only.
  assert.ok(impl.includes("Wrong->Local"), impl.join());
  assert.ok(!impl.includes("Right->Local"), impl.join());
  assert.ok(!impl.includes("Promoted->Local"), impl.join());
});

test("2: reassigned interface method values expand to every implementation", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type I interface{ M() }",
      "type A struct{}",
      "func (A) M() {}",
      "type B struct{}",
      "func (B) M() {}",
      "type Lonely interface{ N() }",
      "func Use(i I, a A, change bool) { f := i.M; if change { f = a.M }; f() }",
      "func Swap(i I, a A) { var f, g = a.M, i.M; f, g = g, f; g() }",
      "func Closure(i I, a A) { f := a.M; func() { f = i.M }(); f() }",
      "func None(l Lonely, a A) { f := a.M; f = l.N; f() }",
      "func Example() { Use(B{}, A{}, false) }",
    ),
  });
  const calls = (at) =>
    links.filter((link) => link.kind === "calls" && link.at === at);
  const dispatched = [
    "p/p.go:method:(A).M",
    "p/p.go:method:(B).M",
    "p/p.go:method:I.M",
  ];
  // f in Use, f in Closure: {A.M} ∪ dispatch(I.M) — B.M is never omitted.
  for (const link of calls("f").slice(0, 1)) {
    assert.equal(link.target, null);
    assert.deepEqual(link.candidates, dispatched);
  }
  const closure = calls("f")[1];
  assert.deepEqual(closure.candidates, dispatched);
  // Swap: an assignment cycle stays unresolved.
  assert.deepEqual(calls("g")[0].candidates, []);
  // None: an interface without implementations cannot list its targets → unresolved.
  const none = calls("f")[2];
  assert.equal(none.target, null);
  assert.deepEqual(none.candidates, []);
});

test("3: a version-specific replace applies only to that required version", async () => {
  const deps = {
    "old/go.mod": "module example.com/dep\n",
    "old/o.go": "package dep\nfunc F() {}\n",
    "main.go":
      'package main\nimport "example.com/dep"\nfunc main() { dep.F() }\n',
  };
  const target = (links) => call(links, "main.go", "dep.F").target;
  const cases = [
    // Negative: v1.2.0 is required, the replacement is for v1.1.0.
    [
      "module example.com/m\nrequire example.com/dep v1.2.0\nreplace example.com/dep v1.1.0 => ./old\n",
      null,
    ],
    // Positive: the replaced version is the required one.
    [
      "module example.com/m\nrequire example.com/dep v1.1.0\nreplace example.com/dep v1.1.0 => ./old\n",
      "old/o.go:function:F",
    ],
    // Positive: an unversioned replace applies to every version.
    [
      "module example.com/m\nrequire example.com/dep v1.2.0\nreplace example.com/dep => ./old\n",
      "old/o.go:function:F",
    ],
    // Not established: the module is not required in the captured go.mod.
    ["module example.com/m\nreplace example.com/dep v1.1.0 => ./old\n", null],
    // Block forms, with an indirect comment.
    [
      "module example.com/m\nrequire (\n\texample.com/dep v1.1.0 // indirect\n)\nreplace (\n\texample.com/dep v1.1.0 => ./old\n)\n",
      "old/o.go:function:F",
    ],
  ];
  for (const [gomod, expected] of cases) {
    const { links } = await project({ "go.mod": gomod, ...deps });
    assert.equal(target(links), expected, gomod);
  }
});

test("4: repeated interface embedding merges identical methods", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type I interface{ M() }",
      "type J interface{ I }",
      "type K interface{ I }",
      "type L interface{ J; K }",
      "type X interface{ M() int }",
      "type Bad interface{ I; X }",
      "type T struct{}",
      "func (T) M() {}",
      "type HasL struct{ L }",
      "func Use(l L, h HasL) { l.M(); h.M() }",
    ),
  });
  const impl = implementsOf(links);
  assert.ok(impl.includes("T->L"), impl.join());
  assert.ok(impl.includes("T->J") && impl.includes("T->K"), impl.join());
  // Negative: a union with conflicting signatures for M has no implementations.
  assert.ok(!impl.some((item) => item.endsWith("->Bad")), impl.join());
  // Dispatch on L, and through a struct embedding L, finds I.M once (not ambiguous).
  assert.deepEqual(call(links, "p/p.go", "l.M").candidates, [
    "p/p.go:method:(T).M",
    "p/p.go:method:I.M",
  ]);
  assert.deepEqual(call(links, "p/p.go", "h.M").candidates, [
    "p/p.go:method:(T).M",
    "p/p.go:method:I.M",
  ]);
});

test("5: a type-switch variable has the type of its case", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      'import "os"',
      "type A struct{}",
      "func (*A) Close() error { return nil }",
      "type B struct{}",
      "func (*B) Close() error { return nil }",
      "func TS(x interface{ Close() error }) {",
      "\tswitch v := x.(type) {",
      "\tcase *os.File:",
      "\t\tv.Close()",
      "\tcase *A:",
      "\t\tv.Close()",
      "\tcase *A, *B:",
      "\t\tv.Close()",
      "\tdefault:",
      "\t\tv.Close()",
      "\t}",
      "}",
      "func Known(b *B) {",
      "\tswitch w := interface{}(b).(type) {",
      "\tcase nil:",
      "\t\t_ = w",
      "\t}",
      "}",
    ),
  });
  const closes = links.filter(
    (link) => link.kind === "calls" && link.at === "v.Close",
  );
  assert.equal(closes.length, 4);
  // External case: unresolved, never project candidates.
  assert.equal(closes[0].target, null);
  assert.deepEqual(closes[0].candidates, []);
  // Project case: definite.
  assert.equal(closes[1].target, "p/p.go:method:(*A).Close");
  // Several types and default: the operand's own description (an anonymous
  // interface: the documented by-name set, which includes both).
  for (const link of closes.slice(2)) {
    assert.equal(link.target, null);
    assert.deepEqual(link.candidates, [
      "p/p.go:method:(*A).Close",
      "p/p.go:method:(*B).Close",
    ]);
  }
});

test("6: a qualifier that is no project import is external, whatever its path looks like", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "lib/x/x.go":
      "package xpkg\nfunc F() {}\ntype T struct{}\nfunc (T) Close() error { return nil }\n",
    "p/types.go": lines(
      "package p",
      "type A struct{}",
      "func (A) Close() error { return nil }",
      "func (A) Unmarshal() {}",
      "type B struct{}",
      "func (B) Close() error { return nil }",
      "func (B) Unmarshal() {}",
    ),
    "p/use.go": lines(
      "package p",
      'import (\n\t"github.com/minio/minio-go/v7"\n\t"gopkg.in/yaml.v3"\n\t"example.com/m/lib/x"\n)',
      "type holder struct{ obj *minio.Object }",
      "func Use(o *minio.Object, h holder, n yaml.Node, t xpkg.T) {",
      "\to.Close()",
      "\th.obj.Close()",
      '\tc, _ := minio.New("", nil)',
      "\tc.Close()",
      "\tn.Unmarshal()",
      "\td := yaml.NewDecoder(nil)",
      "\td.Unmarshal()",
      "\txpkg.F()",
      "\tt.Close()",
      "}",
    ),
  });
  for (const at of [
    "o.Close",
    "h.obj.Close",
    "c.Close",
    "n.Unmarshal",
    "d.Unmarshal",
  ]) {
    const link = call(links, "p/use.go", at);
    assert.equal(link.target, null, at);
    assert.deepEqual(link.candidates, [], at);
  }
  // A project package whose name differs from its directory still resolves.
  assert.equal(
    call(links, "p/use.go", "xpkg.F").target,
    "lib/x/x.go:function:F",
  );
  assert.equal(
    call(links, "p/use.go", "t.Close").target,
    "lib/x/x.go:method:(T).Close",
  );
});

test("7: calling an element of a function container is not a call of the container", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "func A() {}",
      "func B() {}",
      'var handlers = map[string]func(){"a": A}',
      "var fns = []func(){A, B}",
      "func Map[T any](v T) T { return v }",
      'func Use() { handlers["a"](); fns[0](); Map[int](1) }',
    ),
  });
  for (const at of ['handlers["a"]', "fns[0]"]) {
    const link = call(links, "p/p.go", at);
    assert.equal(link.target, null, at);
    assert.deepEqual(link.candidates, [], at);
  }
  const reference = (at) =>
    links.find((link) => link.kind === "references" && link.at === at);
  assert.equal(reference("handlers").target, "p/p.go:var:handlers");
  assert.equal(reference("fns").target, "p/p.go:var:fns");
  // Positive: an explicit generic instantiation calls the function.
  const generic = links.find(
    (link) => link.kind === "calls" && link.at.startsWith("Map"),
  );
  assert.equal(generic.target, "p/p.go:function:Map");
});

test("8: the builtin flag is set only when the builtin is what is called", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "func new(v int) int { return v }",
      // `new(1)` would misparse (tree-sitter-go reads `new(` as the builtin); an
      // identifier argument parses, as in restic's termstatus.
      "func Use(xs []int, v int) { _ = new(v); _ = len(xs); _ = make([]int, 0) }",
    ),
    "p/len_test.go": lines(
      "package p",
      "func len(v []int) int { return 0 }",
      "func T(xs []int) { _ = len(xs) }",
    ),
    "q/q.go": lines("package q", "func Use() { _ = new(int) }"),
  });
  const flag = (file, at) => call(links, file, at).data.builtin;
  assert.equal(flag("p/p.go", "new"), undefined);
  assert.equal(call(links, "p/p.go", "new").target, "p/p.go:function:new");
  // The test-only `len` shadows only for test files of the package.
  assert.equal(flag("p/p.go", "len"), true);
  assert.equal(flag("p/len_test.go", "len"), undefined);
  assert.equal(flag("p/p.go", "make"), true);
  assert.equal(flag("q/q.go", "new"), true);
});

test("8: the builtin flag follows a shadowing declaration added or removed elsewhere", async () => {
  const [before, after, back] = await project(
    {
      "go.mod": MOD,
      "p/use.go": "package p\nfunc Use() { _ = new(int) }\n",
    },
    [
      { "p/shadow.go": "package p\nfunc new(v int) int { return v }\n" },
      { "p/shadow.go": "package p\n" },
    ],
  );
  const flag = (state) => call(state.links, "p/use.go", "new").data.builtin;
  assert.equal(flag(before), true);
  assert.equal(flag(after), undefined);
  assert.equal(flag(back), true);
});

test("4: an interface embedding an external interface still selects its own project methods", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      'import "io"',
      "type Info struct{ Mode int }",
      "type File interface {",
      "\tio.Closer",
      "\tStat() (*Info, error)",
      "}",
      "func Use(f File) {",
      "\tfi, _ := f.Stat()",
      "\t_ = fi.Mode",
      "\tf.Close()",
      "}",
    ),
  });
  // Stat is declared in the project interface: its result type is known.
  assert.equal(
    links.find((link) => link.at === "fi.Mode").target,
    "p/p.go:field:Info.Mode",
  );
  // Close can only come from the external io.Closer: unresolved, no candidates.
  assert.equal(call(links, "p/p.go", "f.Close").target, null);
  assert.deepEqual(call(links, "p/p.go", "f.Close").candidates, []);
});

test("2: dispatch expands implementers whose method comes from an embedded interface", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type I interface{ M() }",
      "type Inner interface{ M() }",
      "type C struct{}",
      "func (C) M() {}",
      "type D struct{}",
      "func (D) M() {}",
      "type Wrap struct{ Inner }",
      "type Self struct{ I }",
      "func Use(i I) { i.M() }",
    ),
  });
  // Wrap's M is Inner.M: expanded to Inner's implementations (C, D); Self wraps I itself.
  assert.deepEqual(call(links, "p/p.go", "i.M").candidates, [
    "p/p.go:method:(C).M",
    "p/p.go:method:(D).M",
    "p/p.go:method:I.M",
    "p/p.go:method:Inner.M",
  ]);
});

test("2: an embedded interface whose implementations are unknown makes dispatch unresolved", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "q/q.go": lines(
      "package q",
      "type J interface{ M() }",
      "type Gen[T any] interface{ M() }",
      "type Opaque struct{ Gen[int] }",
      "func Use(j J) { j.M() }",
    ),
  });
  // Opaque implements J through generic Gen, whose implementations are not computed:
  // listing only J.M and Gen.M could omit the real target, so it is unresolved.
  assert.ok(
    links.some(
      (link) => link.kind === "implements" && link.at.startsWith("Opaque"),
    ),
  );
  assert.equal(call(links, "q/q.go", "j.M").target, null);
  assert.deepEqual(call(links, "q/q.go", "j.M").candidates, []);
});

test("5: each type in a type-switch case is linked exactly once", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type A struct{}",
      "type B struct{}",
      "func TS(x interface{}) {",
      "\tswitch x.(type) {",
      "\tcase *A, B:",
      "\t}",
      "}",
    ),
  });
  const refs = links
    .filter((link) => link.kind === "references")
    .map((link) => `${link.at}->${link.target}`)
    .sort();
  assert.deepEqual(refs, ["A->p/p.go:struct:A", "B->p/p.go:struct:B"]);
});
