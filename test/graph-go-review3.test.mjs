// Regressions for the third W2-B review: candidate sets are honest about whether
// they are complete. Item numbers follow the review.
import assert from "node:assert/strict";
import { test } from "node:test";
import { call, project } from "./fixtures/graph-go/harness.mjs";

const MOD = "module example.com/m\n\ngo 1.22\n";
const lines = (...items) => [...items, ""].join("\n");
/** Dispatch the old rules closed: open now only because membership is unverified. */
const SEALED = { reason: "structural-match-unverified" };
const OPEN_EXTERNAL = {
  reason: "external-implementers-possible",
  reasons: ["external-implementers-possible", "structural-match-unverified"],
};
const OPEN_UNKNOWN = { reason: "receiver-type-unknown" };

test("1a: dispatch on an interface outside types could satisfy is marked open; unexported-method interfaces are closed", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      'import "os"',
      "type Closer interface{ Close() error }",
      "type Sealed interface{ Close() error; sealed() }",
      "type Both interface{ Closer; More() }",
      "type Local struct{}",
      "func (Local) Close() error { return nil }",
      "func (Local) sealed() {}",
      "func (Local) More() {}",
      "type Other struct{}",
      "func (Other) Close() error { return nil }",
      "func (Other) sealed() {}",
      "func Use(c Closer, s Sealed, b Both) { c.Close(); s.Close(); b.Close() }",
      "func Example(f *os.File) { Use(f, Local{}, Local{}) }",
      "func Gen[T Closer](x T) { x.Close() }",
      "func Reassigned(c Closer, l Local) { f := l.Close; f = c.Close; f() }",
      "func Sure(s Sealed, l Local) { f := l.More; f = l.More; f() }",
    ),
  });
  const open = (at) => call(links, "p/p.go", at).data.open;
  // Closer: all methods exported, *os.File satisfies it: open.
  assert.deepEqual(call(links, "p/p.go", "c.Close").candidates.length, 3);
  assert.deepEqual(open("c.Close"), OPEN_EXTERNAL);
  // Sealed has an unexported method, but it is exported, so an outside type can embed
  // it (or the exported Local/Other, which carry `sealed`) and override Close: open.
  // The closed branches are tested in graph-go-review4.test.mjs.
  assert.deepEqual(call(links, "p/p.go", "s.Close").candidates, [
    "p/p.go:method:(Local).Close",
    "p/p.go:method:(Other).Close",
    "p/p.go:method:Sealed.Close",
  ]);
  assert.deepEqual(open("s.Close"), OPEN_EXTERNAL);
  // Embedded interfaces count: Both's methods are all exported.
  assert.deepEqual(open("b.Close"), OPEN_EXTERNAL);
  // Type-parameter constraint dispatch.
  assert.deepEqual(open("x.Close"), OPEN_EXTERNAL);
  // A reassigned value whose alternatives include a dispatch set.
  const reassigned = links.find(
    (link) =>
      link.kind === "calls" && link.at === "f" && link.candidates.length,
  );
  assert.deepEqual(reassigned.data.open, OPEN_EXTERNAL);
});

test("1a: a closed interface whose implementer wraps an open interface is open", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type Inner interface{ M() }",
      "type Sealed interface{ M(); sealed() }",
      "type C struct{}",
      "func (C) M() {}",
      "type Wrap struct{ Inner }",
      "func (Wrap) sealed() {}",
      "type Plain struct{}",
      "func (Plain) M() {}",
      "func (Plain) sealed() {}",
      "func Use(s Sealed) { s.M() }",
    ),
  });
  const link = call(links, "p/p.go", "s.M");
  assert.ok(link.candidates.includes("p/p.go:method:(C).M"));
  assert.deepEqual(link.data.open, OPEN_EXTERNAL);
});

test("1b: a name-only set holds every project method of the name, in any package and test file; always open", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type A struct{}",
      "func (A) Wait() error { return nil }",
      "type B struct{}",
      "func (B) Wait() error { return nil }",
      "func Run(j interface{ Wait() error }) { j.Wait() }",
      "func Hidden(h interface{ wait() }) { h.wait() }",
      "type H1 struct{}",
      "func (H1) wait() {}",
      "type H2 struct{}",
      "func (H2) wait() {}",
    ),
    "p/p_test.go": lines(
      "package p",
      "type TestJob struct{}",
      "func (*TestJob) Wait() error { return nil }",
    ),
    "q/q.go": lines(
      "package q",
      'import "example.com/m/p"',
      "type Q struct{}",
      "func (Q) Wait() error { return nil }",
      "func (Q) wait() {}",
      "func Main() { p.Run(Q{}) }",
    ),
  });
  const run = call(links, "p/p.go", "j.Wait");
  assert.deepEqual(run.candidates, [
    "p/p.go:method:(A).Wait",
    "p/p.go:method:(B).Wait",
    "p/p_test.go:method:(*TestJob).Wait",
    "q/q.go:method:(Q).Wait",
  ]);
  assert.deepEqual(run.data.open, OPEN_UNKNOWN);
  // Unexported: q's `wait` is a different identifier; only package p's.
  assert.deepEqual(call(links, "p/p.go", "h.wait").candidates, [
    "p/p.go:method:(H1).wait",
    "p/p.go:method:(H2).wait",
  ]);
  assert.deepEqual(call(links, "p/p.go", "h.wait").data.open, OPEN_UNKNOWN);
});

test("1b: a name-only set over the cap is unresolved with the overflow note, not open", async () => {
  const types = Array.from(
    { length: 21 },
    (_, index) => `type T${index} struct{}\nfunc (T${index}) Spin() {}`,
  ).join("\n");
  const { links } = await project({
    "go.mod": MOD,
    "a/a.go": lines("package a", types),
    "b/b.go": lines(
      "package b",
      "func Use(x interface{ Spin() }) { x.Spin() }",
    ),
  });
  const link = call(links, "b/b.go", "x.Spin");
  assert.deepEqual(link.candidates, []);
  assert.deepEqual(link.data.overflow, { candidates: 21, cap: 20 });
  assert.equal(link.data.open, undefined);
});

test("1c: dispatch and name-only sets agree on test-file and cross-package methods", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type Job interface{ Wait() error }",
      "type A struct{}",
      "func (A) Wait() error { return nil }",
      "func Run1(j interface{ Wait() error }) { j.Wait() }",
      "func Run2(j Job) { j.Wait() }",
    ),
    "p/p_test.go": lines(
      "package p",
      "type TestJob struct{}",
      "func (TestJob) Wait() error { return nil }",
    ),
    "q/q.go": lines(
      "package q",
      "type Q struct{}",
      "func (Q) Wait() error { return nil }",
    ),
  });
  const byName = links.find(
    (link) =>
      link.kind === "calls" &&
      link.at === "j.Wait" &&
      link.data.open?.reason === "receiver-type-unknown",
  );
  const dispatch = links.find(
    (link) =>
      link.kind === "calls" &&
      link.at === "j.Wait" &&
      link.data.open?.reason === "external-implementers-possible",
  );
  const methods = (link) =>
    link.candidates.filter((id) => !id.endsWith(":method:Job.Wait"));
  assert.deepEqual(methods(byName), methods(dispatch));
  assert.deepEqual(methods(dispatch), [
    "p/p.go:method:(A).Wait",
    "p/p_test.go:method:(TestJob).Wait",
    "q/q.go:method:(Q).Wait",
  ]);
});

test("2: a shadowed builtin's result is the declared function's, never the builtin's", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/decl.go": lines(
      "package p",
      "type A struct{}",
      "func (A) M() {}",
      "type B struct{}",
      "func (B) M() {}",
      "func append(a A) B { return B{} }",
      "func make(a A) B { return B{} }",
      "func len(a A) B { return B{} }",
      "func min(a, b A) B { return B{} }",
    ),
    "p/use.go": lines(
      "package p",
      "func Use(a A, v int) {",
      "\tx := append(a)",
      "\tx.M()",
      "\ty := make(a)",
      "\ty.M()",
      "\tz := len(a)",
      "\tz.M()",
      "\tw := min(a, a)",
      "\tw.M()",
      "}",
    ),
    "q/q.go": lines(
      "package q",
      "type A struct{}",
      "func (A) M() {}",
      "type B struct{}",
      "func (B) M() {}",
      "func Real(xs []A, v int) {",
      "\ts := append(xs, A{})",
      "\ts[0].M()",
      "\tm := make([]A, 1)",
      "\tm[0].M()",
      "\tp := new(A)",
      "\tp.M()",
      "}",
      "func Local(a A) {",
      "\tnew := func(A) B { return B{} }",
      "\tn := new(a)",
      "\tn.M()",
      "}",
    ),
    "r/r.go": lines(
      "package r",
      "type A struct{}",
      "func (A) M() {}",
      "type B struct{}",
      "func (B) M() {}",
      "func new(a A) B { return B{} }",
      "func Use(a A) { n := new(a); n.M() }",
    ),
  });
  for (const at of ["x.M", "y.M", "z.M", "w.M"])
    assert.equal(
      call(links, "p/use.go", at).target,
      "p/decl.go:method:(B).M",
      at,
    );
  // The builtins themselves keep their evident results.
  assert.equal(call(links, "q/q.go", "s[0].M").target, "q/q.go:method:(A).M");
  assert.equal(call(links, "q/q.go", "m[0].M").target, "q/q.go:method:(A).M");
  assert.equal(call(links, "q/q.go", "p.M").target, "q/q.go:method:(A).M");
  // Local shadowing: a func-valued local returning B.
  assert.equal(call(links, "q/q.go", "n.M").target, "q/q.go:method:(B).M");
  // Package-level `new` in the same file.
  assert.equal(call(links, "r/r.go", "n.M").target, "r/r.go:method:(B).M");
});

test("3: in a workspace, a versioned replace applies only to the workspace-wide selected version", async () => {
  const base = {
    "old/go.mod": "module example.com/dep\n",
    "old/d.go": "package dep\nfunc Run() {}\n",
    "a/a.go": 'package a\nimport "example.com/dep"\nfunc A() { dep.Run() }\n',
    "b/b.go": 'package b\nimport "example.com/dep"\nfunc B() { dep.Run() }\n',
  };
  const run = async (aVersion, bVersion) => {
    const { links } = await project({
      ...base,
      "go.work": "go 1.22\nuse ./a\nuse ./b\n",
      "a/go.mod": `module example.com/a\ngo 1.22\nrequire example.com/dep ${aVersion}\nreplace example.com/dep v1.3.0 => ../old\n`,
      "b/go.mod": `module example.com/b\ngo 1.22\nrequire example.com/dep ${bVersion}\n`,
    });
    return [
      call(links, "a/a.go", "dep.Run").target,
      call(links, "b/b.go", "dep.Run").target,
    ];
  };
  // b requires v1.4.0: the workspace selects v1.4.0, so the v1.3.0 replace is off.
  assert.deepEqual(await run("v1.3.0", "v1.4.0"), [null, null]);
  // Both require v1.3.0: selected, replaced for both.
  assert.deepEqual(await run("v1.3.0", "v1.3.0"), [
    "old/d.go:function:Run",
    "old/d.go:function:Run",
  ]);
  // b requires an older version: the maximum is still v1.3.0.
  assert.deepEqual(await run("v1.3.0", "v1.2.9"), [
    "old/d.go:function:Run",
    "old/d.go:function:Run",
  ]);
  // A pre-release sorts before its release: v1.3.0 is the maximum.
  assert.deepEqual(await run("v1.3.0", "v1.3.0-rc.1"), [
    "old/d.go:function:Run",
    "old/d.go:function:Run",
  ]);
  // Not a semantic version: selection is not established.
  assert.deepEqual(await run("v1.3.0", "latest"), [null, null]);
});

test("4: calls through named func types use the type's declared results", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type prod struct{}",
      "func (*prod) Wait() {}",
      "type other struct{}",
      "func (*other) Wait() {}",
      "type mk func() *prod",
      "type Job interface{ Wait() }",
      "type mkJob func() Job",
      "type R struct{ named mk; job mkJob }",
      "func Use(r R, f mk, g func() *prod) {",
      "\tr.named().Wait()",
      "\tf().Wait()",
      "\tg().Wait()",
      "\tr.job().Wait()",
      "}",
    ),
  });
  for (const at of ["r.named().Wait", "f().Wait", "g().Wait"])
    assert.equal(
      call(links, "p/p.go", at).target,
      "p/p.go:method:(*prod).Wait",
      at,
    );
  // A named func type returning an interface: interface dispatch, not a name guess.
  const job = call(links, "p/p.go", "r.job().Wait");
  assert.ok(job.candidates.includes("p/p.go:method:Job.Wait"));
  assert.deepEqual(job.data.open, OPEN_EXTERNAL);
});

test("5: predeclared values are never extracted as references", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "const c = iota",
      "func TS(x interface{}) bool {",
      "\tswitch x.(type) {",
      "\tcase nil:",
      "\t}",
      "\tvar b = true",
      "\treturn b && false && x != nil",
      "}",
    ),
  });
  const names = links
    .filter((link) => link.kind === "references")
    .map((link) => link.at);
  for (const value of ["nil", "true", "false", "iota"])
    assert.ok(!names.includes(value), `${value}: ${names.join()}`);
});

test("1a: an implementer that cannot be proven (external embedded type) is still in the open dispatch set", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      'import "sync"',
      "type Printer interface{ P() }",
      "type Progress interface {",
      "\tScannerError() error",
      "\tPrinter",
      "\tsealed()",
      "}",
      "type text struct{}",
      "func (text) ScannerError() error { return nil }",
      "func (text) P() {}",
      "func (text) sealed() {}",
      "type Wrong struct{}",
      "func (Wrong) ScannerError() int { return 0 }",
      "func (Wrong) sealed() {}",
      "func Use(p Progress) { p.ScannerError() }",
    ),
    "p/mock_test.go": lines(
      "package p",
      'import "sync"',
      "type mockPrinter struct {",
      "\tsync.Mutex",
      "\tPrinter",
      "}",
      "func (*mockPrinter) ScannerError() error { return nil }",
      "func (*mockPrinter) sealed() {}",
    ),
  });
  const link = call(links, "p/p.go", "p.ScannerError");
  // mockPrinter's P comes from Printer at depth 1, beside external sync.Mutex: not
  // provable, so no definite implements link, but it may be the target.
  assert.ok(
    !links.some(
      (item) => item.kind === "implements" && item.at.startsWith("mockPrinter"),
    ),
  );
  assert.deepEqual(link.candidates, [
    "p/mock_test.go:method:(*mockPrinter).ScannerError",
    "p/p.go:method:(text).ScannerError",
    "p/p.go:method:Progress.ScannerError",
  ]);
  // Negative: a mismatched signature refutes Wrong. mockPrinter is not a proven
  // implementer, so the set is open (and Progress is exported anyway).
  assert.deepEqual(link.data.open, OPEN_EXTERNAL);
});

test("1a: when the called method itself may come from an external embedded type, the set is open", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      'import "sync"',
      "type Sealed interface{ Lock(); sealed() }",
      "type Own struct{}",
      "func (Own) Lock() {}",
      "func (Own) sealed() {}",
      "type Other struct{}",
      "func (Other) Lock() {}",
      "func (Other) sealed() {}",
      "type viaMutex struct{ sync.Mutex }",
      "func (viaMutex) sealed() {}",
      "func Use(s Sealed) { s.Lock() }",
    ),
  });
  const link = call(links, "p/p.go", "s.Lock");
  assert.deepEqual(link.candidates, [
    "p/p.go:method:(Other).Lock",
    "p/p.go:method:(Own).Lock",
    "p/p.go:method:Sealed.Lock",
  ]);
  // viaMutex may implement Sealed with sync.Mutex's Lock, which is not in the graph.
  assert.deepEqual(link.data.open, OPEN_EXTERNAL);
});
