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
const ST = "struct{ p.T; B *bytes.Buffer; F p.T }";
// [route, declarations, the value expression]
const ROUTES = [
  ["package-level var", "", "PS"],
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
    `var PS ${ST}`,
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

test("every route to an anonymous struct value: a named field is clean, an embedded member or a failed field fails", async () => {
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
    // M can only come from the embedded p.T; the named field F is itself a
    // p.T. Both certainly need the failed file.
    for (const member of [".M()", ".F.M()"]) {
      const { links } = await project({
        "go.mod": MOD,
        "p/bad.go": bad(true),
        "q/q.go": file(route, decls, expr, range, member),
      });
      const found = link(links, `${expr}${member.replace("()", "")}`);
      assert.ok(found, `${route} ${member}`);
      assert.equal(found.data.reason, "invalid-code", `${route} ${member}`);
      assert.deepEqual(found.data.cause, { files: ["p/bad.go"] }, route);
    }
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

// PR 19 round 1 (Sol): every callable whose result type is written. Each
// fixture passes `go build ./... && go vet ./...` with p/bad.go fixed.
const CST = "struct{ p.T; B *bytes.Buffer; F p.T }";
// [route, declarations inside Use, the call expression]
const CALLABLES = [
  ["package-level function variable", "", "fn()"],
  ["local function variable", `var f func() ${CST}`, "f()"],
  ["local variable holding a declared function", "f := mk", "f()"],
  ["function parameter", "", "pf()"],
  ["named function type", "", "nf()"],
  ["named function type over a named function type", "", "n2()"],
  ["function-type alias", "", "af()"],
  ["package-level slice of functions", "", "fns[0]()"],
  ["array of functions", `var fa [2]func() ${CST}`, "fa[1]()"],
  ["map of functions", `var fm map[string]func() ${CST}`, 'fm["a"]()'],
  ["channel of functions", `var fc chan func() ${CST}`, "(<-fc)()"],
  ["function-typed field", "", "o.f()"],
  ["function-typed result", "", "mkf()()"],
  [
    "function literal called in place",
    "",
    `func() ${CST} { return ${CST}{} }()`,
  ],
  ["method", "", "h.Get()"],
  ["method value", "g := h.Get", "g()"],
  ["method expression", "", "H.Get(h)"],
];
const callFile = (decls, expr, member) =>
  [
    "package q",
    "import (",
    '\t"bytes"',
    '\t"example.com/m/p"',
    ")",
    `type FN func() ${CST}`,
    "type FN2 FN",
    `type FA = func() ${CST}`,
    `type O struct{ f func() ${CST} }`,
    "type H struct{}",
    `func (H) Get() ${CST} { return ${CST}{} }`,
    `var fn func() ${CST}`,
    `var fns []func() ${CST}`,
    `func mk() ${CST} { return ${CST}{} }`,
    `func mkf() func() ${CST} { return mk }`,
    `func Use(pf func() ${CST}, nf FN, n2 FN2, af FA, o O, h H) {`,
    ...(decls ? [`\t${decls}`] : []),
    `\t${expr}${member}`,
    "}",
    "",
  ].join("\n");

test("every callable returning an anonymous struct: a named field is clean, an embedded member or a failed field fails", async () => {
  assert.equal(CALLABLES.length, 17);
  for (const [route, decls, expr] of CALLABLES) {
    for (const broken of [true, false]) {
      const { links } = await project({
        "go.mod": MOD,
        "p/bad.go": bad(broken),
        "q/q.go": callFile(decls, expr, ".B.Write(nil)"),
      });
      const found = link(links, `${expr}.B.Write`);
      assert.ok(found, route);
      assert.equal(
        found.data.reason,
        undefined,
        `${route} (broken: ${broken})`,
      );
      assert.equal(found.data.cause, undefined, route);
    }
    for (const member of [".M()", ".F.M()"]) {
      const { links } = await project({
        "go.mod": MOD,
        "p/bad.go": bad(true),
        "q/q.go": callFile(decls, expr, member),
      });
      const found = link(links, `${expr}${member.replace("()", "")}`);
      assert.ok(found, `${route} ${member}`);
      assert.equal(found.data.reason, "invalid-code", `${route} ${member}`);
      assert.deepEqual(found.data.cause, { files: ["p/bad.go"] }, route);
    }
  }
});

test("the reviewer repro: a package-level function variable", async () => {
  for (const broken of [true, false]) {
    const { links } = await project({
      "go.mod": MOD,
      "p/p.go": lines(
        "package p",
        "type T struct{}",
        "func (T) M() {}",
        broken ? "func Broken() { (( }" : "",
      ),
      "q/q.go": lines(
        "package q",
        "import (",
        '\t"bytes"',
        '\t"example.com/m/p"',
        ")",
        "var fn func() struct{ p.T; B *bytes.Buffer }",
        "func U() { fn().B.Write(nil) }",
      ),
    });
    assert.equal(link(links, "fn().B.Write").data.reason, undefined);
  }
});

test("written type not recoverable (two build variants): a named field still never takes an embedded cause", async () => {
  // go build and go vet pass, for GOOS=linux and GOOS=windows, with p.go
  // fixed. `written` refuses two declarations; the walk still reaches the
  // anonymous struct, where B is its own named field (found at depth 0).
  const ST = "struct{ p.T; B *bytes.Buffer }";
  const imports = ["import (", '\t"bytes"', '\t"example.com/m/p"', ")"];
  for (const broken of [true, false]) {
    const { links } = await project({
      "go.mod": MOD,
      "p/p.go": lines(
        "package p",
        "type T struct{}",
        "func (T) M() {}",
        broken ? "func Broken() { (( }" : "",
      ),
      "q/v_linux.go": lines("package q", ...imports, `var fn func() ${ST}`),
      "q/v_windows.go": lines("package q", ...imports, `var fn func() ${ST}`),
      "q/q.go": lines("package q", "func U() { fn().B.Write(nil); fn().M() }"),
    });
    const at = (text) => links.find((item) => item.at === text);
    assert.equal(
      at("fn().B.Write").data.reason,
      undefined,
      `broken: ${broken}`,
    );
    assert.equal(
      at("fn().M").data.reason,
      broken ? "invalid-code" : undefined,
      `broken: ${broken}`,
    );
  }
});

// PR 19 round 1 (Opus): builtins, named and aliased func and container types,
// a local from new, a second result, a map key in range. Each fixture passes
// `go build ./... && go vet ./...` with p/bad.go fixed.
const ST2 = "struct{ p.T; B *bytes.Buffer; F p.T }";
// [route, declarations inside Use, the value expression, inside a range over km]
const ROUTES2 = [
  ["builtin new", "", `new(${ST2})`],
  ["builtin make", "", `make([]${ST2}, 1)[0]`],
  ["builtin append", "", `append(sl, ${ST2}{})[0]`],
  ["named func type", "", "ft()"],
  ["aliased func type", "", "fa()"],
  ["alias of a slice type", "", "sa[0]"],
  ["defined slice type", "", "ns[0]"],
  ["local initialised from new", `v := new(${ST2})`, "v"],
  ["second result", "_, s2 := mk2()", "s2"],
  ["map key in range", "", "k", true],
];
const file2 = (decls, expr, range, member) =>
  [
    "package q",
    "import (",
    '\t"bytes"',
    '\t"example.com/m/p"',
    ")",
    `type FT func() ${ST2}`,
    `type FA = func() ${ST2}`,
    `type SA = []${ST2}`,
    `type NS []${ST2}`,
    `func mk2() (int, ${ST2}) { return 0, ${ST2}{} }`,
    `func Use(ft FT, fa FA, sa SA, ns NS, sl []${ST2}, km map[${ST2}]int) {`,
    ...(decls ? [`\t${decls}`] : []),
    range
      ? `\tfor k := range km {\n\t\t${expr}${member}\n\t}`
      : `\t${expr}${member}`,
    "}",
    "",
  ].join("\n");

test("builtins, named types and other results: a named field is clean, an embedded member or a failed field fails", async () => {
  assert.equal(ROUTES2.length, 10);
  for (const [route, decls, expr, range] of ROUTES2) {
    for (const broken of [true, false]) {
      const { links } = await project({
        "go.mod": MOD,
        "p/bad.go": bad(broken),
        "q/q.go": file2(decls, expr, range, ".B.Write(nil)"),
      });
      const found = link(links, `${expr}.B.Write`);
      assert.ok(found, route);
      assert.equal(
        found.data.reason,
        undefined,
        `${route} (broken: ${broken})`,
      );
    }
    for (const member of [".M()", ".F.M()"]) {
      const { links } = await project({
        "go.mod": MOD,
        "p/bad.go": bad(true),
        "q/q.go": file2(decls, expr, range, member),
      });
      const found = link(links, `${expr}${member.replace("()", "")}`);
      assert.ok(found, `${route} ${member}`);
      assert.equal(found.data.reason, "invalid-code", `${route} ${member}`);
      assert.deepEqual(found.data.cause, { files: ["p/bad.go"] }, route);
    }
  }
});

test("written type not recoverable (an alias with two build variants): the type term keeps the guard", async () => {
  // go build and go vet pass, for GOOS=linux and GOOS=windows, with p.go
  // fixed. `written` refuses two declarations; the walk reaches the struct
  // through the alias's type term, where B is its own named field.
  const imports = ["import (", '\t"bytes"', '\t"example.com/m/p"', ")"];
  const alias = "type SA = []struct{ p.T; B *bytes.Buffer }";
  for (const broken of [true, false]) {
    const { links } = await project({
      "go.mod": MOD,
      "p/p.go": lines(
        "package p",
        "type T struct{}",
        "func (T) M() {}",
        broken ? "func Broken() { (( }" : "",
      ),
      "q/v_linux.go": lines("package q", ...imports, alias),
      "q/v_windows.go": lines("package q", ...imports, alias),
      "q/q.go": lines(
        "package q",
        "func U(sa SA) { sa[0].B.Write(nil); sa[0].M() }",
      ),
    });
    const at = (text) => links.find((item) => item.at === text);
    assert.equal(
      at("sa[0].B.Write").data.reason,
      undefined,
      `broken: ${broken}`,
    );
    assert.equal(
      at("sa[0].M").data.reason,
      broken ? "invalid-code" : undefined,
      `broken: ${broken}`,
    );
  }
});
