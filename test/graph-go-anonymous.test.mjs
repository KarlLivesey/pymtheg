// W2-B2 post-merge review item 3: a value of anonymous struct type, reached
// by any route, keeps the round-16 guard. A named field follows only its own
// type, and the embedded types are followed only for a member that is not a
// named field. Every fixture passes `go build ./...` (Go 1.27.4) with the
// failing line removed from p/bad.go.
import assert from "node:assert/strict";
import { test } from "node:test";
import { project } from "./fixtures/graph-go/harness.mjs";

const MOD = "module example.com/m\n\ngo 1.22\n";
const lines = (...items) => [...items, ""].join("\n");
const ST = "struct{ p.T; B *bytes.Buffer }";
// [route, declarations, the value expression]
const ROUTES = [
  ["package var", `var S ${ST}`, "S"],
  ["local var", `var s ${ST}`, "s"],
  ["local var, address taken", `var s ${ST}\n\t_ = &s`, "s"],
  ["parameter", "", "arg"],
  ["result", "", "mk()"],
  ["func value result", "", "fv()"],
  ["field of another struct", "", "o.in"],
  ["array element", `var a [2]${ST}`, "a[1]"],
  ["slice element", `var sl []${ST}`, "sl[0]"],
  ["map element", `var m map[string]${ST}`, `m["a"]`],
  ["channel element", `var c chan ${ST}`, "(<-c)"],
  ["range value", `var sl []${ST}`, "v", true],
  ["pointer to it", "", "ptr"],
  ["alias", "var al AL", "al"],
  ["composite literal", "", `${ST}{}`],
  ["conversion", `var s ${ST}`, `${ST}(s)`],
];
const file = (route, decls, expr, range, member) =>
  [
    "package q",
    "import (",
    '\t"bytes"',
    '\t"example.com/m/p"',
    ")",
    `type AL = ${ST}`,
    `type O struct{ in ${ST} }`,
    `func mk() ${ST} { return ${ST}{} }`,
    `func Use(arg ${ST}, fv func() ${ST}, o O, ptr *${ST}) {`,
    ...(decls ? [`\t${decls}`] : []),
    range
      ? `\tfor _, v := range sl {\n\t\t${expr}${member}\n\t}`
      : `\t${expr}${member}`,
    "}",
    "",
  ].join("\n");
const bad = (broken) =>
  [
    "package p",
    "type T struct{}",
    "func (T) M() {}",
    broken ? "func Broken() { (( }" : "",
    "",
  ].join("\n");

const link = (links, at) =>
  links.find(
    (item) => item.file === "q/q.go" && item.kind === "calls" && item.at === at,
  );

test("every route to an anonymous struct: a named field is clean, an embedded member fails", async () => {
  assert.equal(ROUTES.length, 16);
  for (const [route, decls, expr, range] of ROUTES) {
    // The named field B does not depend on p.T: plainly unresolved (bytes is
    // outside the project), exactly as with bad.go fixed.
    for (const broken of [true, false]) {
      const { links } = await project({
        "go.mod": MOD,
        "p/bad.go": bad(broken),
        "q/q.go": file(route, decls, expr, range, ".B.Write(nil)"),
      });
      const found = link(links, `${expr}.B.Write`);
      assert.ok(found, route);
      assert.equal(found.target, null, route);
      assert.equal(
        found.data.reason,
        undefined,
        `${route} (broken: ${broken})`,
      );
      assert.equal(found.data.cause, undefined, route);
    }
    // M can only come from the embedded p.T: it needs the failed file.
    const { links } = await project({
      "go.mod": MOD,
      "p/bad.go": bad(true),
      "q/q.go": file(route, decls, expr, range, ".M()"),
    });
    const found = link(links, `${expr}.M`);
    assert.ok(found, route);
    assert.equal(found.data.reason, "invalid-code", route);
    assert.deepEqual(found.data.cause, { files: ["p/bad.go"] }, route);
  }
});

test("the reviewer repro: a package-level var and a call result of anonymous struct type", async () => {
  for (const use of [
    lines(
      "var S struct{ p.T; B *bytes.Buffer }",
      "func Use() { S.B.Write(nil) }",
    ),
    lines(
      "func mk() struct{ p.T; B *bytes.Buffer } { return struct{ p.T; B *bytes.Buffer }{} }",
      "func Use() { mk().B.Write(nil) }",
    ),
  ]) {
    const { links } = await project({
      "go.mod": MOD,
      "p/bad.go": lines("package p", "type T struct{}", "func Broken() { (( }"),
      "q/q.go": lines(
        "package q",
        "import (",
        '\t"bytes"',
        '\t"example.com/m/p"',
        ")",
        use,
      ),
    });
    const write = links.find(
      (item) => item.kind === "calls" && item.at.endsWith(".B.Write"),
    );
    assert.equal(write.data.reason, undefined, use);
  }
});

test("backlog: an alias of an anonymous struct, and an alias of a map", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/bad.go": lines(
      "package p",
      "type T struct{}",
      "func (T) M() {}",
      "func Broken() { (( }",
    ),
    "q/q.go": lines(
      "package q",
      "import (",
      '\t"bytes"',
      '\t"time"',
      '\t"example.com/m/p"',
      ")",
      "type W = struct{ F p.T; bytes.Buffer }",
      "type MT = map[p.T]time.Time",
      "func Use(w W, m MT) {",
      "\tw.Write(nil)",
      "\tw.F.M()",
      "\tfor _, v := range m {",
      "\t\tv.IsZero()",
      "\t}",
      "}",
    ),
  });
  // Write comes from the embedded bytes.Buffer; F (a failed type) is a named
  // field, not embedded. The map's key failed, but only the value is used.
  assert.equal(link(links, "w.Write").data.reason, undefined);
  assert.equal(link(links, "v.IsZero").data.reason, undefined);
  // The named field F is itself of the failed type.
  assert.equal(link(links, "w.F.M").data.reason, "invalid-code");
});

test("backlog: a name-only set that a failed file could extend says so", async () => {
  const files = (bad) => ({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type A struct{}",
      "func (A) Wait() error { return nil }",
      "func (A) wait() {}",
      "type B struct{}",
      "func (B) Wait() error { return nil }",
      "func (B) wait() {}",
      "func Run(j interface{ Wait() error }) { j.Wait() }",
      "func Hidden(h interface{ wait() }) { h.wait() }",
    ),
    ...bad,
  });
  const reasons = (link) =>
    link.data.open?.reasons ?? (link.data.open ? [link.data.open.reason] : []);
  const at = (links, text) =>
    links.find((item) => item.kind === "calls" && item.at === text);
  const UNSEEN = "declarations-may-be-unseen";
  // A failed file in another package may declare an exported Wait, never p's
  // unexported wait.
  let { links } = await project(
    files({
      "r/r.go": lines("package r", "func Ok() {}"),
      "r/bad.go": lines("package r", "func Broken() { (( }"),
    }),
  );
  assert.equal(at(links, "j.Wait").candidates.length, 2);
  assert.deepEqual(reasons(at(links, "j.Wait")), [
    "receiver-type-unknown",
    UNSEEN,
  ]);
  assert.deepEqual(reasons(at(links, "h.wait")), ["receiver-type-unknown"]);
  // In p itself: both.
  ({ links } = await project(
    files({ "p/bad.go": lines("package p", "func Broken() { (( }") }),
  ));
  assert.ok(reasons(at(links, "h.wait")).includes(UNSEEN));
  // Control: no failed file.
  ({ links } = await project(files({})));
  assert.deepEqual(reasons(at(links, "j.Wait")), ["receiver-type-unknown"]);
});
