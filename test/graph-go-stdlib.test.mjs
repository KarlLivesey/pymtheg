// SPDX-License-Identifier: MIT
// C-17: members of standard-library types, resolved from the shipped table
// to their declaring owner. Corpus shapes: restic's `exitErr.ExitCode()` on
// an `*exec.ExitError` (declared by os.ProcessState), bbolt's `t.Fatal` on
// `*testing.T` (declared by the unexported testing.common), cli/cli's
// `resp.Body.Close()`, golang/tools' `gob.NewDecoder(r).Decode(v)`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LanguageRegistry } from "../dist/graph/index.js";
import { executeGraph } from "../dist/graph/commands.js";
import { formatGraph } from "../dist/cli/graph.js";
import go from "../dist/graph/languages/go/index.js";
import typescript from "../dist/graph/languages/typescript/index.js";
import { project } from "./fixtures/graph-go/harness.mjs";

const lines = (...items) => [...items, ""].join("\n");
const at = (links, file, text) => {
  const found = links.filter(
    (link) =>
      link.file === file &&
      (link.kind === "calls" || link.kind === "references") &&
      link.at === text,
  );
  assert.equal(found.length, 1, `${file} ${text}: ${JSON.stringify(found)}`);
  return found[0];
};
const outcome = (link) =>
  link.libraries
    ? link.resolution === "library"
      ? `${link.libraries[0].unit} ${link.libraries[0].symbol} ${link.libraries[0].evidence}`
      : "library set"
    : link.target
      ? `checkout ${link.target}`
      : link.candidates.length
        ? "candidates"
        : `unresolved ${link.data?.uncertainty ?? ""}`.trim();
const std = (unit, symbol) => `${unit} ${symbol} declaring-owner`;

test("members of standard-library values resolve to their declaring owner", async () => {
  const { links } = await project({
    "go.mod": lines("module example.com/m", "", "go 1.24"),
    "a/a.go": lines(
      "package a",
      "import (",
      '\t"bytes"',
      '\t"encoding/gob"',
      '\t"errors"',
      '\t"io"',
      '\t"net/http"',
      '\t"os"',
      '\t"os/exec"',
      '\t"strings"',
      '\t"sync/atomic"',
      '\t"testing"',
      '\t"time"',
      ")",
      "func use(t *testing.T, r io.Reader, v any, p []byte, s string, err error) {",
      "\tvar buf bytes.Buffer",
      "\tbuf.Write(p)",
      "\tw := &bytes.Buffer{}",
      "\tw.Len()",
      "\tgob.NewDecoder(r).Decode(v)",
      "\tstrings.NewReader(s).Len()",
      "\ttime.Now().Sub(time.Now())",
      "\tvar exitErr *exec.ExitError",
      "\tif errors.As(err, &exitErr) {",
      "\t\texitErr.ExitCode()",
      "\t}",
      "\tt.Fatal(err)",
      "\tr.Read(p)",
      "\terr.Error()",
      "\tresp, _ := http.Get(s)",
      "\tresp.Body.Close()",
      "\tf := buf.String",
      "\t_ = f",
      "\tvar ptr atomic.Pointer[int]",
      "\tptr.Load()",
      "\tvar mode os.FileMode",
      "\tmode.IsDir()",
      "\tentries, _ := os.ReadDir(s)",
      "\tfor _, entry := range entries {",
      "\t\tentry.Name()",
      "\t}",
      "}",
    ),
  });
  const file = "a/a.go";
  const expected = {
    "buf.Write": std("bytes", "Buffer.Write"),
    "w.Len": std("bytes", "Buffer.Len"),
    "gob.NewDecoder(r).Decode": std("encoding/gob", "Decoder.Decode"),
    "strings.NewReader(s).Len": std("strings", "Reader.Len"),
    "time.Now().Sub": std("time", "Time.Sub"),
    // Promoted from an embedded *os.ProcessState: declared in os.
    "exitErr.ExitCode": std("os", "ProcessState.ExitCode"),
    // Promoted from the unexported testing.common: the owner Go reports.
    "t.Fatal": std("testing", "common.Fatal"),
    // A standard-library interface's method: the interface declaring it.
    "r.Read": std("io", "Reader.Read"),
    "err.Error": std("builtin", "error.Error"),
    // resp.Body is an io.ReadCloser; Close is declared by io.Closer.
    "resp.Body": std("net/http", "Response.Body"),
    "resp.Body.Close": std("io", "Closer.Close"),
    // A method value.
    "buf.String": std("bytes", "Buffer.String"),
    // A generic type: the owner does not depend on the type argument.
    "ptr.Load": std("sync/atomic", "Pointer.Load"),
    // os.FileMode and os.DirEntry are aliases of io/fs types.
    "mode.IsDir": std("io/fs", "FileMode.IsDir"),
    "entry.Name": std("io/fs", "DirEntry.Name"),
  };
  const actual = Object.fromEntries(
    Object.keys(expected).map((text) => [text, outcome(at(links, file, text))]),
  );
  assert.deepEqual(actual, expected);
});

test("a member newer than the module's go directive is not resolved", async () => {
  const { links } = await project({
    "go.mod": lines("module example.com/m", "", "go 1.21"),
    "a/a.go": lines(
      "package a",
      'import "testing"',
      "func use(t *testing.T) {",
      "\tt.Context()",
      "\tt.Helper()",
      "}",
    ),
  });
  // Context is in Go 1.24; a go 1.21 module may be built without it.
  assert.equal(
    outcome(at(links, "a/a.go", "t.Context")),
    "unresolved library-member-unproven",
  );
  assert.equal(
    outcome(at(links, "a/a.go", "t.Helper")),
    std("testing", "common.Helper"),
  );
});

test("project types embedding a standard-library type follow Go's depth rule", async () => {
  const { links } = await project({
    "go.mod": lines("module example.com/m", "", "go 1.22"),
    "a/a.go": lines(
      "package a",
      'import "sync"',
      "type Guarded struct {",
      "\tsync.Mutex",
      "\tn int",
      "}",
      // A project method at a shallower depth shadows the embedded one.
      "type Own struct{ sync.Mutex }",
      "func (o *Own) Lock() {}",
      // Two embedded types with Lock at the same depth: ambiguous in Go.
      "type Both struct {",
      "\tsync.Mutex",
      "\tRW sync.RWMutex",
      "\tInner",
      "}",
      "type Inner struct{ sync.RWMutex }",
      "type Twice struct {",
      "\tsync.Mutex",
      "\tLocker",
      "}",
      "type Locker struct{}",
      "func (Locker) Lock() {}",
      "func use(g *Guarded, o *Own, b *Both, tw *Twice) {",
      "\tg.Lock()",
      "\to.Lock()",
      "\to.Unlock()",
      // Mutex at depth 1 wins over Inner's RWMutex at depth 2.
      "\tb.Lock()",
      "\tb.RLock()",
      "\ttw.Lock()",
      "}",
    ),
  });
  const file = "a/a.go";
  assert.equal(outcome(at(links, file, "g.Lock")), std("sync", "Mutex.Lock"));
  assert.match(outcome(at(links, file, "o.Lock")), /^checkout /);
  assert.equal(
    outcome(at(links, file, "o.Unlock")),
    std("sync", "Mutex.Unlock"),
  );
  assert.equal(outcome(at(links, file, "b.Lock")), std("sync", "Mutex.Lock"));
  assert.equal(
    outcome(at(links, file, "b.RLock")),
    std("sync", "RWMutex.RLock"),
  );
  // Locker.Lock and Mutex.Lock both at depth 1: not resolved.
  assert.equal(outcome(at(links, file, "tw.Lock")), "unresolved");
});

test("names that are not the standard library are never taken for it", async () => {
  const { links } = await project({
    "go.mod": lines(
      "module example.com/m",
      "",
      "go 1.22",
      "",
      "require github.com/other/bytes v1.0.0",
    ),
    // A project type with a standard type's name, and a package-level
    // variable shadowing a package name.
    "a/a.go": lines(
      "package a",
      'import "strings"',
      "type Buffer struct{}",
      "func (Buffer) Size() int { return 0 }",
      "var strings2 = strings.NewReader",
      "func use() {",
      "\tvar b Buffer",
      "\tb.Size()",
      "\tb.Len()",
      "}",
    ),
    "b/b.go": lines(
      "package b",
      'import "bytes"',
      "type thing struct{ Buffer int }",
      "var bytes = thing{}",
      "func use() int { return bytes.Buffer }",
    ),
    // A dependency whose package is also called bytes.
    "c/c.go": lines(
      "package c",
      'import "github.com/other/bytes"',
      "func use() {",
      "\tvar buf bytes.Buffer",
      "\tbuf.Write(nil)",
      "}",
    ),
  });
  assert.match(outcome(at(links, "a/a.go", "b.Size")), /^checkout /);
  assert.equal(outcome(at(links, "a/a.go", "b.Len")), "unresolved");
  assert.equal(
    outcome(at(links, "c/c.go", "buf.Write")),
    "unresolved library-member-unproven",
  );
});

test("graph uses finds a member by the exported type it is selected through", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-go-stdlib-"));
  const root = join(scratch, "project");
  const files = {
    "go.mod": lines("module example.com/m", "", "go 1.22"),
    "a/a_test.go": lines(
      "package a",
      'import "testing"',
      "func TestA(t *testing.T) { t.Fatal(1) }",
      "func BenchmarkA(b *testing.B) { b.Fatal(1) }",
    ),
  };
  try {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    const registry = new LanguageRegistry([go]);
    const graph = (command, ...args) =>
      executeGraph({ command, args, root }, { registry });
    await graph("index");
    const uses = await graph("uses", "testing", "T.Fatal");
    // Both selections are of the one declaration, testing.common.Fatal.
    assert.deepEqual(uses.data.library.declaredBy, {
      unit: "testing",
      symbol: "common.Fatal",
    });
    assert.deepEqual(uses.data.classCounts, { library: 2, candidateSet: 0 });
    assert.match(
      formatGraph(uses),
      /Uses of library "testing" symbol "T.Fatal", declared by "testing" symbol "common.Fatal"/,
    );
    // An exported declaring owner is queried as itself.
    const own = await graph("uses", "testing", "T.Parallel");
    assert.equal(own.data.library.declaredBy, undefined);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("review: a type name aliased differently in build variants proves no owner", async () => {
  const { links } = await project({
    "go.mod": lines("module example.com/m", "", "go 1.22"),
    "a/alias_linux.go": lines(
      "package a",
      'import "bytes"',
      "type Buffer = bytes.Buffer",
    ),
    "a/alias_windows.go": lines(
      "package a",
      'import "strings"',
      "type Buffer = strings.Reader",
    ),
    "a/use.go": lines(
      "package a",
      "func use(b *Buffer) int { return b.Len() }",
    ),
    // Every variant aliases the same type: its owner holds in every build.
    "b/alias_linux.go": lines(
      "package b",
      'import "bytes"',
      "type Buffer = bytes.Buffer",
    ),
    "b/alias_other.go": lines(
      "//go:build !linux",
      "",
      "package b",
      'import "bytes"',
      "type Buffer = bytes.Buffer",
    ),
    "b/use.go": lines(
      "package b",
      "func use(b *Buffer) int { return b.Len() }",
    ),
  });
  assert.equal(
    outcome(at(links, "a/use.go", "b.Len")),
    "unresolved library-member-unproven",
  );
  assert.equal(
    outcome(at(links, "b/use.go", "b.Len")),
    std("bytes", "Buffer.Len"),
  );
});

test("review: graph uses leaves another ecosystem's unit as written", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-go-stdlib-"));
  const root = join(scratch, "project");
  const files = {
    "package.json": JSON.stringify({ dependencies: { testing: "1.0.0" } }),
    "a.ts": lines('import { T } from "testing";', "T.Fatal();"),
  };
  try {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    const registry = new LanguageRegistry([go, typescript]);
    const graph = (command, ...args) =>
      executeGraph({ command, args, root }, { registry });
    await graph("index");
    const uses = await graph("uses", "testing", "T.Fatal");
    // No Go standard-library target of `testing`: no Go owner is substituted.
    assert.equal(uses.data.library.declaredBy, undefined);
    assert.deepEqual(uses.data.library, {
      unit: "testing",
      symbol: "T.Fatal",
      place: "outside-project",
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
