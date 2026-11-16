// SPDX-License-Identifier: MIT
// Regressions for the sixth W2-B review: one structure function (`view`) for every
// kind of type, used by every consumer. Item numbers follow the review.
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
const base = (...extra) =>
  lines(
    "package p",
    "type i interface{ M(); hidden() }",
    "type a struct{}",
    "func (a) M() {}",
    "func (a) hidden() {}",
    "func Use(x i) { x.M() }",
    "type b struct{}",
    "func (b) M() {}",
    "type c struct{}",
    "func (c) hidden() {}",
    ...extra,
  );
const useM = async (source, file = "p/p.go") => {
  const { links } = await project({ "go.mod": MOD, [file]: source });
  return { link: call(links, file, "x.M"), links };
};

test("1: local types embedding local types are followed, scope-aware", async () => {
  for (const make of [
    "func Make() i { type lb struct{ b }; type lc struct{ c }; return struct{ lb; lc }{} }",
    "func Make() i { type lb struct{ b }; type lc struct{ c }; type l struct{ lb; lc }; return l{} }",
    "func Make() i { type inner struct{ b }; type outer struct{ inner; c }; return outer{} }",
    "func Make() i { type inner struct{ b }; return struct{ inner; c }{} }",
    "func Make() i { type inner struct{ b }; return &struct{ *inner; c }{} }",
  ]) {
    const { link } = await useM(base(make));
    assert.deepEqual(
      link.candidates,
      ["p/p.go:method:(a).M", "p/p.go:method:(b).M", "p/p.go:method:i.M"],
      make,
    );
    // Everything is unexported and every member is proven: closed.
    assert.deepEqual(link.data.open, SEALED, make);
  }
});

test("1: the same local name in two functions is two types; inner blocks shadow", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": base(
      "type x struct{}",
      "func (x) Other() {}",
      // t embeds b here (has M): the anonymous struct implements i.
      "func G1() i { type t struct{ b }; return struct{ t; c }{} }",
      // t embeds x here (no M): the anonymous struct does not implement i.
      "func G2() interface{} { type t struct{ x }; return struct{ t; c }{} }",
      // The inner t shadows the outer one inside the block.
      "func G3() interface{} {",
      "\ttype t struct{ b }",
      "\t{",
      "\t\ttype t struct{ x }",
      "\t\treturn struct{ t; c }{}",
      "\t}",
      "}",
    ),
  });
  const localImplements = links
    .filter((link) => link.kind === "implements" && link.targetName === "i")
    .map((link) => link.at)
    .filter((at) => at.startsWith("struct{"));
  // Only G1's anonymous struct (embedding G1's t, i.e. b) implements i.
  assert.equal(localImplements.length, 1);
});

test("2: defined types over interfaces and structs, in dispatch as in reachability", async () => {
  // type Bridge i: W gets i's method set (hidden) promoted through Bridge.
  let { link } = await useM(
    base(
      "type Bridge i",
      "type W struct{ Bridge }",
      "func (W) M() {}",
      "func Trigger() { Use(W{}) }",
    ),
  );
  assert.ok(
    link.candidates.includes("p/p.go:method:(W).M"),
    link.candidates.join(),
  );
  assert.deepEqual(link.data.open, OPEN); // Bridge is an exported carrier of hidden
  // type Bridge s2 (s2 a struct embedding a): fields and promoted methods kept.
  ({ link } = await useM(
    base(
      "type s2 struct{ a }",
      "type Bridge s2",
      "type W struct{ Bridge }",
      "func (W) M() {}",
    ),
  ));
  assert.ok(
    link.candidates.includes("p/p.go:method:(W).M"),
    link.candidates.join(),
  );
  // The other direction: a defined type does NOT get its underlying named type's
  // declared methods. d3's M/hidden are declared on s3, not promoted, so W2 (which
  // embeds the defined type) has no hidden and is not an i.
  ({ link } = await useM(
    base(
      "type s3 struct{}",
      "func (s3) M() {}",
      "func (s3) hidden() {}",
      "type d3 s3",
      "type w2 struct{ d3 }",
      "func (w2) M() {}",
    ),
  ));
  assert.ok(
    !link.candidates.includes("p/p.go:method:(w2).M"),
    link.candidates.join(),
  );
  assert.ok(link.candidates.includes("p/p.go:method:(s3).M"));
  assert.deepEqual(link.data.open, SEALED);
  // A defined type over an interface used as a static type dispatches on the interface.
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": base("type bridge i", "func UseB(y bridge) { y.M() }"),
  });
  const viaBridge = call(links, "p/p.go", "y.M");
  assert.deepEqual(viaBridge.candidates, [
    "p/p.go:method:(a).M",
    "p/p.go:method:i.M",
  ]);
  assert.deepEqual(viaBridge.data.open, SEALED);
});

test("3: type literals carry: aliases of struct/interface literals and embedded interface literals", async () => {
  for (const extra of [
    "type Pub = interface{ i }",
    "type Pub = struct{ a }",
    "type Pub interface{ interface{ i } }",
  ]) {
    const { link } = await useM(base(extra));
    assert.deepEqual(link.data.open, OPEN, extra);
  }
  // Control: the same literals under unexported names stay closed.
  for (const extra of [
    "type pub = interface{ i }",
    "type pub = struct{ a }",
    "type pub interface{ interface{ i } }",
  ]) {
    const { link } = await useM(base(extra));
    assert.deepEqual(link.data.open, SEALED, extra);
  }
  // Internal package re-exposed through an alias literal in a public package.
  const internal = lines(
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
  for (const facade of [
    "type Pub = interface{ p.I }",
    "type Pub = struct{ p.A }",
  ]) {
    const { links } = await project({
      "go.mod": MOD,
      "internal/p/p.go": internal,
      "api/api.go": lines(
        "package api",
        'import "example.com/m/internal/p"',
        facade,
      ),
    });
    assert.deepEqual(
      call(links, "internal/p/p.go", "x.M").data.open,
      OPEN,
      facade,
    );
  }
  const { links } = await project({
    "go.mod": MOD,
    "internal/p/p.go": internal,
  });
  assert.deepEqual(call(links, "internal/p/p.go", "x.M").data.open, SEALED);
});

test("4: an unknown structure opens the set, for every consumer", async () => {
  // Control: closed.
  let { link } = await useM(base());
  assert.deepEqual(link.data.open, SEALED);
  // Carrier reachability: an exported type whose structure is unknown might carry hidden.
  for (const extra of [
    "type Pub struct{ Missing }",
    "type Pub Missing",
    "type Pub = Missing",
  ]) {
    ({ link } = await useM(base(extra)));
    assert.deepEqual(link.data.open, OPEN, extra);
  }
  // Dispatch membership: an unexported type embedding an unknown type cannot be
  // ruled out; its own M is listed, unproven, and the set is open.
  ({ link } = await useM(base("type w struct{ Missing }", "func (w) M() {}")));
  assert.ok(
    link.candidates.includes("p/p.go:method:(w).M"),
    link.candidates.join(),
  );
  assert.deepEqual(link.data.open, OPEN);
  // A defined type of unknown structure embedded in a struct: the struct cannot be
  // ruled out either (its hidden may come from it).
  ({ link } = await useM(
    base("type d Missing", "type w struct{ d }", "func (w) M() {}"),
  ));
  assert.ok(
    link.candidates.includes("p/p.go:method:(w).M"),
    link.candidates.join(),
  );
  assert.deepEqual(link.data.open, OPEN);
  // implements: no definite link built on an unknown structure.
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": base(
      "type w struct{ Missing }",
      "func (w) M() {}",
      "type s struct{ Missing; a }",
      "func Sel(v s) { v.M() }",
    ),
  });
  assert.ok(
    !links.some(
      (item) => item.kind === "implements" && item.at.startsWith("w "),
    ),
  );
  // Member lookup: Missing at the same depth as a could declare M: unresolved.
  const sel = call(links, "p/p.go", "v.M");
  assert.equal(sel.target, null);
  assert.deepEqual(sel.candidates, []);
});

test("view: a defined type over a basic type has only its own methods (known, not unknown)", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type BlobType uint8",
      'func (BlobType) String() string { return "" }',
      "type Terminal interface{ Error(string); Print(string) }",
      "type HRESULT uint",
      "func (HRESULT) Error(string) {}",
      "type term struct{}",
      "func (term) Error(string) {}",
      "func (term) Print(string) {}",
      "type E error",
      "type viaE struct{ E }",
      "func (viaE) Print(string) {}",
      'func Use(t BlobType, x Terminal) { _ = t.String(); x.Error("") }',
    ),
  });
  assert.equal(
    call(links, "p/p.go", "t.String").target,
    "p/p.go:method:(BlobType).String",
  );
  // HRESULT has no Print and nothing it could inherit one from: ruled out.
  const dispatch = call(links, "p/p.go", "x.Error");
  assert.ok(
    !dispatch.candidates.includes("p/p.go:method:(HRESULT).Error"),
    dispatch.candidates.join(),
  );
  assert.ok(dispatch.candidates.includes("p/p.go:method:(term).Error"));
});

test("embeds links to function-local types resolve to the local symbol", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type Node struct{ Name string }",
      "func Print(n *Node) interface{} {",
      "\ttype findNode Node",
      "\treturn struct {",
      "\t\tPath string",
      "\t\t*findNode",
      "\t}{findNode: (*findNode)(n)}",
      "}",
    ),
  });
  const embeds = links.filter((link) => link.kind === "embeds");
  assert.deepEqual(
    embeds.map((link) => link.target),
    ["p/p.go:type:p.go:Print.findNode"],
  );
});
