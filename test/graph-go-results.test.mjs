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

test("bubbletea: `replace … => ../` from a nested module names the checkout root", async () => {
  const { links } = await project({
    "go.mod": lines("module charm.land/bubbletea/v2", "", "go 1.22"),
    "tea.go": lines(
      "package tea",
      "type Model interface{ Init() }",
      "func NewProgram() {}",
    ),
    "examples/go.mod": lines(
      "module examples",
      "",
      "go 1.22",
      "",
      "replace charm.land/bubbletea/v2 => ../",
      "",
      "require charm.land/bubbletea/v2 v2.0.2",
    ),
    "examples/simple/main.go": lines(
      "package main",
      'import tea "charm.land/bubbletea/v2"',
      "var _ tea.Model",
      "func main() { tea.NewProgram() }",
    ),
  });
  assert.equal(
    at(links, "examples/simple/main.go", "tea.NewProgram").target,
    "tea.go:function:NewProgram",
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
    "v/use.go": lines(
      "//go:build linux || windows",
      "",
      "package v",
      "func Use() { New().M(); Other().M() }",
    ),
    "v/any.go": lines("package v", "func Any() { New().M() }"),
    "v/use_linux.go": lines(
      "package v",
      "func UseLinux() { New().M(); Other().M() }",
    ),
  });
  // Built on Linux and Windows, each with one New: each variant's own T.M,
  // a candidate set.
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
  // Built everywhere, but darwin (and others) have no New: unresolved.
  // The receiver's type is not known: the open name-only set of the module's
  // rule for unknown receivers, never one target.
  const any = at(links, "v/any.go", "New().M");
  assert.equal(any.target, null);
  assert.equal(any.data.open.reason, "receiver-type-unknown");
});

test("cilium: bpf2go loaders declared per byte order, called from their own file, resolve however many tags the constraint names", async () => {
  const el =
    "//go:build (386 || amd64 || arm || arm64 || loong64 || mips64le || mipsle || ppc64le || riscv64 || wasm) && linux";
  const eb = "//go:build (mips || mips64 || ppc64 || s390x) && linux";
  const loader = (constraint) =>
    lines(
      constraint,
      "",
      "package kprobe",
      "type Spec struct{}",
      "func (s *Spec) LoadAndAssign() error { return nil }",
      "func loadBpf() (*Spec, error) { return &Spec{}, nil }",
      "func loadBpfObjects() error {",
      "	spec, err := loadBpf()",
      "	if err != nil {",
      "		return err",
      "	}",
      "	return spec.LoadAndAssign()",
      "}",
    );
  const { links } = await project({
    "go.mod": MOD,
    "kprobe/bpf_bpfel.go": loader(el),
    "kprobe/bpf_bpfeb.go": loader(eb),
  });
  assert.equal(
    at(links, "kprobe/bpf_bpfel.go", "spec.LoadAndAssign").target,
    "kprobe/bpf_bpfel.go:method:(*Spec).LoadAndAssign",
  );
  assert.equal(
    at(links, "kprobe/bpf_bpfeb.go", "spec.LoadAndAssign").target,
    "kprobe/bpf_bpfeb.go:method:(*Spec).LoadAndAssign",
  );
});

test("cilium: loaders declared for every port GOARCH cover an unconstrained caller; linux-only ones do not", async () => {
  const el =
    "386 || amd64 || arm || arm64 || loong64 || mips64le || mipsle || ppc64le || riscv64 || wasm";
  const eb = "mips || mips64 || ppc64 || s390x";
  const loader = (constraint, pkg) =>
    lines(
      `//go:build ${constraint}`,
      "",
      `package ${pkg}`,
      'import "example.com/m/ebpf"',
      "func load() (*ebpf.CollectionSpec, error) { return nil, nil }",
    );
  const caller = (pkg) =>
    lines(
      `package ${pkg}`,
      "func use() {",
      "	spec, _ := load()",
      "	_ = spec.Maps",
      "}",
    );
  const { links } = await project({
    "go.mod": MOD,
    "ebpf/collection.go": lines(
      "package ebpf",
      "type CollectionSpec struct{ Maps map[string]int }",
    ),
    // docs/examples/variables: the two lists name every port GOARCH.
    "variables/variables_bpfel.go": loader(el, "main"),
    "variables/variables_bpfeb.go": loader(eb, "main"),
    "variables/main.go": caller("main"),
    // cmd/bpf2go/test: also `&& linux`; the darwin build has no loader.
    "test/test_bpfel.go": loader(`(${el}) && linux`, "test"),
    "test/test_bpfeb.go": loader(`(${eb}) && linux`, "test"),
    "test/api_test.go": caller("test"),
  });
  assert.equal(
    at(links, "variables/main.go", "spec.Maps").target,
    "ebpf/collection.go:field:CollectionSpec.Maps",
  );
  assert.equal(at(links, "test/api_test.go", "spec.Maps").target, null);
});

// The two fixtures of evidence/c-8/go-variant-configs.sh, checked with Go
// 1.27.4: (a) the darwin build of the caller has no New and does not build;
// (b) `-tags=freebsd` on Linux selects new_b.go, so New() is a *B.
test("build variants: one definite answer only when the variants cover every build of the caller and agree", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "a/new_linux.go": lines("package a", "func New() *T { return &T{} }"),
    "a/new_windows.go": lines("package a", "func New() *T { return &T{} }"),
    "a/t_linux.go": lines("package a", "type T struct{}", "func (*T) M() {}"),
    "a/t_windows.go": lines("package a", "type T struct{}", "func (*T) M() {}"),
    "a/t_darwin.go": lines("package a", "type T struct{}", "func (*T) M() {}"),
    "a/use.go": lines(
      "//go:build linux || darwin",
      "",
      "package a",
      "func Use() { New().M() }",
    ),
    "b/new_a.go": lines(
      "//go:build linux && !freebsd",
      "",
      "package b",
      "func New() *A { return &A{} }",
    ),
    "b/new_b.go": lines(
      "//go:build linux && freebsd",
      "",
      "package b",
      "func New() *B { return &B{} }",
    ),
    "b/types.go": lines(
      "package b",
      "type A struct{}",
      "func (*A) M() {}",
      "type B struct{}",
      "func (*B) M() {}",
    ),
    "b/use_linux.go": lines("package b", "func Use() { New().M() }"),
  });
  for (const [file, text] of [
    ["a/use.go", "New().M"],
    ["b/use_linux.go", "New().M"],
  ]) {
    const link = at(links, file, text);
    assert.equal(link.target, null, file);
    assert.equal(link.data.open.reason, "receiver-type-unknown", file);
  }
});

test("pointer conversions keep their indirection: an alias or a defined type of a pointer, and two stars, have no members", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type T struct{ F int }",
      "func (*T) M() {}",
      "type Alias = *T",
      "type Again = Alias",
      "type P *T",
      "func Use() {",
      "	(*T)(nil).M()",
      "	(*Alias)(nil).M()",
      "	(*Again)(nil).M()",
      "	(*P)(nil).M()",
      "	(**T)(nil).M()",
      "}",
    ),
  });
  assert.equal(
    at(links, "p/p.go", "(*T)(nil).M").target,
    "p/p.go:method:(*T).M",
  );
  for (const text of [
    "(*Alias)(nil).M",
    "(*Again)(nil).M",
    "(*P)(nil).M",
    "(**T)(nil).M",
  ]) {
    const link = at(links, "p/p.go", text);
    assert.equal(link.target, null, text);
    assert.deepEqual(link.candidates, [], text);
  }
  // The conversion itself still names the type written.
  assert.equal(
    at(links, "p/p.go", "*Alias", "calls").target,
    "p/p.go:alias:Alias",
  );
  assert.equal(at(links, "p/p.go", "**T", "calls").target, "p/p.go:struct:T");
});

// The import shapes of evidence/c-8/go-import-rules.sh, checked with Go 1.27.4.
test("imports follow the go command: required modules only, a go.mod at the replacement, one provider, a buildable file", async () => {
  const pkg = (name, n) =>
    lines(`package ${name}`, `func F() int { return ${n} }`);
  const use = (path) =>
    lines("package main", `import p "${path}"`, "func main() { _ = p.F() }");
  const target = async (files, path) => {
    const { links } = await project({ ...files, "cmd/main.go": use(path) });
    const imp = links.find(
      (link) => link.kind === "imports" && link.file === "cmd/main.go",
    );
    return {
      imp: imp.target,
      reason: imp.data?.open?.reason ?? null,
      call: at(links, "cmd/main.go", "p.F").target,
    };
  };
  const app = (...directives) =>
    lines("module example.com/app", "", "go 1.22", ...directives);
  // Replaced but not required: Go does not use the replacement.
  assert.deepEqual(
    await target(
      {
        "go.mod": app("replace example.com/dep => ./dep"),
        "dep/go.mod": lines("module example.com/dep", "", "go 1.22"),
        "dep/d.go": pkg("dep", 1),
      },
      "example.com/dep",
    ),
    { imp: null, reason: null, call: null },
  );
  // The main module provides testdata/p; the unrequired replace does nothing.
  const testdata = {
    "testdata/p/p.go": pkg("p", 1),
    "testdata/dep/go.mod": lines(
      "module example.com/app/testdata/p",
      "",
      "go 1.22",
    ),
    "testdata/dep/p.go": pkg("p", 2),
  };
  assert.deepEqual(
    await target(
      {
        "go.mod": app("replace example.com/app/testdata/p => ./testdata/dep"),
        ...testdata,
      },
      "example.com/app/testdata/p",
    ),
    {
      imp: "testdata/p/p.go:package:p",
      reason: null,
      call: "testdata/p/p.go:function:F",
    },
  );
  // Required as well: two modules provide it, an ambiguous import.
  assert.deepEqual(
    await target(
      {
        "go.mod": app(
          "require example.com/app/testdata/p v0.0.0",
          "replace example.com/app/testdata/p => ./testdata/dep",
        ),
        ...testdata,
      },
      "example.com/app/testdata/p",
    ),
    { imp: null, reason: "import-destination-uncertain", call: null },
  );
  // `=> ..` without a go.mod in the parent: Go fails reading it.
  const parent = {
    "lib/l.go": pkg("lib", 1),
    "inner/go.mod": lines(
      "module example.com/app",
      "",
      "go 1.22",
      "require example.com/parent v0.0.0",
      "replace example.com/parent => ..",
    ),
  };
  const inner = async (files) => {
    const { links } = await project({
      ...files,
      "inner/cmd/main.go": use("example.com/parent/lib"),
    });
    return at(links, "inner/cmd/main.go", "p.F").target;
  };
  assert.equal(await inner(parent), null);
  assert.equal(
    await inner({
      ...parent,
      "go.mod": lines("module example.com/parent", "", "go 1.22"),
    }),
    "lib/l.go:function:F",
  );
  // A package whose only file is `//go:build ignore`: no package.
  assert.deepEqual(
    await target(
      {
        "go.mod": app(),
        "p/p.go": lines("//go:build ignore", "", pkg("p", 1)),
      },
      "example.com/app/p",
    ),
    { imp: null, reason: null, call: null },
  );
});
