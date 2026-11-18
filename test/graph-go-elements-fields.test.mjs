// SPDX-License-Identifier: MIT
// C-4: member links through slice, map, channel and range element types, and
// fields of anonymous, nested and function-local structs. Fixtures follow real
// corpus shapes (cobra args_test.go table tests, pebble's nested anonymous
// `Local` settings, chi's named map-of-slices router, macho's embedded
// external interface).
import assert from "node:assert/strict";
import { test } from "node:test";
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
    "args_test.go:field:args_test.go:TestMatchAll.struct#1.args",
  );
  assert.equal(
    at(links, "args_test.go", "tc.fail").target,
    "args_test.go:field:args_test.go:TestMatchAll.struct#1.fail",
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
  assert.equal(target("tc.kid"), "q/q.go:field:q.go:Use.struct#2.kid");
  assert.equal(target("tc.kid.Run"), "q/q.go:method:(Kid).Run");
  assert.equal(target("tests[0].name"), "q/q.go:field:q.go:Use.struct#2.name");
  assert.equal(target("arr[1].A"), "q/q.go:field:q.go:Use.struct#3.A");
  assert.equal(target("k.K"), "q/q.go:field:q.go:Use.struct#4.K");
  assert.equal(target("v.V"), "q/q.go:field:q.go:Use.struct#5.V");
  assert.equal(target("v.V.Run"), "q/q.go:method:(Kid).Run");
  assert.equal(target("(<-c).C"), "q/q.go:field:q.go:Use.struct#1.C");
  assert.equal(target("(<-c).C.Run"), "q/q.go:method:(Kid).Run");
  assert.equal(target("x.C"), "q/q.go:field:q.go:Use.struct#1.C");
  assert.equal(target("w.X"), "q/q.go:field:q.go:Use.struct#6.X");
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
    "settings/settings.go:field:settings.go:Settings.struct#1.FS",
  );
  assert.equal(
    target("provider/vfs.go", "p.st.Local.FSDirName"),
    "settings/settings.go:field:settings.go:Settings.struct#1.FSDirName",
  );
  assert.equal(
    target("provider/db.go", "d.mu.mem.queue"),
    "provider/db.go:field:db.go:DB.struct#2.queue",
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
    "q/use.go:field:use.go:Use.struct#1.n",
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
          go.resolve({
            ...context,
            files: flip(context.files),
            symbols: flip(context.symbols),
            links: deepFirst(context.links),
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
