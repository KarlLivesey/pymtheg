// SPDX-License-Identifier: MIT
// C-14: Go links to standard-library, builtin and dependency symbols. Fixtures
// follow corpus shapes named in the coverage plan: restic's
// `ole.IsEqualGUID(id, test.id)` through `github.com/go-ole/go-ole`,
// golang/tools' `gob.NewDecoder(r).Decode(v)`, samber/lo's `is.NoError(err)`
// on `is := assert.New(t)`, esbuild's `t.Run(fmt.Sprintf(...), ...)`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { project } from "./fixtures/graph-go/harness.mjs";

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
/** The link's one library target, or null; checkout targets are named. */
const outcome = (link) =>
  link.libraries
    ? link.resolution === "library"
      ? link.libraries[0]
      : { set: [...link.libraries].sort((a, b) => (a.unit < b.unit ? -1 : 1)) }
    : link.target
      ? { checkout: link.target }
      : link.candidates.length
        ? { candidates: link.candidates }
        : { unresolved: link.data?.reason ?? link.data?.uncertainty ?? null };

const MOD = lines(
  "module example.com/m",
  "",
  "go 1.22",
  "",
  "require (",
  "\tgithub.com/stretchr/testify v1.9.0",
  "\tgithub.com/go-ole/go-ole v1.3.0",
  "\tgithub.com/minio/minio-go/v7 v7.0.70",
  "\tgithub.com/replaced/mod v1.0.0",
  "\texample.com/local v0.0.0",
  ")",
  "",
  "replace github.com/replaced/mod => github.com/fork/mod v1.0.1",
  "replace example.com/local => ./local",
);

test("builtins no declaration shadows are library targets; shadowed ones are not", async () => {
  const { links } = await project({
    "go.mod": "module example.com/m\n\ngo 1.22\n",
    "a/a.go": lines(
      "package a",
      "func use(xs []int) int {",
      "\tys := append(xs, 1)",
      "\tm := make(map[string]int)",
      "\tp := new(int)",
      '\tdelete(m, "k")',
      "\t_ = p",
      "\treturn len(ys) + cap(ys)",
      "}",
      "func shadowed() int {",
      "\tlen := func(int) int { return 0 }",
      "\treturn len(1)",
      "}",
    ),
    // A package-level `min` in the package: every `min` there is it.
    "b/b.go": lines(
      "package b",
      "func min(a, b int) int { return a }",
      "func use() int { return min(1, 2) + max(1, 2) }",
    ),
    // A declaration in a test file of the package: the non-test build sees
    // the builtin, the test build the declaration, so neither is proven.
    "c/c.go": lines("package c", "func use() int { return max(1, 2) }"),
    "c/c_test.go": lines("package c", "func max(a, b int) int { return a }"),
    // A declaration in one build variant: the Linux build calls it, so the
    // name is not the builtin in every build of the caller.
    "v/min_linux.go": lines("package v", "func min(a, b int) int { return a }"),
    "v/use.go": lines("package v", "func use() int { return min(1, 2) }"),
  });
  assert.equal(at(links, "v/use.go", "min").libraries, undefined);
  const builtin = (symbol) => ({
    ecosystem: "go-std",
    unit: "builtin",
    symbol,
    evidence: "declared-builtin",
  });
  for (const name of ["append", "make", "new", "delete", "cap"])
    assert.deepEqual(outcome(at(links, "a/a.go", name)), builtin(name), name);
  // The first `len` is the builtin; the second calls the local function value.
  const lens = links.filter(
    (link) =>
      link.file === "a/a.go" && link.kind === "calls" && link.at === "len",
  );
  assert.equal(lens.length, 2);
  assert.deepEqual(outcome(lens[0]), builtin("len"));
  assert.equal(lens[1].libraries, undefined);
  assert.deepEqual(outcome(at(links, "b/b.go", "min")), {
    checkout: "b/b.go:function:min",
  });
  assert.deepEqual(outcome(at(links, "b/b.go", "max")), builtin("max"));
  assert.deepEqual(outcome(at(links, "c/c.go", "max")), { unresolved: null });
});

test("package-qualified selectors name the import's unit and the selected symbol", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "local/go.mod": "module example.com/local\n\ngo 1.22\n",
    "local/l.go": lines("package local", "func Do() {}"),
    "x/x.go": lines(
      "package x",
      "import (",
      '\t"fmt"',
      '\tstr "strings"',
      '\t"strconv"',
      '\t"sync"',
      '\t"time"',
      '\t"math/rand/v2"',
      '\t_ "embed"',
      '\t"github.com/stretchr/testify/require"',
      '\t"github.com/go-ole/go-ole"',
      '\t"github.com/minio/minio-go/v7"',
      '\t"github.com/replaced/mod/sub"',
      '\t"example.com/local"',
      ")",
      "type guarded struct {",
      "\tsync.Mutex",
      "\tttl time.Duration",
      "}",
      "func use(t require.TestingT, id, other *ole.GUID) string {",
      '\trequire.NoError(t, fmt.Errorf("%d", rand.IntN(3)))',
      "\tif !ole.IsEqualGUID(id, other) {",
      "\t\t_ = minio.New",
      "\t}",
      "\tsub.Run()",
      "\tlocal.Do()",
      "\t_ = strconv.quote",
      '\treturn str.ToUpper(strconv.Quote("x"))',
      "}",
    ),
  });
  const file = "x/x.go";
  const std = (unit, symbol) => ({
    ecosystem: "go-std",
    unit,
    symbol,
    evidence: "import-binding",
  });
  assert.deepEqual(
    outcome(at(links, file, "fmt.Errorf")),
    std("fmt", "Errorf"),
  );
  assert.deepEqual(
    outcome(at(links, file, "str.ToUpper")),
    std("strings", "ToUpper"),
  );
  assert.deepEqual(
    outcome(at(links, file, "strconv.Quote")),
    std("strconv", "Quote"),
  );
  assert.deepEqual(
    outcome(at(links, file, "rand.IntN")),
    std("math/rand/v2", "IntN"),
  );
  assert.deepEqual(
    outcome(at(links, file, "sync.Mutex", "embeds")),
    std("sync", "Mutex"),
  );
  assert.deepEqual(
    outcome(at(links, file, "time.Duration")),
    std("time", "Duration"),
  );
  // A dependency's version is the one go.mod requires, with its source.
  assert.deepEqual(outcome(at(links, file, "require.NoError")), {
    ecosystem: "go",
    unit: "github.com/stretchr/testify/require",
    symbol: "NoError",
    version: "v1.9.0",
    versionSource: "go.mod",
    evidence: "import-binding",
  });
  assert.deepEqual(outcome(at(links, file, "ole.IsEqualGUID")), {
    ecosystem: "go",
    unit: "github.com/go-ole/go-ole",
    symbol: "IsEqualGUID",
    version: "v1.3.0",
    versionSource: "go.mod",
    evidence: "import-binding",
  });
  // Replaced by another module: the import path, without a version.
  assert.deepEqual(outcome(at(links, file, "sub.Run")), {
    ecosystem: "go",
    unit: "github.com/replaced/mod/sub",
    symbol: "Run",
    evidence: "import-binding",
  });
  // `minio` is a plausible name of `minio-go/v7` and of no other import.
  assert.deepEqual(outcome(at(links, file, "minio.New")), {
    ecosystem: "go",
    unit: "github.com/minio/minio-go/v7",
    symbol: "New",
    version: "v7.0.70",
    versionSource: "go.mod",
    evidence: "import-binding",
  });
  // Replaced by a directory of the checkout: checkout code.
  assert.deepEqual(outcome(at(links, file, "local.Do")), {
    checkout: "local/l.go:function:Do",
  });
  // Another package's unexported name is no symbol of it.
  assert.deepEqual(outcome(at(links, file, "strconv.quote")), {
    unresolved: null,
  });
  // The import links name the unit only.
  const imports = (path) =>
    outcome(
      links.find(
        (link) =>
          link.file === file &&
          link.kind === "imports" &&
          link.data?.path === path,
      ),
    );
  assert.deepEqual(imports("fmt"), {
    ecosystem: "go-std",
    unit: "fmt",
    evidence: "import-path",
  });
  assert.deepEqual(imports("embed"), {
    ecosystem: "go-std",
    unit: "embed",
    evidence: "import-path",
  });
  assert.deepEqual(imports("github.com/stretchr/testify/require"), {
    ecosystem: "go",
    unit: "github.com/stretchr/testify/require",
    version: "v1.9.0",
    versionSource: "go.mod",
    evidence: "import-path",
  });
  assert.deepEqual(imports("example.com/local"), {
    checkout: "local/l.go:package:local",
  });
});

test("a qualifier that is a local, a vendored package, cgo or a GOPATH-style import is no library", async () => {
  const { links } = await project({
    "go.mod": lines(
      "module example.com/m",
      "",
      "go 1.22",
      "",
      "require github.com/v/dep v1.0.0",
    ),
    "vendor/github.com/v/dep/dep.go": lines("package dep", "func F() {}"),
    "q/q.go": lines(
      "package q",
      "/*",
      "#include <stdlib.h>",
      "*/",
      'import "C"',
      'import "net/http"',
      'import "github.com/v/dep"',
      "type client struct{}",
      "func (client) Get(string) {}",
      "func use() {",
      "\thttp := client{}",
      '\thttp.Get("x")',
      "\tdep.F()",
      "\tC.free(nil)",
      "}",
    ),
    "testdata/src/a/a.go": lines("package a", "func A() {}"),
    "testdata/src/b/b.go": lines(
      "package b",
      'import "a"',
      "func use() { a.A() }",
    ),
  });
  assert.deepEqual(outcome(at(links, "q/q.go", "http.Get")), {
    checkout: "q/q.go:method:(client).Get",
  });
  assert.deepEqual(outcome(at(links, "q/q.go", "dep.F")), { unresolved: null });
  assert.deepEqual(outcome(at(links, "q/q.go", "C.free")), {
    unresolved: null,
  });
  assert.deepEqual(outcome(at(links, "testdata/src/b/b.go", "a.A")), {
    unresolved: null,
  });
  for (const path of ["C", "github.com/v/dep"])
    assert.equal(
      links.find(
        (link) =>
          link.file === "q/q.go" &&
          link.kind === "imports" &&
          link.data?.path === path,
      )?.libraries,
      undefined,
      path,
    );
});

test("members on values of library types stay unresolved with their reason; the written type is named", async () => {
  const { links } = await project({
    "go.mod": lines(
      "module example.com/m",
      "",
      "go 1.22",
      "",
      "require github.com/stretchr/testify v1.9.0",
    ),
    "r/r.go": lines(
      "package r",
      "import (",
      '\t"bytes"',
      '\t"encoding/gob"',
      '\t"io"',
      '\t"testing"',
      '\t"github.com/stretchr/testify/assert"',
      ")",
      "func use(t *testing.T, r io.Reader, v any, p []byte) {",
      "\tvar buf bytes.Buffer",
      "\tbuf.Write(p)",
      "\tgob.NewDecoder(r).Decode(v)",
      "\tis := assert.New(t)",
      "\tis.NoError(nil)",
      "}",
    ),
  });
  const file = "r/r.go";
  assert.deepEqual(outcome(at(links, file, "bytes.Buffer")), {
    ecosystem: "go-std",
    unit: "bytes",
    symbol: "Buffer",
    evidence: "import-binding",
  });
  // C-17: standard-library members resolve from the shipped table; a
  // third-party type's member stays unproven.
  assert.deepEqual(outcome(at(links, file, "buf.Write")), {
    ecosystem: "go-std",
    unit: "bytes",
    symbol: "Buffer.Write",
    evidence: "declaring-owner",
  });
  assert.deepEqual(outcome(at(links, file, "gob.NewDecoder(r).Decode")), {
    ecosystem: "go-std",
    unit: "encoding/gob",
    symbol: "Decoder.Decode",
    evidence: "declaring-owner",
  });
  assert.deepEqual(outcome(at(links, file, "is.NoError")), {
    unresolved: "library-member-unproven",
  });
  assert.deepEqual(outcome(at(links, file, "gob.NewDecoder")), {
    ecosystem: "go-std",
    unit: "encoding/gob",
    symbol: "NewDecoder",
    evidence: "import-binding",
  });
  assert.deepEqual(outcome(at(links, file, "assert.New")), {
    ecosystem: "go",
    unit: "github.com/stretchr/testify/assert",
    symbol: "New",
    version: "v1.9.0",
    versionSource: "go.mod",
    evidence: "import-binding",
  });
});

test("two imports that could bind one qualifier are a set; a dot import proves nothing", async () => {
  const { links } = await project({
    "go.mod": lines(
      "module example.com/m",
      "",
      "go 1.22",
      "",
      "require (",
      "\tgithub.com/a/errors v1.0.0",
      "\tgithub.com/b/go-errors v1.0.0",
      ")",
    ),
    "d/d.go": lines(
      "package d",
      "import (",
      '\t"github.com/a/errors"',
      '\t"github.com/b/go-errors"',
      '\t. "strings"',
      ")",
      "func use() {",
      '\t_ = errors.New("x")',
      '\t_ = ToUpper("x")',
      "}",
    ),
  });
  // Both may declare `errors`: a candidate set of the two units.
  const both = (unit) => ({
    ecosystem: "go",
    unit,
    symbol: "New",
    version: "v1.0.0",
    versionSource: "go.mod",
    evidence: "import-binding",
  });
  assert.deepEqual(outcome(at(links, "d/d.go", "errors.New")), {
    set: [both("github.com/a/errors"), both("github.com/b/go-errors")],
  });
  assert.deepEqual(outcome(at(links, "d/d.go", "ToUpper")), {
    unresolved: null,
  });
});

test("review: a replace to any filesystem path is never a library", async () => {
  const { links } = await project({
    "go.mod": lines(
      "module example.com/m",
      "",
      "go 1.22",
      "",
      "require (",
      "\tgithub.com/abs/mod v1.0.0",
      "\tgithub.com/up/mod v1.0.0",
      "\tgithub.com/ok/mod v1.0.0",
      ")",
      "",
      "replace github.com/abs/mod => /src/mod",
      "replace github.com/up/mod => ../up",
    ),
    "a/a.go": lines(
      "package a",
      'import "github.com/abs/mod"',
      'import up "github.com/up/mod"',
      'import "github.com/ok/mod"',
      "func use() { mod.F(); up.G() }",
    ),
  });
  assert.deepEqual(outcome(at(links, "a/a.go", "mod.F")), { unresolved: null });
  assert.deepEqual(outcome(at(links, "a/a.go", "up.G")), { unresolved: null });
  for (const path of ["github.com/abs/mod", "github.com/up/mod"])
    assert.equal(
      links.find((link) => link.kind === "imports" && link.data?.path === path)
        ?.libraries,
      undefined,
      path,
    );
  assert.equal(
    links.find(
      (link) =>
        link.kind === "imports" && link.data?.path === "github.com/ok/mod",
    ).resolution,
    "library",
  );
});

test("review: in a workspace a version is recorded only when every requiring module names it", async () => {
  const workspace = (b) => ({
    "go.work": lines("go 1.22", "", "use (", "\t./a", "\t./b", ")"),
    "a/go.mod": lines(
      "module example.com/a",
      "",
      "go 1.22",
      "",
      "require github.com/d/dep v1.0.0",
    ),
    "b/go.mod": lines(
      "module example.com/b",
      "",
      "go 1.22",
      "",
      `require github.com/d/dep ${b}`,
    ),
    "a/a.go": lines(
      "package a",
      'import "github.com/d/dep"',
      "func use() { dep.F() }",
    ),
    "b/b.go": lines(
      "package b",
      'import "github.com/d/dep"',
      "func use() { dep.F() }",
    ),
  });
  const raised = await project(workspace("v1.2.0"));
  assert.deepEqual(outcome(at(raised.links, "a/a.go", "dep.F")), {
    ecosystem: "go",
    unit: "github.com/d/dep",
    symbol: "F",
    evidence: "import-binding",
  });
  const same = await project(workspace("v1.0.0"));
  const target = outcome(at(same.links, "a/a.go", "dep.F"));
  assert.equal(target.version, "v1.0.0");
  assert.match(target.versionSource, /^[ab]\/go\.mod$/);
});

test("review 2: a quoted replacement path with spaces is read whole", async () => {
  const { links } = await project({
    "go.mod": lines(
      "module example.com/m",
      "",
      "go 1.22",
      "",
      "require github.com/sp/mod v1.0.0",
      "",
      'replace github.com/sp/mod => "../path with spaces"',
    ),
    "a/a.go": lines(
      "package a",
      'import "github.com/sp/mod"',
      "func use() { mod.F() }",
    ),
  });
  // A directory replacement (outside the checkout, so unseen): never a library.
  assert.deepEqual(outcome(at(links, "a/a.go", "mod.F")), { unresolved: null });
});

test("review 2: a workspace using a module outside the checkout proves no version", async () => {
  const { links } = await project({
    "go.work": lines("go 1.22", "", "use (", "\t./a", "\t../elsewhere", ")"),
    "a/go.mod": lines(
      "module example.com/a",
      "",
      "go 1.22",
      "",
      "require github.com/d/dep v1.0.0",
    ),
    "a/a.go": lines(
      "package a",
      'import "github.com/d/dep"',
      "func use() { dep.F() }",
    ),
  });
  // The outside module may require a higher version: unit and symbol only.
  assert.deepEqual(outcome(at(links, "a/a.go", "dep.F")), {
    ecosystem: "go",
    unit: "github.com/d/dep",
    symbol: "F",
    evidence: "import-binding",
  });
});

test("review: a qualifier two unnamed imports may declare is a set of both units", async () => {
  const { links } = await project({
    "go.mod": lines(
      "module example.com/m",
      "",
      "go 1.22",
      "",
      "require (",
      "\texample.org/client-go v1.0.0",
      "\texample.net/client v1.0.0",
      "\tgithub.com/hashicorp/golang-lru/v2 v2.0.7",
      ")",
    ),
    "c/c.go": lines(
      "package c",
      "import (",
      '\t"example.org/client-go"',
      '\t"example.net/client"',
      '\t"github.com/hashicorp/golang-lru/v2"',
      ")",
      "func use() { client.New(); _ = lru.New }",
    ),
  });
  const unit = (name) => ({
    ecosystem: "go",
    unit: name,
    symbol: "New",
    version: "v1.0.0",
    versionSource: "go.mod",
    evidence: "import-binding",
  });
  assert.deepEqual(outcome(at(links, "c/c.go", "client.New")), {
    set: [unit("example.net/client"), unit("example.org/client-go")],
  });
  // `lru` is no plausible name of `golang-lru/v2`: not followed.
  assert.deepEqual(outcome(at(links, "c/c.go", "lru.New")), {
    unresolved: null,
  });
});

test("review: a test-data tree that supplies the imported package is checkout code", async () => {
  const { links } = await project({
    "go.mod": "module golang.org/x/tools\n\ngo 1.22\n",
    "go/ssa/interp/testdata/src/fmt/fmt.go": lines(
      "package fmt",
      "func Println(...any) {}",
    ),
    "go/ssa/interp/testdata/boundmeth.go": lines(
      "package main",
      'import "fmt"',
      'import "strings"',
      'func main() { fmt.Println(strings.ToUpper("x")) }',
    ),
  });
  const file = "go/ssa/interp/testdata/boundmeth.go";
  assert.equal(at(links, file, "fmt.Println").libraries, undefined);
  assert.deepEqual(outcome(at(links, file, "strings.ToUpper")), {
    ecosystem: "go-std",
    unit: "strings",
    symbol: "ToUpper",
    evidence: "import-binding",
  });
});
