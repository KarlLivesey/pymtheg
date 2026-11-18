// SPDX-License-Identifier: MIT
// C-8: member links through call results of checkout functions and methods,
// pointer conversions, and packages of local modules (a bare `..` replace, a
// module under a dot directory, packages under testdata). Fixtures follow
// real corpus shapes (cilium/ebpf `fd.Dup()` then `fd.File`, pebble
// `var _ Writer = (*Batch)(nil)`, gopls `replace golang.org/x/tools => ..`,
// cli/cli's `.github/skills/cli-exercise/tool` module).
import assert from "node:assert/strict";
import { test } from "node:test";
import { project } from "./fixtures/graph-go/harness.mjs";

const MOD = "module example.com/m\n\ngo 1.22\n";
const lines = (...items) => [...items, ""].join("\n");
const at = (links, file, text, kind) => {
  const found = links.filter(
    (link) =>
      link.file === file &&
      (kind
        ? link.kind === kind
        : link.kind === "calls" || link.kind === "references") &&
      link.at === text,
  );
  assert.equal(found.length, 1, `${file} ${text}: ${JSON.stringify(found)}`);
  return found[0];
};

test("cilium: results of checkout constructors and methods, multi-value, chained and stored in fields", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "sys/fd.go": lines(
      "package sys",
      "type FD struct{ Raw int }",
      "func NewFD(v int) (*FD, error) { return &FD{Raw: v}, nil }",
      "func (fd *FD) Dup() (*FD, error) { return fd, nil }",
      "func (fd *FD) File(name string) string { return name }",
      "func (fd *FD) Self() *FD { return fd }",
    ),
    "link/perf_event.go": lines(
      "package link",
      'import "example.com/m/sys"',
      "type perfEvent struct{ fd *sys.FD }",
      "type perfEventIoctl struct{ *perfEvent }",
      "type holder struct{ made *sys.FD }",
      "func (pi *perfEventIoctl) PerfEvent() string {",
      "\tfd, err := pi.fd.Dup()",
      "\tif err != nil {",
      '\t\treturn ""',
      "\t}",
      '\treturn fd.File("perf-event")',
      "}",
      "func open() int {",
      "\tfd, _ := sys.NewFD(1)",
      "\th := holder{made: fd}",
      '\t_ = h.made.File("x")',
      "\treturn fd.Self().Self().Raw",
      "}",
    ),
  });
  const target = (text) => at(links, "link/perf_event.go", text).target;
  assert.equal(target("pi.fd.Dup"), "sys/fd.go:method:(*FD).Dup");
  assert.equal(target("fd.File"), "sys/fd.go:method:(*FD).File");
  assert.equal(target("h.made.File"), "sys/fd.go:method:(*FD).File");
  assert.equal(target("fd.Self().Self"), "sys/fd.go:method:(*FD).Self");
  assert.equal(target("fd.Self().Self().Raw"), "sys/fd.go:field:FD.Raw");
});

test("pebble: pointer conversions link to the type, and a method on the converted value resolves", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "db.go": lines("package pebble", "type Writer interface{ Apply() }"),
    "batch.go": lines(
      "package pebble",
      'import "example.com/m/internal/base"',
      "type Batch struct{ n int }",
      "func (b *Batch) Apply() {}",
      "var _ Writer = (*Batch)(nil)",
      "var _ = (*base.Key)(nil)",
      "func use(p any, fp *func()) {",
      "\t(*Batch)(nil).Apply()",
      "\t_ = (*base.Key)(nil).Len()",
      "\t(*fp)()",
      "}",
    ),
    "internal/base/key.go": lines(
      "package base",
      "type Key struct{}",
      "func (*Key) Len() int { return 0 }",
    ),
  });
  const calls = links.filter(
    (link) => link.file === "batch.go" && link.kind === "calls",
  );
  const named = (text) => calls.filter((link) => link.at === text);
  assert.deepEqual(
    named("*Batch").map((link) => link.target),
    ["batch.go:struct:Batch", "batch.go:struct:Batch"],
  );
  assert.deepEqual(
    named("*base.Key").map((link) => link.target),
    ["internal/base/key.go:struct:Key", "internal/base/key.go:struct:Key"],
  );
  assert.equal(
    at(links, "batch.go", "(*Batch)(nil).Apply").target,
    "batch.go:method:(*Batch).Apply",
  );
  assert.equal(
    at(links, "batch.go", "(*base.Key)(nil).Len").target,
    "internal/base/key.go:method:(*Key).Len",
  );
  // Dereferencing a pointer to a func value is a call, not a conversion.
  const deref = at(links, "batch.go", "*fp", "calls");
  assert.equal(deref.target, null);
  assert.deepEqual(deref.candidates, []);
});

test("gopls: a nested module joined by `replace … => ..` resolves the parent module's packages", async () => {
  const { links } = await project({
    "go.mod": "module golang.org/x/tools\n\ngo 1.22\n",
    "go/ast/edge/edge.go": lines(
      "package edge",
      "type Kind int",
      "const CallExpr_Args Kind = 1",
      'func (k Kind) String() string { return "" }',
    ),
    "gopls/go.mod": lines(
      "module golang.org/x/tools/gopls",
      "",
      "go 1.22",
      "",
      "require golang.org/x/tools v0.52.0",
      "",
      "replace golang.org/x/tools => ..",
    ),
    "gopls/internal/util/typesutil/typesutil.go": lines(
      "package typesutil",
      'import "golang.org/x/tools/go/ast/edge"',
      "func f(k edge.Kind) string {",
      "\tswitch k {",
      "\tcase edge.CallExpr_Args:",
      "\t\treturn k.String()",
      "\t}",
      '\treturn ""',
      "}",
    ),
  });
  const file = "gopls/internal/util/typesutil/typesutil.go";
  assert.equal(
    links.find(
      (link) =>
        link.file === file &&
        link.kind === "imports" &&
        link.targetName === "golang.org/x/tools/go/ast/edge",
    ).target,
    "go/ast/edge/edge.go:package:edge",
  );
  assert.equal(
    at(links, file, "edge.CallExpr_Args").target,
    "go/ast/edge/edge.go:const:CallExpr_Args",
  );
  assert.equal(
    at(links, file, "k.String").target,
    "go/ast/edge/edge.go:method:(Kind).String",
  );
});

test("a replace to a directory outside the checkout, or to a module path, stays outside", async () => {
  const { links } = await project({
    "go.mod": lines(
      "module example.com/m",
      "",
      "go 1.22",
      "",
      "replace example.com/up => ../..",
      "replace example.com/other => example.com/fork v1.0.0",
    ),
    "a.go": lines(
      "package m",
      'import "example.com/up/x"',
      'import "example.com/other/y"',
      "func F() { x.G(); y.H() }",
    ),
  });
  assert.equal(at(links, "a.go", "x.G").target, null);
  assert.equal(at(links, "a.go", "y.H").target, null);
});

test("cli/cli: a module under a dot directory imports its own internal packages", async () => {
  const root = ".github/skills/cli-exercise/tool";
  const { links } = await project({
    "go.mod": "module github.com/cli/cli/v2\n\ngo 1.22\n",
    [`${root}/go.mod`]:
      "module github.com/cli/cli/v2/cli-exercise\n\ngo 1.22\n",
    [`${root}/internal/cliutil/cliutil.go`]: lines(
      "package cliutil",
      "type Runner struct{ Dir string }",
      "func New(dir string) *Runner { return &Runner{Dir: dir} }",
      "func (r *Runner) Run() error { return nil }",
    ),
    [`${root}/internal/evidence/render.go`]: lines(
      "package evidence",
      'import "github.com/cli/cli/v2/cli-exercise/internal/cliutil"',
      "func Render() error {",
      '\tr := cliutil.New(".")',
      "\t_ = r.Dir",
      "\treturn r.Run()",
      "}",
    ),
  });
  const file = `${root}/internal/evidence/render.go`;
  const lib = `${root}/internal/cliutil/cliutil.go`;
  assert.equal(at(links, file, "cliutil.New").target, `${lib}:function:New`);
  assert.equal(at(links, file, "r.Dir").target, `${lib}:field:Runner.Dir`);
  assert.equal(at(links, file, "r.Run").target, `${lib}:method:(*Runner).Run`);
});

test("protobuf-go: an import of a package under testdata resolves; a GOPATH-style path does not", async () => {
  const { links } = await project({
    "go.mod": "module google.golang.org/protobuf\n\ngo 1.22\n",
    "cmd/protoc-gen-go/testdata/extensions/base/base.go": lines(
      "package base",
      "type BaseMessage struct{ Field *int32 }",
      "func (m *BaseMessage) Reset() {}",
    ),
    "cmd/protoc-gen-go/testdata/extensions/ext/ext.go": lines(
      "package ext",
      'import base "google.golang.org/protobuf/cmd/protoc-gen-go/testdata/extensions/base"',
      "var E = (*base.BaseMessage)(nil)",
      "func F(m *base.BaseMessage) { m.Reset() }",
    ),
    "go/analysis/testdata/src/a/a.go": lines(
      "package a",
      'import "b"',
      "func A() { b.B() }",
    ),
    "go/analysis/testdata/src/b/b.go": lines("package b", "func B() {}"),
  });
  const file = "cmd/protoc-gen-go/testdata/extensions/ext/ext.go";
  const base = "cmd/protoc-gen-go/testdata/extensions/base/base.go";
  assert.equal(
    at(links, file, "*base.BaseMessage", "calls").target,
    `${base}:struct:BaseMessage`,
  );
  assert.equal(
    at(links, file, "m.Reset").target,
    `${base}:method:(*BaseMessage).Reset`,
  );
  assert.equal(
    at(links, "go/analysis/testdata/src/a/a.go", "b.B").target,
    null,
  );
});

test("results that must not become definite: interface, type parameter, external, unknown callee", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "q/q.go": lines(
      "package q",
      'import "bytes"',
      "type Getter interface{ Get() int }",
      "type A struct{}",
      "func (A) Get() int { return 1 }",
      "type B struct{}",
      "func (B) Get() int { return 2 }",
      "func Make() Getter { return A{} }",
      "func Pick[T any](v T) T { return v }",
      "type Box[T any] struct{ v T }",
      "func (b Box[T]) Value() T { return b.v }",
      "func Buf() *bytes.Buffer { return nil }",
      "func Use(f func() A, b Box[A]) {",
      "\t_ = Make().Get()",
      "\t_ = Pick(A{}).Get()",
      "\t_ = b.Value().Get()",
      "\t_ = Buf().Len()",
      "\t_ = f().Get()",
      "}",
    ),
  });
  const get = (text) => at(links, "q/q.go", text);
  // Interface-typed result: the dispatch set (never one definite target).
  const dispatch = get("Make().Get");
  assert.equal(dispatch.target, null);
  assert.deepEqual(dispatch.candidates, [
    "q/q.go:method:(A).Get",
    "q/q.go:method:(B).Get",
    "q/q.go:method:Getter.Get",
  ]);
  // Type-parameter results are not instantiated: unresolved.
  for (const text of ["Pick(A{}).Get", "b.Value().Get"]) {
    const link = get(text);
    assert.equal(link.target, null, text);
  }
  // A standard-library result: unresolved, no candidates.
  assert.equal(get("Buf().Len").target, null);
  assert.deepEqual(get("Buf().Len").candidates, []);
  // A func-typed parameter's result is its written type.
  assert.equal(get("f().Get").target, "q/q.go:method:(A).Get");
});

test("build variants: a function declared per variant gives each variant's result type", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "v/new_linux.go": lines(
      "package v",
      "func New() *T { return &T{} }",
      "func Other() *L { return nil }",
    ),
    "v/new_windows.go": lines(
      "package v",
      "func New() *T { return &T{} }",
      "func Other() *W { return nil }",
    ),
    "v/t_linux.go": lines(
      "package v",
      "type T struct{}",
      "func (*T) M() {}",
      "type L struct{}",
      "func (*L) M() {}",
    ),
    "v/t_windows.go": lines(
      "package v",
      "type T struct{}",
      "func (*T) M() {}",
      "type W struct{}",
      "func (*W) M() {}",
    ),
    "v/use.go": lines("package v", "func Use() { New().M(); Other().M() }"),
    "v/use_linux.go": lines(
      "package v",
      "func UseLinux() { New().M(); Other().M() }",
    ),
  });
  // Built on both: each variant's own T.M, a candidate set.
  const both = at(links, "v/use.go", "New().M");
  assert.equal(both.target, null);
  assert.deepEqual(both.candidates, [
    "v/t_linux.go:method:(*T).M",
    "v/t_windows.go:method:(*T).M",
  ]);
  // Built on Linux only: the Linux variant.
  assert.equal(
    at(links, "v/use_linux.go", "New().M").target,
    "v/t_linux.go:method:(*T).M",
  );
  assert.equal(
    at(links, "v/use_linux.go", "Other().M").target,
    "v/t_linux.go:method:(*L).M",
  );
  // Variants returning different named types: never one definite target.
  assert.equal(at(links, "v/use.go", "Other().M").target, null);
});
