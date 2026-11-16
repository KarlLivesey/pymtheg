// SPDX-License-Identifier: MIT
// Regressions for the fourth W2-B review: the exact meaning of OPEN and CLOSED.
// Every set lists every possible project target; "open" excuses only targets
// outside the project; a closed set is provably complete with only provable members.
import assert from "node:assert/strict";
import { test } from "node:test";
import { call, project } from "./fixtures/graph-go/harness.mjs";

const MOD = "module example.com/m\n\ngo 1.22\n";
const lines = (...items) => [...items, ""].join("\n");
/** Dispatch the old rules closed: open now only because membership is unverified. */
const SEALED = { reason: "structural-match-unverified" };
const OPEN = {
  reason: "external-implementers-possible",
  reasons: ["external-implementers-possible", "structural-match-unverified"],
};

test("1: an implementer whose selection is uncertain keeps the project method it could select", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      'import "sync"',
      "type I interface{ M(); N() }",
      "type A struct{}",
      "func (A) M() {}",
      "type B struct{}",
      "func (B) M() {}",
      "func (B) N() {}",
      "type Wrap struct {",
      "\tA",
      "\tsync.Mutex",
      "}",
      "func (Wrap) N() {}",
      "func Use(i I) { i.M() }",
      "func Run() { Use(Wrap{}) }",
    ),
  });
  const link = call(links, "p/p.go", "i.M");
  // Wrap's M: A.M (promoted) unless sync.Mutex had an M; A.M must be listed.
  assert.deepEqual(link.candidates, [
    "p/p.go:method:(A).M",
    "p/p.go:method:(B).M",
    "p/p.go:method:I.M",
  ]);
  assert.deepEqual(link.data.open, OPEN);
});

/** Indexes one sealed-interface scenario and returns the `x.M` link of package p. */
async function sealedCase(files, dir = "p") {
  const { links } = await project({ "go.mod": MOD, ...files });
  return call(links, `${dir}/p.go`, "x.M");
}
const sealedPackage = (pkg, ...extra) =>
  lines(
    `package ${pkg}`,
    "type i interface{ M(); sealed() }",
    "type a struct{}",
    "func (a) M() {}",
    "func (a) sealed() {}",
    "type b struct{}",
    "func (b) M() {}",
    "func (b) sealed() {}",
    ...extra,
    "func Use(x i) { x.M() }",
  );

test("2: a dispatch set is closed only when no outside type can obtain the unexported method", async () => {
  // Closed: unexported interface, only unexported carriers.
  let link = await sealedCase({ "p/p.go": sealedPackage("p") });
  assert.equal(link.candidates.length, 3);
  assert.deepEqual(link.data.open, SEALED);
  // Open: the interface itself is exported (outside code can embed it).
  link = await sealedCase({
    "p/p.go": sealedPackage("p")
      .replace(/\bi\b/g, "I")
      .replace("Use(x I)", "Use(x I)"),
  });
  assert.deepEqual(link.data.open, OPEN);
  // Open: an exported type carries the method (the testing.TB pattern).
  link = await sealedCase({
    "p/p.go": sealedPackage(
      "p",
      "type Pub struct{}",
      "func (Pub) M() {}",
      "func (Pub) sealed() {}",
    ),
  });
  assert.deepEqual(link.data.open, OPEN);
  // Open: an exported struct embeds an unexported carrier, so it carries `sealed`.
  link = await sealedCase({
    "p/p.go": sealedPackage("p", "type Outer struct{ a }"),
  });
  assert.deepEqual(link.data.open, OPEN);
  // Open: an exported alias names a carrier.
  link = await sealedCase({
    "p/p.go": sealedPackage("p", "type Alias = a"),
  });
  assert.deepEqual(link.data.open, OPEN);
  // Open: an exported interface embeds the sealed one.
  link = await sealedCase({
    "p/p.go": sealedPackage("p", "type Wider interface{ i }"),
  });
  assert.deepEqual(link.data.open, OPEN);
  // Closed: an exported carrier only in a test file cannot be imported from outside.
  link = await sealedCase({
    "p/p.go": sealedPackage("p"),
    "p/p_test.go": lines("package p", "type Pub struct{ a }"),
  });
  assert.deepEqual(link.data.open, SEALED);
});

test("2: package main and internal packages seal exported interfaces", async () => {
  const exportedSealed = (pkg) =>
    lines(
      `package ${pkg}`,
      "type I interface{ M(); sealed() }",
      "type A struct{}",
      "func (A) M() {}",
      "func (A) sealed() {}",
      "type B struct{}",
      "func (B) M() {}",
      "func (B) sealed() {}",
      "func Use(x I) { x.M() }",
    );
  let link = await sealedCase({ "p/p.go": exportedSealed("main") });
  assert.equal(link.candidates.length, 3);
  assert.deepEqual(link.data.open, SEALED);
  link = await sealedCase(
    { "lib/internal/p/p.go": exportedSealed("p") },
    "lib/internal/p",
  );
  assert.deepEqual(link.data.open, SEALED);
  // The same package outside internal/ is open.
  link = await sealedCase({ "p/p.go": exportedSealed("p") });
  assert.deepEqual(link.data.open, OPEN);
});

test("3: types that cannot supply another package's unexported method are ruled out", async () => {
  const sealed = (pkg) =>
    lines(
      `package ${pkg}`,
      'import (\n\t"io"\n\t"sync"\n)',
      "type Sealed interface{ Do(); hidden() }",
      "type T struct{}",
      "func (T) Do() {}",
      "func (T) hidden() {}",
      "type U struct{}",
      "func (U) Do() {}",
      "func (U) hidden() {}",
      "type MuMock struct{ sync.Mutex }",
      "func (MuMock) Do() {}",
      "type RC struct{ io.ReadCloser }",
      "func (RC) Do() {}",
      "func UseS(s Sealed) { s.Do() }",
    );
  const qr = lines(
    "package q",
    'import "io"',
    "type QR struct{ io.Reader }",
    "func (QR) Do() {}",
  );
  // Exported Sealed in a public package (fifth review, item 2): outside code can
  // reach a carrier of `hidden` (Sealed itself, T, U), so an external type may have
  // inherited it; MuMock, RC and q.QR embed external types and cannot be ruled out.
  let { links } = await project({
    "go.mod": MOD,
    "p/p.go": sealed("p"),
    "q/q.go": qr,
  });
  let link = call(links, "p/p.go", "s.Do");
  assert.deepEqual(link.candidates, [
    "p/p.go:method:(MuMock).Do",
    "p/p.go:method:(RC).Do",
    "p/p.go:method:(T).Do",
    "p/p.go:method:(U).Do",
    "p/p.go:method:Sealed.Do",
    "q/q.go:method:(QR).Do",
  ]);
  assert.deepEqual(link.data.open, OPEN);
  // In an internal package it is closed, with the same members.
  ({ links } = await project({
    "go.mod": MOD,
    "x/internal/p/p.go": sealed("p"),
    "q/q.go": qr,
  }));
  link = call(links, "x/internal/p/p.go", "s.Do");
  assert.deepEqual(link.candidates, [
    "x/internal/p/p.go:method:(T).Do",
    "x/internal/p/p.go:method:(U).Do",
    "x/internal/p/p.go:method:Sealed.Do",
  ]);
  assert.deepEqual(link.data.open, SEALED);
});

test("3: dispatch members come from the static interface, not an embedded one", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "x/internal/p/p.go": lines(
      "package p",
      "type E interface{ M() }",
      "type I interface{ E; hidden() }",
      "type A struct{}",
      "func (A) M() {}",
      "func (A) hidden() {}",
      "type A2 struct{}",
      "func (A2) M() {}",
      "func (A2) hidden() {}",
      "type B struct{}",
      "func (B) M() {}",
      "func U(i I) { i.M() }",
    ),
  });
  const link = call(links, "x/internal/p/p.go", "i.M");
  // B lacks `hidden`: it is not an I, so it is not listed; the set is closed.
  assert.deepEqual(link.candidates, [
    "x/internal/p/p.go:method:(A).M",
    "x/internal/p/p.go:method:(A2).M",
    "x/internal/p/p.go:method:E.M",
  ]);
  assert.deepEqual(link.data.open, SEALED);
});

test("invariant: no dispatch set is closed, and every member matches the static interface by name", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "x/internal/p/p.go": lines(
      "package p",
      'import "sync"',
      "type E interface{ M() }",
      "type Seal interface{ E; hidden() }",
      "type Loose interface{ M() }",
      "type A struct{}",
      "func (A) M() {}",
      "func (A) hidden() {}",
      "type B struct{}",
      "func (B) M() {}",
      "type Mu struct{ sync.Mutex }",
      "func (Mu) hidden() {}",
      "type Wrap struct{ A; sync.Mutex }",
      "func (Wrap) hidden() {}",
      "type Seal2 interface{ M2(); hidden2() }",
      "type C struct{}",
      "func (C) M2() {}",
      "func (C) hidden2() {}",
      "type D struct{}",
      "func (D) M2() {}",
      "func (D) hidden2() {}",
      "func Seal_(x Seal) { x.M() }",
      "type Seal3 interface{ M3(); N3(); hidden3() }",
      "type E3 struct{}",
      "func (E3) M3() {}",
      "func (E3) N3() {}",
      "func (E3) hidden3() {}",
      "type X3 struct{ sync.Mutex }",
      "func (X3) M3() {}",
      "func (X3) hidden3() {}",
      "func Seal2_(x Seal2) { x.M2() }",
      "func Seal3_(x Seal3) { x.M3() }",
      "func Loose_(x Loose) { x.M() }",
      "func E_(x E) { x.M() }",
    ),
  });
  const implemented = new Set(
    links
      .filter((link) => link.kind === "implements")
      .map((link) => `${link.at.split(" ")[0]}->${link.targetName}`),
  );
  // No-toolchain fallback: every dispatch set is open; a set the earlier rules
  // closed says so with only `structural-match-unverified`, and its members are
  // types matched by name (and count) to the static interface.
  let sealedSeen = 0;
  for (const link of links.filter(
    (item) => item.kind === "calls" && item.candidates.length,
  )) {
    const iface = link.data.expr.x.t?.n;
    if (!iface) continue;
    assert.ok(link.data.open, `${iface} set is open`);
    if (link.data.open.reason !== "structural-match-unverified") continue;
    sealedSeen++;
    for (const member of link.candidates) {
      const type = /:method:\(\*?(\w+)\)/.exec(member)?.[1];
      if (!type) continue; // the interface method itself
      assert.ok(
        implemented.has(`${type}->${iface}`),
        `${type} in sealed ${iface} set`,
      );
    }
  }
  assert.ok(sealedSeen >= 1, "the fixture has a set the earlier rules closed");
  // Wrap may implement Seal (A.M promoted unless sync.Mutex has M): unproven, so the
  // Seal set lists A.M and is open; the Seal2 set is closed.
  const seal = links.find(
    (link) => link.kind === "calls" && link.data.expr.x.t?.n === "Seal",
  );
  assert.ok(seal.candidates.includes("x/internal/p/p.go:method:(A).M"));
  assert.deepEqual(seal.data.open, OPEN);
  const seal2 = call(links, "x/internal/p/p.go", "x.M2");
  assert.deepEqual(seal2.data.open, SEALED);
  // X3 has its own M3, but N3 could only come from sync.Mutex: not ruled out, not
  // proven. It is listed (its M3 may be the target) and the sealed set is open.
  const seal3 = call(links, "x/internal/p/p.go", "x.M3");
  assert.ok(seal3.candidates.includes("x/internal/p/p.go:method:(X3).M3"));
  assert.deepEqual(seal3.data.open, OPEN);
});

test("4: predeclared names declared by the package keep their references; real ones are not extracted", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/decl.go": lines(
      "package p",
      "var nil = 7",
      "const true = 8",
      "const false = 9",
      "const iota = 10",
      "type error struct{ Code int }",
      "func (error) Describe() {}",
      "type string int",
      "var len = 3",
    ),
    "p/use.go": lines(
      "package p",
      "func Read() int { return nil + true + false + iota }",
      "func Typed(e error) { e.Describe(); _ = e.Code }",
      "func Convert(v int) string { return string(v) }",
      "func Value() int { n := len; return n }",
      "func Local() { nil := 1; _ = nil }",
    ),
    "q/q.go": lines(
      "package q",
      "func Real(v interface{}) bool { var e error; _ = e; return v == nil && true }",
    ),
    "t/t.go": lines(
      "package t",
      "func Plain(v interface{}) bool { return v == nil }",
    ),
    "t/t_test.go": lines(
      "package t",
      "var nil = 0",
      "func TestUse() int { return nil }",
    ),
  });
  const refs = (file) =>
    links
      .filter((link) => link.file === file && link.kind !== "contains")
      .map((link) => `${link.kind} ${link.at} -> ${link.target}`);
  const read = refs("p/use.go");
  for (const [name, kind] of [
    ["nil", "var"],
    ["true", "const"],
    ["false", "const"],
    ["iota", "const"],
  ])
    assert.ok(
      read.includes(`references ${name} -> p/decl.go:${kind}:${name}`),
      `${name}: ${read.join("; ")}`,
    );
  // Shadowed predeclared types and functions: one mechanism.
  assert.ok(
    read.includes("references error -> p/decl.go:struct:error"),
    read.join("; "),
  );
  assert.equal(
    call(links, "p/use.go", "e.Describe").target,
    "p/decl.go:method:(error).Describe",
  );
  assert.ok(
    read.includes("calls string -> p/decl.go:type:string"),
    read.join("; "),
  );
  assert.ok(
    read.includes("references len -> p/decl.go:var:len"),
    read.join("; "),
  );
  // Negative controls: a local `nil`, and packages that do not redeclare anything.
  assert.equal(
    read.filter((item) => item.startsWith("references nil")).length,
    1,
  );
  assert.deepEqual(refs("q/q.go"), []);
  // A test-file declaration shadows only for that package's test files.
  assert.deepEqual(refs("t/t.go"), []);
  assert.deepEqual(refs("t/t_test.go"), [
    "references nil -> t/t_test.go:var:nil",
  ]);
});

test("4: shadowing follows declarations added or removed in another file", async () => {
  const [before, after, back] = await project(
    {
      "go.mod": MOD,
      "p/use.go": "package p\nfunc Read() bool { return true }\n",
    },
    [
      { "p/decl.go": "package p\nconst true = false\n" },
      { "p/decl.go": "package p\n" },
    ],
  );
  const reads = (state) =>
    state.links
      .filter((link) => link.file === "p/use.go" && link.kind === "references")
      .map((link) => `${link.at} -> ${link.target}`);
  assert.deepEqual(reads(before), []);
  assert.deepEqual(after.report.indexed, 1);
  assert.deepEqual(reads(after), ["true -> p/decl.go:const:true"]);
  assert.deepEqual(reads(back), []);
});

test("dispatch on an interface whose implementers wrap an embedded interface value lists that interface's implementations", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type Printer interface{ P() }",
      "type Progress interface {",
      "\tUpdate()",
      "\tPrinter",
      "}",
      "type noop struct{}",
      "func (noop) P() {}",
      "type term struct{}",
      "func (term) P() {}",
      "type text struct{ Printer }",
      "func (text) Update() {}",
      "type json struct{ Printer }",
      "func (json) Update() {}",
      "func Use(p Progress) { p.P() }",
    ),
  });
  // text and json get P from their embedded Printer value: any Printer may run.
  const link = call(links, "p/p.go", "p.P");
  assert.deepEqual(link.candidates, [
    "p/p.go:method:(noop).P",
    "p/p.go:method:(term).P",
    "p/p.go:method:Printer.P",
  ]);
  assert.deepEqual(link.data.open, OPEN);
});
