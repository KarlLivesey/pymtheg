import assert from "node:assert/strict";
import { test } from "node:test";
import { call, one, project } from "./fixtures/graph-go/harness.mjs";

const MOD = "module example.com/m\n\ngo 1.22\n";

test("same-package functions resolve across files; other packages and test-only files do not", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "a/one.go": "package a\nfunc Run() { helper(); onlyInTests(); Other() }\n",
    "a/two.go": "package a\nfunc helper() {}\n",
    "a/a_test.go":
      "package a\nfunc onlyInTests() {}\nfunc TestX() { onlyInTests(); helper() }\n",
    "b/b.go": "package b\nfunc Other() {}\n",
  });
  assert.equal(
    call(links, "a/one.go", "helper").target,
    "a/two.go:function:helper",
  );
  // Negative: _test.go declarations are invisible to non-test files.
  assert.equal(call(links, "a/one.go", "onlyInTests").target, null);
  assert.equal(
    call(links, "a/a_test.go", "onlyInTests").target,
    "a/a_test.go:function:onlyInTests",
  );
  assert.equal(
    call(links, "a/a_test.go", "helper").target,
    "a/two.go:function:helper",
  );
  // Negative: a same-named function in another, unimported package.
  assert.equal(call(links, "a/one.go", "Other").target, null);
});

test("build-variant duplicates become candidates, never a chosen file", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/use.go": "package p\nfunc Use() { sys() }\n",
    "p/sys_linux.go": "package p\nfunc sys() {}\n",
    "p/sys_darwin.go": "package p\nfunc sys() {}\n",
  });
  const link = call(links, "p/use.go", "sys");
  assert.equal(link.target, null);
  assert.deepEqual(link.candidates, [
    "p/sys_darwin.go:function:sys",
    "p/sys_linux.go:function:sys",
  ]);
});

test("imports resolve by go.mod module path; stdlib, foreign prefixes, internal violations, main and testdata do not", async () => {
  const { links, symbols } = await project({
    "go.mod": MOD,
    "lib/x/x.go": "package xpkg\nfunc F() {}\n",
    "lib/internal/sec/sec.go": "package sec\nfunc S() {}\n",
    "tool/main.go": "package main\nfunc main() {}\n",
    "lib/testdata/fix/fix.go": "package fix\n",
    "app/app.go": [
      "package app",
      'import (\n\t"fmt"\n\t"example.com/m/lib/x"\n\t"other.com/m/lib/x"\n\t"example.com/m/lib/internal/sec"\n\t"example.com/m/tool"\n\t"example.com/m/lib/testdata/fix"\n\t"example.com/m/nothing"\n)',
      "func A() { xpkg.F(); fmt.Println() }",
      "",
    ].join("\n"),
    "lib/use.go":
      'package lib\nimport "example.com/m/lib/internal/sec"\nfunc U() { sec.S() }\n',
  });
  const imp = (file, path) =>
    one(
      links,
      (link) =>
        link.kind === "imports" &&
        link.file === file &&
        link.targetName === path,
      path,
    );
  assert.equal(
    imp("app/app.go", "example.com/m/lib/x").target,
    "lib/x/x.go:package:xpkg",
  );
  for (const path of [
    "fmt",
    "other.com/m/lib/x",
    "example.com/m/lib/internal/sec",
    "example.com/m/tool",
    "example.com/m/lib/testdata/fix",
    "example.com/m/nothing",
  ])
    assert.equal(imp("app/app.go", path).target, null, path);
  assert.equal(
    imp("lib/use.go", "example.com/m/lib/internal/sec").target,
    "lib/internal/sec/sec.go:package:sec",
  );
  // Package name differs from the directory: the qualifier is the package clause name.
  assert.equal(
    call(links, "app/app.go", "xpkg.F").target,
    "lib/x/x.go:function:F",
  );
  assert.equal(call(links, "app/app.go", "fmt.Println").target, null);
  assert.equal(
    call(links, "lib/use.go", "sec.S").target,
    "lib/internal/sec/sec.go:function:S",
  );
  const pkg = symbols.find(
    (symbol) => symbol.kind === "package" && symbol.name === "xpkg",
  );
  assert.deepEqual(pkg.data, {
    directory: "lib/x",
    importPath: "example.com/m/lib/x",
  });
});

test("a directory with two unconstrained package names proves neither: the import is unresolved", async () => {
  // Go rejects the directory; which name is real cannot be proven (round 12),
  // so neither file's membership is trusted (see W2-B.md, layer 1).
  const { links } = await project({
    "go.mod": MOD,
    "two/a.go": "package one\n",
    "two/b.go": "package other\n",
    "use/u.go": 'package use\nimport "example.com/m/two"\n',
  });
  const link = one(links, (item) => item.kind === "imports", "import");
  assert.equal(link.target, null);
  assert.deepEqual(link.candidates, []);
});

test("nested modules and local replace directives map import paths to project directories", async () => {
  const { links } = await project({
    "go.mod":
      "module example.com/root\nrequire example.com/sub v0.0.0\nreplace example.com/sub => ./sub\nreplace example.com/far => ../outside\n",
    "sub/go.mod": "module example.com/sub\n",
    "sub/s.go": "package sub\nfunc S() {}\n",
    "vendored/v.go": "package vendored\nfunc V() {}\n",
    "main.go":
      'package main\nimport (\n\t"example.com/sub"\n\t"example.com/far"\n\t"example.com/root/vendored"\n)\nfunc main() { sub.S(); far.X(); vendored.V() }\n',
  });
  assert.equal(call(links, "main.go", "sub.S").target, "sub/s.go:function:S");
  assert.equal(call(links, "main.go", "far.X").target, null);
  assert.equal(
    call(links, "main.go", "vendored.V").target,
    "vendored/v.go:function:V",
  );
});

test("aliases and dot-imports bind names; the original name and unexported names do not", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "lib/lib.go": "package lib\nfunc F() {}\nfunc hidden() {}\n",
    "a/a.go":
      'package a\nimport l "example.com/m/lib"\nfunc A() { l.F(); lib.F(); l.hidden() }\n',
    "b/b.go":
      'package b\nimport . "example.com/m/lib"\nfunc B() { F(); hidden() }\n',
  });
  assert.equal(call(links, "a/a.go", "l.F").target, "lib/lib.go:function:F");
  assert.equal(call(links, "a/a.go", "lib.F").target, null);
  assert.equal(call(links, "a/a.go", "l.hidden").target, null);
  assert.equal(call(links, "b/b.go", "F").target, "lib/lib.go:function:F");
  assert.equal(call(links, "b/b.go", "hidden").target, null);
});

test("method calls resolve only where the receiver type is syntactically evident", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/types.go": [
      "package p",
      "type A struct{ b *B }",
      "type B struct{}",
      "func (a A) Run() {}",
      "func (b *B) Run() {}",
      "func NewA() A { return A{} }",
      "func (a A) Field() { a.b.Run() }",
      "type List []A",
      "",
    ].join("\n"),
    "p/use.go": [
      "package p",
      'import "bytes"',
      "func Use(x interface{}, buf bytes.Buffer, fn func() A, l List) {",
      "\tvar a A",
      "\ta.Run()",
      "\tb := &B{}",
      "\tb.Run()",
      "\tc := new(B)",
      "\tc.Run()",
      "\tNewA().Run()",
      "\td := NewA()",
      "\td.Run()",
      "\te, _ := x.(A)",
      "\te.Run()",
      "\tfor _, v := range []A{} { v.Run() }",
      "\tbuf.Write(nil)",
      "\tfn().Run()",
      "\tfor _, w := range l { w.Run() }",
      "}",
      "",
    ].join("\n"),
  });
  const run = (at, index = 0) =>
    links.filter(
      (link) =>
        link.kind === "calls" && link.file === "p/use.go" && link.at === at,
    )[index];
  assert.equal(run("a.Run").target, "p/types.go:method:(A).Run");
  assert.equal(run("b.Run").target, "p/types.go:method:(*B).Run");
  assert.equal(run("c.Run").target, "p/types.go:method:(*B).Run");
  assert.equal(run("NewA().Run").target, "p/types.go:method:(A).Run");
  assert.equal(run("d.Run").target, "p/types.go:method:(A).Run");
  assert.equal(run("e.Run").target, "p/types.go:method:(A).Run");
  assert.equal(
    call(links, "p/types.go", "a.b.Run").target,
    "p/types.go:method:(*B).Run",
  );
  // Element types of written container types and results of func-typed values are evident.
  assert.equal(run("v.Run").target, "p/types.go:method:(A).Run");
  assert.equal(run("fn().Run").target, "p/types.go:method:(A).Run");
  // Ambiguous: ranging over a named project slice type (element type not tracked).
  assert.deepEqual(run("w.Run").candidates, [
    "p/types.go:method:(*B).Run",
    "p/types.go:method:(A).Run",
  ]);
  assert.equal(run("w.Run").target, null);
  // Negative: a known external receiver type never yields project candidates.
  assert.equal(run("buf.Write").target, null);
  assert.deepEqual(run("buf.Write").candidates, []);
});

test("one possible method target is left unresolved, never promoted to a definite target", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go":
      "package p\ntype T struct{}\nfunc (T) Only() {}\nfunc Use(x interface{ Only() }) { x.Only() }\nfunc Range() { for _, v := range []int{} { v.Only() } }\n",
  });
  assert.equal(call(links, "p/p.go", "v.Only").target, null);
  assert.deepEqual(call(links, "p/p.go", "v.Only").candidates, []);
});

test("locals shadow imports and package functions", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "lib/lib.go": "package lib\nfunc Println() {}\n",
    "p/p.go": [
      "package p",
      'import "example.com/m/lib"',
      "type local struct{}",
      "func (local) Println() {}",
      "func helper() {}",
      "func A() { lib.Println() }",
      "func B() { lib := local{}; lib.Println() }",
      "func C() { helper := func() {}; helper() }",
      "func D(helper func()) { helper() }",
      "",
    ].join("\n"),
  });
  const calls = links.filter(
    (link) => link.kind === "calls" && link.file === "p/p.go",
  );
  assert.deepEqual(
    calls.map((link) => [link.at, link.target]),
    [
      ["lib.Println", "lib/lib.go:function:Println"],
      ["lib.Println", "p/p.go:method:(local).Println"],
      ["helper", null],
      ["helper", null],
    ],
  );
});

test("implicit interface satisfaction is structural and pointer-aware; signatures only annotate", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "api/api.go":
      "package api\ntype Reader interface { Read(p []byte) (int, error) }\ntype Named interface { name() string }\ntype Both interface { Reader; Close() error }\n",
    "impl/impl.go": [
      "package impl",
      "type File struct{}",
      "func (f *File) Read(p []byte) (int, error) { return 0, nil }",
      "func (f *File) Close() error { return nil }",
      "type Value struct{}",
      "func (Value) Read(p []byte) (int, error) { return 0, nil }",
      "type Wrong struct{}",
      "func (Wrong) Read(p string) (int, error) { return 0, nil }",
      "type Hidden struct{}",
      'func (Hidden) name() string { return "" }',
      "",
    ].join("\n"),
  });
  const impl = links
    .filter((link) => link.kind === "implements")
    .map(
      (link) =>
        `${link.at.split(" ")[0]}->${link.targetName}${link.data.pointerReceiver ? "*" : ""}:${link.data.identity}`,
    )
    .sort();
  // Never definite (no-toolchain fallback): matched by method name and count;
  // `Wrong`'s Read(string) is kept, annotated as a different signature.
  assert.ok(
    links
      .filter((link) => link.kind === "implements")
      .every((link) => link.target === null),
  );
  assert.deepEqual(impl, [
    "File->Both*:identical",
    "File->Reader*:identical",
    "Value->Reader:identical",
    "Wrong->Reader:different",
  ]);
});

test("calls through interface values are candidates with the interface method, or unresolved", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": [
      "package p",
      "type Shape interface { Area() int }",
      "type Lonely interface { Nobody() }",
      "type Sq struct{}",
      "func (Sq) Area() int { return 1 }",
      "func Use(s Shape, l Lonely) { s.Area(); l.Nobody() }",
      "",
    ].join("\n"),
  });
  assert.deepEqual(call(links, "p/p.go", "s.Area").candidates, [
    "p/p.go:method:(Sq).Area",
    "p/p.go:method:Shape.Area",
  ]);
  assert.equal(call(links, "p/p.go", "s.Area").target, null);
  assert.equal(call(links, "p/p.go", "l.Nobody").target, null);
  assert.deepEqual(call(links, "p/p.go", "l.Nobody").candidates, []);
});

test("embedding promotes methods at the shallowest depth; equal depths are candidates", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": [
      "package p",
      'import "sync"',
      "type In struct{}",
      "func (In) M() {}",
      "type In2 struct{}",
      "func (In2) M() {}",
      "type Outer struct{ In }",
      "func (Outer) Own() {}",
      "type Both struct{ In; In2 }",
      "type Ext struct{ sync.Mutex }",
      "func Use(o Outer, b Both, e Ext) { o.M(); b.M(); e.Lock() }",
      "",
    ].join("\n"),
  });
  assert.equal(call(links, "p/p.go", "o.M").target, "p/p.go:method:(In).M");
  assert.deepEqual(call(links, "p/p.go", "b.M").candidates, [
    "p/p.go:method:(In).M",
    "p/p.go:method:(In2).M",
  ]);
  // An external embedded type could supply the method: unresolved, not guessed.
  assert.equal(call(links, "p/p.go", "e.Lock").target, null);
  assert.deepEqual(call(links, "p/p.go", "e.Lock").candidates, []);
  const embeds = links
    .filter((link) => link.kind === "embeds")
    .map((link) => [link.at, link.target]);
  assert.deepEqual(embeds, [
    ["In", "p/p.go:struct:In"],
    ["In", "p/p.go:struct:In"],
    ["In2", "p/p.go:struct:In2"],
    ["sync.Mutex", null],
  ]);
});

test("one package unit per directory package, hosted deterministically; test files distinguishable", async () => {
  const { symbols, links } = await project({
    "go.mod": MOD,
    "p/b.go": "//go:build linux && !race\n\npackage p\n",
    "p/a.go": "package p\n",
    "p/c_test.go": "package p\n",
    "p/d_test.go": "package p_test\n",
    "p/e_windows_amd64.go": "package p\n",
  });
  const packages = symbols.filter((symbol) => symbol.kind === "package");
  assert.deepEqual(
    packages.map((symbol) => [symbol.file, symbol.name]).sort(),
    [
      ["p/a.go", "p"],
      ["p/d_test.go", "p_test"],
    ],
  );
  const contained = links
    .filter(
      (link) =>
        link.kind === "contains" &&
        link.file === "p/a.go" &&
        link.target?.endsWith(":file:" + link.targetName),
    )
    .map((link) => link.targetName)
    .sort();
  assert.deepEqual(contained, [
    "a.go",
    "b.go",
    "c_test.go",
    "e_windows_amd64.go",
  ]);
  const file = (path) =>
    symbols.find((symbol) => symbol.kind === "file" && symbol.file === path)
      .data;
  assert.deepEqual(file("p/b.go"), {
    test: false,
    package: "p",
    build: "linux && !race",
  });
  assert.deepEqual(file("p/c_test.go"), { test: true, package: "p" });
  assert.deepEqual(file("p/e_windows_amd64.go"), {
    test: false,
    package: "p",
    goos: "windows",
    goarch: "amd64",
  });
});

test("a go.mod-only change retargets imports with no source change", async () => {
  const files = {
    "go.mod": "module example.com/old\n",
    "lib/lib.go": "package lib\nfunc F() {}\n",
    "main.go":
      'package main\nimport "example.com/new/lib"\nfunc main() { lib.F() }\n',
  };
  const [before, after] = await project(files, [
    { "go.mod": "module example.com/new\n" },
  ]);
  assert.equal(call(before.links, "main.go", "lib.F").target, null);
  assert.equal(after.report.indexed, 0);
  assert.equal(
    call(after.links, "main.go", "lib.F").target,
    "lib/lib.go:function:F",
  );
});

test("a file with a syntax error has failed: nothing in it is a target", async () => {
  const { links, symbols, report } = await project({
    "go.mod": MOD,
    "p/bad.go": "package p\nfunc Good() {}\nfunc Bad( {\n",
    "p/use.go": "package p\nfunc Use() { Good() }\n",
  });
  assert.deepEqual(report.failed, ["p/bad.go"]);
  assert.deepEqual(report.partial, []);
  assert.ok(!symbols.some((symbol) => symbol.file === "p/bad.go"));
  const link = call(links, "p/use.go", "Good");
  assert.equal(link.target, null);
  assert.deepEqual(link.candidates, []);
  assert.equal(link.data.reason, "invalid-code");
  assert.deepEqual(link.data.cause, { files: ["p/bad.go"] });
});

test("method identities are receiver-qualified; generics and multiple init keep distinct identities", async () => {
  const { symbols } = await project({
    "go.mod": MOD,
    "p/p.go": [
      "package p",
      "type A struct{}",
      "type B[T any] struct{ v T }",
      "type C = A",
      "type D int",
      "func (A) M() {}",
      "func (*B[T]) M() {}",
      "func init() {}",
      "func init() {}",
      "var x, y = 1, 2",
      "const z = iota",
      "",
    ].join("\n"),
  });
  const ids = symbols
    .filter((symbol) => symbol.file === "p/p.go" && symbol.kind !== "file")
    .map((symbol) => `${symbol.kind}:${symbol.identity}#${symbol.ordinal}`)
    .sort();
  assert.deepEqual(ids, [
    "alias:C#0",
    "const:z#0",
    "field:B.v#0",
    "function:init#0",
    "function:init#1",
    "method:(*B).M#0",
    "method:(A).M#0",
    "package:p#0",
    "struct:A#0",
    "struct:B#0",
    "type:D#0",
    "var:x#0",
    "var:y#0",
  ]);
});
