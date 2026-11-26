// SPDX-License-Identifier: MIT
// C-4: member links through slice, map, channel and range element types, and
// fields of anonymous, nested and function-local structs. Fixtures follow real
// corpus shapes (cobra args_test.go table tests, pebble's nested anonymous
// `Local` settings, chi's named map-of-slices router, macho's embedded
// external interface).
import assert from "node:assert/strict";
import { test } from "node:test";
import { deepFreeze } from "../dist/graph/kept-input.js";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  checkCodeLinks,
  createCodeLink,
  createRequirement,
} from "../dist/architecture/code-links.js";
import { project } from "./fixtures/graph-go/harness.mjs";

const MOD = "module example.com/m\n\ngo 1.22\n";
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

test("cobra table test: fields of a ranged map of anonymous structs, also inside a closure", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "args_test.go": lines(
      "package cobra",
      'import "testing"',
      "func run(args ...string) error { return nil }",
      "func TestMatchAll(t *testing.T) {",
      "\ttestCases := map[string]struct {",
      "\t\targs []string",
      "\t\tfail bool",
      "\t}{",
      '\t\t"happy path": {[]string{"aa"}, false},',
      "\t}",
      "\tfor name, tc := range testCases {",
      "\t\tt.Run(name, func(t *testing.T) {",
      "\t\t\terr := run(tc.args...)",
      "\t\t\tif err != nil && !tc.fail {",
      "\t\t\t\tt.Errorf(name)",
      "\t\t\t}",
      "\t\t})",
      "\t}",
      "\tfor i := range []struct{ want int }{} { _ = i }",
      "}",
    ),
  });
  assert.equal(
    at(links, "args_test.go", "tc.args").target,
    "args_test.go:field:args_test.go:TestMatchAll.anon#1.args",
  );
  assert.equal(
    at(links, "args_test.go", "tc.fail").target,
    "args_test.go:field:args_test.go:TestMatchAll.anon#1.fail",
  );
});

test("slice, array, map value and key, channel receive and range variables of anonymous structs", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "q/q.go": lines(
      "package q",
      "type Kid struct{ Age int }",
      "func (Kid) Run() {}",
      "func Use(c chan struct{ C Kid }) {",
      '\ttests := []struct{ name string; kid Kid }{{name: "a"}}',
      "\tfor _, tc := range tests {",
      "\t\ttc.kid.Run()",
      "\t}",
      "\t_ = tests[0].name",
      "\tvar arr [2]struct{ A int }",
      "\t_ = arr[1].A",
      "\tm := map[struct{ K int }]struct{ V Kid }{}",
      "\tfor k, v := range m { _ = k.K; v.V.Run() }",
      "\t(<-c).C.Run()",
      "\tfor x := range c { _ = x.C }",
      "\tvar w struct{ X int }",
      "\t_ = w.X",
      "}",
    ),
  });
  const target = (text) => at(links, "q/q.go", text).target;
  assert.equal(target("tc.kid"), "q/q.go:field:q.go:Use.anon#2.kid");
  assert.equal(target("tc.kid.Run"), "q/q.go:method:(Kid).Run");
  assert.equal(target("tests[0].name"), "q/q.go:field:q.go:Use.anon#2.name");
  assert.equal(target("arr[1].A"), "q/q.go:field:q.go:Use.anon#3.A");
  assert.equal(target("k.K"), "q/q.go:field:q.go:Use.anon#4.K");
  assert.equal(target("v.V"), "q/q.go:field:q.go:Use.anon#5.V");
  assert.equal(target("v.V.Run"), "q/q.go:method:(Kid).Run");
  assert.equal(target("(<-c).C"), "q/q.go:field:q.go:Use.anon#1.C");
  assert.equal(target("(<-c).C.Run"), "q/q.go:method:(Kid).Run");
  assert.equal(target("x.C"), "q/q.go:field:q.go:Use.anon#1.C");
  assert.equal(target("w.X"), "q/q.go:field:q.go:Use.anon#6.X");
});

test("pebble: a nested anonymous struct field of a named struct, from another file and package", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "settings/settings.go": lines(
      "package settings",
      'import "io/fs"',
      "type Settings struct {",
      "\tLocal struct {",
      "\t\tFS        fs.FS",
      "\t\tFSDirName string",
      "\t}",
      "}",
    ),
    "provider/vfs.go": lines(
      "package provider",
      'import "example.com/m/settings"',
      "type provider struct{ st settings.Settings }",
      "func makePath(fs any, dir string) string { return dir }",
      "func (p *provider) path() string {",
      "\treturn makePath(p.st.Local.FS, p.st.Local.FSDirName)",
      "}",
    ),
    "provider/db.go": lines(
      "package provider",
      "type DB struct {",
      "\tmu struct {",
      "\t\tmem struct{ queue []int }",
      "\t\tlog struct{ manager *provider }",
      "\t}",
      "}",
      "func (d *DB) flush() int {",
      "\td.mu.log.manager.path()",
      "\treturn len(d.mu.mem.queue)",
      "}",
    ),
  });
  const target = (file, text) => at(links, file, text).target;
  for (const link of links.filter((item) => item.at === "p.st.Local"))
    assert.equal(link.target, "settings/settings.go:field:Settings.Local");
  assert.equal(
    target("provider/vfs.go", "p.st.Local.FS"),
    "settings/settings.go:field:settings.go:Settings.Local.anon#1.FS",
  );
  assert.equal(
    target("provider/vfs.go", "p.st.Local.FSDirName"),
    "settings/settings.go:field:settings.go:Settings.Local.anon#1.FSDirName",
  );
  assert.equal(
    target("provider/db.go", "d.mu.mem.queue"),
    "provider/db.go:field:db.go:DB.mu.anon#1.mem.anon#1.queue",
  );
  assert.equal(
    target("provider/db.go", "d.mu.log.manager.path"),
    "provider/vfs.go:method:(*provider).path",
  );
});

test("chi: range over a named map-of-slices type, and an index of it", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "middleware/route_headers.go": lines(
      "package middleware",
      "type HeaderRouter map[string][]HeaderRoute",
      "type Routes HeaderRouter",
      "type HeaderRoute struct{ Middleware func() }",
      "func (r HeaderRoute) IsMatch(value string) bool { return true }",
      "func (hr HeaderRouter) Handler() {",
      "\tfor header, matchers := range hr {",
      "\t\tfor _, matcher := range matchers {",
      "\t\t\tif matcher.IsMatch(header) {",
      "\t\t\t\tmatcher.Middleware()",
      "\t\t\t}",
      "\t\t}",
      "\t}",
      '\tif hr["*"][0].Middleware == nil {',
      "\t}",
      "}",
      'func (r Routes) First() bool { return r["a"][0].IsMatch("") }',
    ),
  });
  const target = (text) => at(links, "middleware/route_headers.go", text);
  assert.equal(
    target("matcher.IsMatch").target,
    "middleware/route_headers.go:method:(HeaderRoute).IsMatch",
  );
  assert.equal(
    target('hr["*"][0].Middleware').target,
    "middleware/route_headers.go:field:HeaderRoute.Middleware",
  );
  assert.equal(
    target('r["a"][0].IsMatch').target,
    "middleware/route_headers.go:method:(HeaderRoute).IsMatch",
  );
});

test("promotion through an anonymous struct's embedded types: shallowest depth wins", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "q/q.go": lines(
      "package q",
      "type A struct{ N int; Deep int }",
      "func (A) M() {}",
      "type B struct{ A }",
      "func Use() {",
      "\tz := struct {",
      "\t\tB",
      "\t\tN string",
      "\t}{}",
      "\t_ = z.N",
      "\t_ = z.Deep",
      "\tz.M()",
      "}",
    ),
  });
  const target = (text) => at(links, "q/q.go", text).target;
  assert.equal(target("z.N"), "q/q.go:field:q.go:Use.struct#1.N");
  assert.equal(target("z.Deep"), "q/q.go:field:A.Deep");
  assert.equal(target("z.M"), "q/q.go:method:(A).M");
});

test("values of a function-local struct type resolve to its fields", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "q/q.go": lines(
      "package q",
      "type Kid struct{}",
      "func (Kid) Run() {}",
      "func Use() {",
      "\ttype row struct{ Y int; K Kid }",
      "\tvar l row",
      "\t_ = l.Y",
      "\tl.K.Run()",
      "\trows := []row{{Y: 1}}",
      "\tfor _, r := range rows { _ = r.Y }",
      "}",
      "func Other() {",
      "\ttype row struct{ Y int }",
      "\t_ = row{}.Y",
      "}",
    ),
  });
  const all = links.filter(
    (link) => link.file === "q/q.go" && link.at === "r.Y",
  );
  assert.equal(all.length, 1);
  const target = (text) => at(links, "q/q.go", text).target;
  assert.equal(target("l.Y"), "q/q.go:field:q.go:Use.row.Y");
  assert.equal(target("l.K.Run"), "q/q.go:method:(Kid).Run");
  assert.equal(target("r.Y"), "q/q.go:field:q.go:Use.row.Y");
  assert.equal(target("row{}.Y"), "q/q.go:field:q.go:Other.row.Y");
});

test("never definite: equal-depth promotion, external element and embedded types, generics, interfaces", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "q/q.go": lines(
      "package q",
      "import (",
      '\t"bytes"',
      '\t"io"',
      ")",
      "type A struct{ N int }",
      "type B struct{ N int }",
      "type SegmentHeader struct{ Maxprot uint32 }",
      "type Segment struct {",
      "\tSegmentHeader",
      "\tio.ReaderAt",
      "\tsr int",
      "}",
      "type I interface{ M() }",
      "type T struct{}",
      "func (T) M() {}",
      "type L[E any] []E",
      "func G[E any](xs []E, l L[T]) {",
      "\txs[0].M()",
      "\tl[0].M()",
      "}",
      "func Use(bs []bytes.Buffer, is []I, s *Segment) {",
      "\tamb := struct{ A; B }{}",
      "\t_ = amb.N",
      "\t_ = bs[0].Len()",
      "\tr := struct {",
      "\t\tio.Reader",
      "\t\tX int",
      "\t}{}",
      "\t_ = r.X",
      "\t_, _ = r.Read(nil)",
      "\tis[0].M()",
      "\t_ = s.Maxprot",
      "\t_ = s.sr",
      "}",
    ),
  });
  const get = (text) => at(links, "q/q.go", text);
  // Two N fields at depth 1: illegal to select in Go; both stay candidates.
  const amb = get("amb.N");
  assert.equal(amb.target, null);
  assert.deepEqual(amb.candidates, ["q/q.go:field:A.N", "q/q.go:field:B.N"]);
  // Members of types outside the checkout: no target, no candidates.
  for (const text of ["bs[0].Len", "r.Read", "xs[0].M", "l[0].M"]) {
    const found = get(text);
    assert.equal(found.target, null, text);
    assert.deepEqual(found.candidates, [], text);
  }
  // An external embedded type at the same depth could supply an exported name.
  assert.equal(get("s.Maxprot").target, null);
  assert.equal(get("s.sr").target, "q/q.go:field:Segment.sr");
  assert.equal(get("r.X").target, "q/q.go:field:q.go:Use.struct#2.X");
  // Interface elements stay dispatch candidate sets.
  const dispatch = get("is[0].M");
  assert.equal(dispatch.target, null);
  assert.deepEqual(dispatch.candidates, [
    "q/q.go:method:(T).M",
    "q/q.go:method:I.M",
  ]);
});

test("build variants: an anonymous struct field of a type declared in two variant files is not definite", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "q/t_linux.go": lines("package q", "type T struct{ mu struct{ n int } }"),
    "q/t_windows.go": lines("package q", "type T struct{ mu struct{ n int } }"),
    "q/use.go": lines(
      "package q",
      "func Use(t T) int {",
      "\tfor _, x := range []struct{ n int }{} { _ = x.n }",
      "\treturn t.mu.n",
      "}",
    ),
  });
  assert.equal(at(links, "q/use.go", "t.mu.n").target, null);
  // The ranged literal is the use file's own: definite.
  assert.equal(
    at(links, "q/use.go", "x.n").target,
    "q/use.go:field:use.go:Use.anon#1.n",
  );
});

test("the outcome does not depend on the order the store supplies files, symbols and links", async () => {
  // fiber router_skip.go: `cand.idx` sits at the depth limit; whether a
  // shallower route had already cached part of its chain used to depend on
  // the order the indexer happened to read the files in.
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { dirname, join } = await import("node:path");
  const { LanguageRegistry, SqliteGraphStore, indexProject } = await import(
    "../dist/graph/index.js"
  );
  const go = (await import("../dist/graph/languages/go/index.js")).default;
  const files = {
    "go.mod": MOD,
    // graph-go-review2 case 4: an invalid interface (two different M) has no
    // implementers in any order the embeds are met in.
    "p/p.go": lines(
      "package p",
      "type I interface{ M() }",
      "type X interface{ M() int }",
      "type Bad interface{ I; X }",
      "type T struct{}",
      "func (T) M() {}",
    ),
    "app.go": lines(
      "package fiber",
      "type App struct {",
      "\tskip   skipRouteIndex",
      "\tconfig Config",
      "}",
      "type Config struct{ RequestMethods []string }",
      "type Route struct{ path string }",
      "func (r *Route) prefixRejects(head uint64) bool { return false }",
      "func (r *Route) match(a, b string) bool { return true }",
    ),
    "router_skip.go": lines(
      "package fiber",
      "type skipRouteIndex struct {",
      "\tstaticMethods map[string]uint64",
      "\tbuckets       map[int]*skipBucket",
      "\tzeroBucket    *skipBucket",
      "\tenabled       bool",
      "}",
      "type skipBucket struct {",
      "\tcands     [][]indexedRoute",
      "\tparamMask uint64",
      "}",
      "type indexedRoute struct {",
      "\troute *Route",
      "\tidx   int",
      "}",
      "type skipResult struct{ matchIndex int }",
      "func (app *App) resolveSkip(methodInt, treeHash int, path string) skipResult {",
      "\tskip := &app.skip",
      "\tb, ok := skip.buckets[treeHash]",
      "\tif !ok {",
      "\t\tb = skip.zeroBucket",
      "\t}",
      "\tfor _, cand := range b.cands[methodInt] {",
      "\t\tif cand.route.prefixRejects(0) {",
      "\t\t\tcontinue",
      "\t\t}",
      "\t\tif cand.route.match(path, path) {",
      "\t\t\treturn skipResult{matchIndex: cand.idx}",
      "\t\t}",
      "\t}",
      "\tfor m := range app.config.RequestMethods {",
      "\t\tfor _, cand := range b.cands[m] {",
      "\t\t\t_ = cand.idx",
      "\t\t}",
      "\t}",
      "\treturn skipResult{matchIndex: -1}",
      "}",
    ),
  };
  const run = async (reverse) => {
    const scratch = await mkdtemp(join(tmpdir(), "pymtheg-graph-go-order-"));
    const root = join(scratch, "project");
    const store = new SqliteGraphStore(
      join(scratch, "graph.sqlite"),
      "go-test",
    );
    try {
      for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), text);
      }
      // Another order the store may supply: reversed, with the deepest
      // links (`cand.idx`) first.
      const flip = (items) => (reverse ? [...items].reverse() : items);
      const deepFirst = (links) =>
        reverse
          ? [
              ...links.filter((link) => link.targetName === "cand.idx"),
              ...flip(links.filter((link) => link.targetName !== "cand.idx")),
            ]
          : links;
      const module = {
        ...go,
        resolve: (context) =>
          // Frozen, as the indexer hands Go its inputs under the tests.
          go.resolve({
            ...context,
            files: deepFreeze(flip(context.files)),
            symbols: deepFreeze(flip(context.symbols)),
            links: deepFreeze(deepFirst(context.links)),
          }),
      };
      const report = await indexProject(
        root,
        new LanguageRegistry([module]),
        store,
      );
      assert.deepEqual(report.resolutionErrors, []);
      const symbols = new Map(
        store
          .findSymbols()
          .map((item) => [item.id, `${item.file}:${item.identity}`]),
      );
      return store
        .links()
        .map(
          (link) =>
            `${link.file}:${link.range.start}:${link.kind}:${link.targetName} -> ${
              symbols.get(link.targetId) ?? link.resolution
            }`,
        )
        .sort();
    } finally {
      store.close();
      await rm(scratch, { recursive: true, force: true });
    }
  };
  const forward = await run(false);
  assert.deepEqual(await run(true), forward);
  assert.ok(!forward.some((line) => line.includes(":implements:Bad ->")));
  assert.equal(
    forward.filter((line) => line.includes(":implements:I ->")).length,
    1,
  );
  const idx = forward.filter((line) => line.includes(":cand.idx ->"));
  assert.equal(idx.length, 2);
  for (const line of idx)
    assert.ok(line.endsWith("router_skip.go:indexedRoute.idx"), line);
});

test("build variants: a field or method promoted differently per variant is never one variant's definite target", async () => {
  // Review of C-4: `items[0].Name` was definite to the Windows field while
  // the Linux build selects the promoted `forwarded.Name`.
  const { links } = await project({
    "go.mod": MOD,
    "v/value_windows.go": lines(
      "package v",
      "type Item struct{ Name string }",
      "func (Item) Run() {}",
    ),
    "v/value_linux.go": lines(
      "package v",
      "type Item struct{ forwarded }",
      "type forwarded struct{ Name string }",
      "func (forwarded) Run() {}",
    ),
    "v/shared.go": lines(
      "package v",
      "type Items []Item",
      "type Same struct{ ID int }",
      "func Use(items Items, it Item, s []Same) {",
      "\t_ = items[0].Name",
      "\titems[0].Run()",
      "\t_ = it.Name",
      "\t_ = s[0].ID",
      "}",
    ),
  });
  const get = (text) => at(links, "v/shared.go", text);
  for (const text of ["items[0].Name", "it.Name"]) {
    assert.equal(get(text).target, null, text);
    assert.deepEqual(
      get(text).candidates,
      [
        "v/value_linux.go:field:forwarded.Name",
        "v/value_windows.go:field:Item.Name",
      ],
      text,
    );
  }
  assert.equal(get("items[0].Run").target, null);
  assert.deepEqual(get("items[0].Run").candidates, [
    "v/value_linux.go:method:(forwarded).Run",
    "v/value_windows.go:method:(Item).Run",
  ]);
  // One declaration: definite.
  assert.equal(get("s[0].ID").target, "v/shared.go:field:Same.ID");
});

test("a field-less struct{} is not a symbol", async () => {
  const { symbols } = await project({
    "go.mod": MOD,
    "q/q.go": lines(
      "package q",
      "var set = map[string]struct{}{}",
      "func Use(done chan struct{}) { done <- struct{}{}; _ = set }",
    ),
  });
  assert.deepEqual(
    symbols
      .filter((item) => item.kind === "struct")
      .map((item) => item.identity),
    [],
  );
});

test("an answer cut short by the depth limit is not cached for shallower routes to the same type", async () => {
  // A long chain of defined container types is first reached from p/a.go at
  // the depth limit; the same types, reached later through fields declared
  // beside them, are shallow enough to resolve and must.
  const n = 14;
  const chain = Array.from({ length: n }, (_, i) =>
    i + 1 < n ? `type A${i} A${i + 1}` : `type A${i} []T`,
  );
  const { links } = await project({
    "go.mod": MOD,
    "p/a.go": lines("package p", "func deep(x A0) int { return x[0].F }"),
    "p/types.go": lines(
      "package p",
      ...chain,
      "type T struct{ F int }",
      `type Holder struct{ ${chain.map((_, i) => `a${i} A${i}`).join("; ")} }`,
    ),
    "p/z.go": lines(
      "package p",
      ...chain.map(
        (_, i) => `func s${i}(h Holder) int { return h.a${i}[0].F }`,
      ),
    ),
  });
  // Beyond the limit: no target (never a guess).
  assert.equal(at(links, "p/a.go", "x[0].F").target, null);
  for (let i = 4; i < n; i++)
    assert.equal(
      at(links, "p/z.go", `h.a${i}[0].F`).target,
      "p/types.go:field:T.F",
      `a${i}`,
    );
});

test("a requirement link to an anonymous struct's field keeps its anchor; renaming the owner is missing", async () => {
  // Review of C-4: a file-wide counter gave an inserted `Unrelated` the
  // linked struct's old identity, and `link check` said ok on the wrong
  // declaration. The identity is anchored to the owning declaration.
  let tick = 0;
  const writer = {
    origin: { machine: "machine-1", actor: "actor-1", author: "Link Tester" },
    now: () => new Date(Date.UTC(2026, 10, 15, 12, 0, tick++)).toISOString(),
  };
  const root = await mkdtemp(join(tmpdir(), "pym-go-anon-link-"));
  const first = "var First = struct {\n\tValue int\n}{}\n";
  const unrelated = "var Unrelated = struct {\n\tValue int\n}{}\n\n";
  try {
    await writeFile(join(root, "go.mod"), MOD);
    await mkdir(join(root, "p"));
    await writeFile(join(root, "p/id.go"), `package p\n\n${first}`);
    await promisify(execFile)(process.execPath, [
      join(import.meta.dirname, "..", "dist", "cli", "main.js"),
      "init",
      root,
      "--format",
      "json",
    ]);
    await createRequirement({ root, id: "R1", title: "First" });
    const made = await createCodeLink({
      root,
      writer,
      record: "R1",
      selector: "p/id.go:4",
    });
    assert.equal(made.status, "created", made.message);
    assert.equal(made.link.symbol.identity, "id.go:First.anon#1.Value");
    await writeFile(join(root, "p/id.go"), `package p\n\n${unrelated}${first}`);
    const kept = (await checkCodeLinks({ root, writer })).links[0];
    assert.equal(kept.state, "ok");
    assert.equal(kept.current.identity, "id.go:First.anon#1.Value");
    await writeFile(
      join(root, "p/id.go"),
      `package p\n\n${unrelated}${first.replace("First", "Second")}`,
    );
    const check = await checkCodeLinks({ root, writer });
    assert.equal(check.links[0].state, "missing");
    assert.equal(check.passed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("search and file listings put generated anonymous-struct symbols after named declarations", async () => {
  // bbolt: `graph search name` filled its first page with table-test
  // `name` fields and pushed `(*worker).name` down.
  const { LanguageRegistry, SqliteGraphStore, indexProject } = await import(
    "../dist/graph/index.js"
  );
  const go = (await import("../dist/graph/languages/go/index.js")).default;
  const scratch = await mkdtemp(join(tmpdir(), "pym-go-anon-search-"));
  const root = join(scratch, "project");
  const store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "go-test");
  try {
    await mkdir(join(root, "p"), { recursive: true });
    await writeFile(join(root, "go.mod"), MOD);
    const table = (test) =>
      `func ${test}() {\n\tfor _, tt := range []struct{ name string }{} { _ = tt.name }\n}`;
    await writeFile(
      join(root, "p/a_test.go"),
      lines("package p", table("TestA"), table("TestB"), table("TestC")),
    );
    await writeFile(
      join(root, "p/worker.go"),
      lines(
        "package p",
        "type worker struct{}",
        'func (w *worker) name() string { return "" }',
      ),
    );
    await indexProject(root, new LanguageRegistry([go]), store);
    const first = store.searchSymbols("name", 2);
    assert.equal(first[0].identity, "(*worker).name");
    const all = store.searchSymbols("name", 10);
    assert.equal(all.length, 4);
    assert.deepEqual(
      all.slice(1).map((item) => [item.kind, !!item.data?.anonymous]),
      [
        ["field", true],
        ["field", true],
        ["field", true],
      ],
    );
    const listed = store.symbolsForFile("p/a_test.go", 3);
    assert.deepEqual(listed.map((item) => item.kind).sort(), [
      "file",
      "function",
      "function",
    ]);
  } finally {
    store.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("generic named containers: over a non-generic container they resolve, a generic literal does not", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "q/q.go": lines(
      "package q",
      "type Row struct{ N int }",
      "type Rows []Row",
      "type Gen[T any] Rows",
      "type L[E any] []E",
      "func Use(g Gen[string], l L[Row]) {",
      "\t_ = g[0].N",
      "\t_ = l[0].N",
      "}",
    ),
  });
  assert.equal(at(links, "q/q.go", "g[0].N").target, "q/q.go:field:Row.N");
  assert.equal(at(links, "q/q.go", "l[0].N").target, null);
  assert.deepEqual(at(links, "q/q.go", "l[0].N").candidates, []);
});

test("build variants: a link in a constrained file sees only the variants built with it", async () => {
  // ebpf internal/testutils/netns_linux.go: NetNS is also declared in a
  // `//go:build !linux` file; inside the Linux file it is the Linux NetNS.
  const { links } = await project({
    "go.mod": MOD,
    "t/netns_linux.go": lines(
      "package t",
      "type NetNS struct{ f int }",
      "func (h *NetNS) close() {}",
      "func use(ns *NetNS) { ns.close(); _ = ns.f }",
    ),
    "t/netns_other.go": lines(
      "//go:build !linux",
      "",
      "package t",
      "type NetNS struct{}",
    ),
    "t/extra_unix.go": lines(
      "//go:build unix && !linux",
      "",
      "package t",
      "func (h *NetNS) extra() {}",
      "func use2(ns *NetNS) { ns.extra() }",
    ),
  });
  assert.equal(
    at(links, "t/netns_linux.go", "ns.close").target,
    "t/netns_linux.go:method:(*NetNS).close",
  );
  assert.equal(
    at(links, "t/netns_linux.go", "ns.f").target,
    "t/netns_linux.go:field:NetNS.f",
  );
  // `unix && !linux` builds only with the `!linux` declaration, which the
  // method's constraint implies: definite.
  assert.equal(
    at(links, "t/extra_unix.go", "ns.extra").target,
    "t/extra_unix.go:method:(*NetNS).extra",
  );
});

test("an embedding anonymous struct inside field-only ones keeps its 0.1.0 identity", async () => {
  // cli/cli api/queries_repo.go: `LastCommit.struct#1` (0.1.0) sits inside
  // field-only anonymous structs that were not symbols then.
  const { symbols } = await project({
    "go.mod": MOD,
    "api/queries_repo.go": lines(
      "package api",
      "type Commit struct{ OID string }",
      "func LastCommit() {",
      "\tvar responseData struct {",
      "\t\tRepository struct {",
      "\t\t\tTarget struct{ Commit }",
      "\t\t}",
      "\t}",
      "\t_ = responseData.Repository.Target.OID",
      "}",
    ),
  });
  const identities = symbols
    .filter(
      (item) => item.kind === "struct" && item.file === "api/queries_repo.go",
    )
    .map((item) => item.identity)
    .sort();
  assert.deepEqual(
    identities,
    [
      "queries_repo.go:LastCommit.anon#1",
      "queries_repo.go:LastCommit.anon#1.Repository.anon#1",
      "queries_repo.go:LastCommit.struct#1",
      "Commit",
    ].sort(),
  );
});

test("build variants: the declaration every build of the file includes, and cgo files", async () => {
  // pebble tool/make_test_find_db.go declares `db` behind its own tag, as
  // another tool file does; mattn/go-sqlite3: a cgo file and a `!cgo` mock.
  const { links } = await project({
    "go.mod": MOD,
    "tool/make_test_find_db.go": lines(
      "//go:build make_test_find_db",
      "",
      "package tool",
      "type db struct{ comparer int }",
      "func (d *db) use() int { return d.comparer }",
    ),
    "tool/make_other.go": lines(
      "//go:build make_other",
      "",
      "package tool",
      "type db struct{ other int }",
    ),
    "s/sqlite3.go": lines(
      "package s",
      'import "C"',
      "type SQLiteConn struct{ db int }",
      "func (c *SQLiteConn) Exec() {}",
    ),
    "s/static_mock.go": lines(
      "//go:build !cgo",
      "",
      "package s",
      "type SQLiteConn struct{}",
    ),
    "s/load_extension.go": lines(
      "//go:build !sqlite_omit_load_extension",
      "",
      "package s",
      'import "C"',
      "func (c *SQLiteConn) load() int { return c.db }",
    ),
    // No `import "C"`: both declarations may build with it, but only the
    // cgo one has Exec, so only there does this file compile.
    "s/vtable_test.go": lines(
      "package s",
      "func use(c *SQLiteConn) { c.Exec() }",
    ),
  });
  assert.equal(
    at(links, "s/vtable_test.go", "c.Exec").target,
    "s/sqlite3.go:method:(*SQLiteConn).Exec",
  );
  assert.equal(
    at(links, "tool/make_test_find_db.go", "d.comparer").target,
    "tool/make_test_find_db.go:field:db.comparer",
  );
  assert.equal(
    at(links, "s/load_extension.go", "c.db").target,
    "s/sqlite3.go:field:SQLiteConn.db",
  );
});

test("build variants: a method that may or may not be built with a variant is a choice of configuration", async () => {
  // mattn/go-sqlite3 _example/vtable: CreateModule is declared in a
  // `sqlite_vtable` cgo file; the example compiles only where it exists.
  const { links } = await project({
    "go.mod": MOD,
    "s/sqlite3.go": lines(
      "package s",
      'import "C"',
      "type Inner struct{}",
      "func (Inner) Alt() {}",
      "type SQLiteConn struct{ Inner }",
    ),
    "s/static_mock.go": lines(
      "//go:build !cgo",
      "",
      "package s",
      "type SQLiteConn struct{}",
    ),
    "s/sqlite3_opt_vtable.go": lines(
      "//go:build sqlite_vtable",
      "",
      "package s",
      'import "C"',
      "func (c *SQLiteConn) CreateModule() {}",
      "func (c *SQLiteConn) Alt() {}",
    ),
    "example/main.go": lines(
      "package main",
      'import "example.com/m/s"',
      "func use(c *s.SQLiteConn) {",
      "\tc.CreateModule()",
      "\tc.Alt()",
      "}",
    ),
  });
  assert.equal(
    at(links, "example/main.go", "c.CreateModule").target,
    "s/sqlite3_opt_vtable.go:method:(*SQLiteConn).CreateModule",
  );
  // Without the tag, Alt is the one promoted from Inner: two answers.
  const alt = at(links, "example/main.go", "c.Alt");
  assert.equal(alt.target, null);
  assert.deepEqual(alt.candidates, [
    "s/sqlite3.go:method:(Inner).Alt",
    "s/sqlite3_opt_vtable.go:method:(*SQLiteConn).Alt",
  ]);
});

test("build constraints: every legacy +build line holds; a caller's constraint excludes a method; release tags are cumulative", async () => {
  // Review of C-4, round 2.
  const { links } = await project({
    "go.mod": MOD,
    // 1. Two legacy lines are ANDed: value_legacy.go is Windows only.
    "a/value_legacy.go": lines(
      "// +build linux windows",
      "// +build !linux",
      "",
      "package a",
      "type Item struct{ Name string }",
      "func (Item) M() {}",
    ),
    "a/value_other.go": lines(
      "//go:build linux",
      "",
      "package a",
      "type Item struct{ Name string }",
      "func (Item) M() {}",
    ),
    "a/use.go": lines(
      "//go:build linux",
      "",
      "package a",
      "type Items []Item",
      "func use(items Items) { _ = items[0].Name; items[0].M() }",
    ),
    // 2. The `fast` method is never built with this caller: Base.M.
    "b/base.go": lines("package b", "type Base struct{}", "func (Base) M() {}"),
    "b/item_linux.go": lines("package b", "type Item struct{ Base }"),
    "b/item_windows.go": lines("package b", "type Item struct{ Base }"),
    "b/fast_linux.go": lines(
      "//go:build fast",
      "",
      "package b",
      "func (Item) M() {}",
    ),
    "b/caller.go": lines(
      "//go:build (linux || windows) && !fast",
      "",
      "package b",
      "func use(i Item) { i.M() }",
    ),
    // 3. go1.23 implies go1.22: only the go1.22 declaration.
    "c/v122.go": lines(
      "//go:build go1.22",
      "",
      "package c",
      "type Item struct{ Name string }",
    ),
    "c/vold.go": lines(
      "//go:build !go1.22",
      "",
      "package c",
      "type Item struct{ Name string }",
    ),
    "c/use.go": lines(
      "//go:build go1.23",
      "",
      "package c",
      "func use(items []Item) { _ = items[0].Name }",
    ),
  });
  assert.equal(
    at(links, "a/use.go", "items[0].Name").target,
    "a/value_other.go:field:Item.Name",
  );
  assert.equal(
    at(links, "a/use.go", "items[0].M").target,
    "a/value_other.go:method:(Item).M",
  );
  assert.equal(
    at(links, "b/caller.go", "i.M").target,
    "b/base.go:method:(Base).M",
  );
  assert.equal(
    at(links, "c/use.go", "items[0].Name").target,
    "c/v122.go:field:Item.Name",
  );
});

test("legacy +build lines: all hold, only before a blank line; Go's full GOARCH list", async () => {
  // Second review of C-4, round 2: t1 has two legacy lines (linux, cgo).
  const { links } = await project({
    "go.mod": MOD,
    "p/use.go": lines(
      "// +build linux",
      "",
      "package p",
      "func use(x T) int { x.M(); return x.F }",
    ),
    "p/t1.go": lines(
      "// +build linux",
      "// +build cgo",
      "",
      "package p",
      "type T struct{ Inner; F int }",
      "func (*T) M() {}",
    ),
    "p/t2.go": lines(
      "// +build linux,!cgo",
      "",
      "package p",
      "type T struct{ Inner; F int }",
    ),
    "p/t3.go": lines(
      "// +build !linux",
      "",
      "package p",
      "type T struct{ Inner; F int }",
    ),
    "p/inner.go": lines(
      "package p",
      "type Inner struct{}",
      "func (Inner) M() {}",
    ),
    // A +build line directly above `package` is not a constraint in Go:
    // q/t_any.go builds everywhere, q/t_only.go only under `never`.
    "q/t_any.go": lines(
      "// +build never",
      "package q",
      "type T struct{ F int }",
    ),
    "q/t_only.go": lines(
      "//go:build never",
      "",
      "package q",
      "type T struct{ F int }",
    ),
    "q/use.go": lines("package q", "func use(x T) int { return x.F }"),
    // `_ppc` is a GOARCH suffix.
    "r/t_ppc.go": lines("package r", "type T struct{ F int }"),
    "r/t_amd64.go": lines("package r", "type T struct{ F int }"),
    "r/use_amd64.go": lines("package r", "func use(x T) int { return x.F }"),
  });
  const xf = at(links, "p/use.go", "x.F");
  assert.equal(xf.target, null);
  assert.deepEqual(xf.candidates, ["p/t1.go:field:T.F", "p/t2.go:field:T.F"]);
  // linux+cgo: (*T).M at depth 0; linux+!cgo: Inner.M promoted.
  const xm = at(links, "p/use.go", "x.M");
  assert.equal(xm.target, null);
  assert.deepEqual(xm.candidates, [
    "p/inner.go:method:(Inner).M",
    "p/t1.go:method:(*T).M",
  ]);
  // t_any.go is in every build (a `never` build would hold both: invalid).
  assert.equal(at(links, "q/use.go", "x.F").target, "q/t_any.go:field:T.F");
  assert.equal(
    at(links, "r/use_amd64.go", "x.F").target,
    "r/t_amd64.go:field:T.F",
  );
});
