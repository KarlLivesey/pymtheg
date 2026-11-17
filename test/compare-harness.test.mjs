// SPDX-License-Identifier: MIT
// SW-2 comparison harness: normalising and matching on tiny fixtures.
// No network, no tools installed: the adapters' readers are fed hand-made
// SQLite stores and graph files in a temporary folder.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import * as codegraph from "../scripts/compare/adapters/codegraph.mjs";
import * as graphify from "../scripts/compare/adapters/graphify.mjs";
import * as pymtheg from "../scripts/compare/adapters/pymtheg.mjs";
import {
  countBy,
  edgeClass,
  lineIndex,
  normContainer,
  normName,
  parseLoc,
  readNormalised,
  repoDir,
  writeNormalised,
} from "../scripts/compare/lib/common.mjs";
import {
  cluster,
  diff,
  pairsOf,
  TOLERANCE,
} from "../scripts/compare/lib/match.mjs";
import {
  loadRepos,
  probeIsolation,
  requireIsolation,
} from "../scripts/compare/run.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "pym-compare-"));

test("names: harmless spelling differences normalise to one name", () => {
  assert.equal(normName(".ServeHTTP()"), "ServeHTTP");
  assert.equal(normName("NewMux()"), "NewMux");
  assert.equal(normName("chi.URLParam"), "URLParam");
  assert.equal(normName("Config::is_printing"), "is_printing");
  assert.equal(normName("Box<T>"), "Box");
  assert.equal(normName("Map[K, V]"), "Map");
  assert.equal(normContainer("(*Mux)"), "Mux");
  assert.equal(normContainer("&mut Walker<'a>"), "Walker");
  assert.equal(normContainer(""), undefined);
  assert.equal(parseLoc("L42"), 42);
  assert.equal(parseLoc("L3-L9"), 3);
  assert.equal(edgeClass("instantiates"), "call");
  assert.equal(edgeClass("constructor"), "other");
  assert.deepEqual(
    countBy([{ k: "constructor" }, { k: "constructor" }], (x) => x.k),
    { constructor: 2 },
  );
});

test("lines: UTF-16 offsets map to 1-based lines", () => {
  const text = "a😀b\nsecond\n\nfourth";
  const line = lineIndex(text);
  assert.equal(line(0), 1);
  assert.equal(line(text.indexOf("second")), 2);
  assert.equal(line(text.indexOf("fourth")), 4);
  assert.equal(line(text.length), 4);
});

function pymthegStore(dir) {
  const db = new DatabaseSync(join(dir, "graph.sqlite"));
  db.exec(`CREATE TABLE graph_files(path TEXT PRIMARY KEY, body TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE graph_parse_failures(path TEXT PRIMARY KEY, hash TEXT, module TEXT, version TEXT);
    CREATE TABLE graph_symbols(id TEXT PRIMARY KEY, file TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE graph_links(id TEXT PRIMARY KEY, file TEXT NOT NULL, source TEXT, target TEXT, kind TEXT NOT NULL, body TEXT NOT NULL, module TEXT NOT NULL, origin TEXT NOT NULL, resolution TEXT NOT NULL);
    CREATE TABLE graph_candidates(link TEXT NOT NULL, symbol TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(link, symbol));`);
  const src =
    "package shop\n\n// é😀\nfunc Restock(s *Store) {\n\ts.Put(1)\n\tunknown()\n\tx.Get()\n}\n\nfunc (s *Store) Put(n int) {}\nfunc (b *Box) Get() {}\nfunc (c *Cart) Get() {}\n";
  const at = (needle) => src.indexOf(needle);
  db.prepare("INSERT INTO graph_files VALUES ('shop.go','{}','clean')").run();
  const sym = (id, name, kind, start, data = {}, identity = name) =>
    db.prepare("INSERT INTO graph_symbols VALUES (?,?,?,?,?)").run(
      id,
      "shop.go",
      name,
      kind,
      JSON.stringify({
        name,
        kind,
        identity,
        range: { start, end: start + 1 },
        data,
      }),
    );
  sym("symbol:f", "shop.go", "file", 0);
  sym("symbol:restock", "Restock", "function", at("func Restock"));
  sym(
    "symbol:put",
    "Put",
    "method",
    at("func (s *Store) Put"),
    { receiver: "Store", pointer: true },
    "(*Store).Put",
  );
  sym(
    "symbol:boxget",
    "Get",
    "method",
    at("func (b *Box)"),
    { receiver: "Box" },
    "(*Box).Get",
  );
  sym(
    "symbol:cartget",
    "Get",
    "method",
    at("func (c *Cart)"),
    { receiver: "Cart" },
    "(*Cart).Get",
  );
  const link = (id, target, start, targetName, resolution, data = {}) =>
    db
      .prepare("INSERT INTO graph_links VALUES (?,?,?,?,?,?,?,?,?)")
      .run(
        id,
        "shop.go",
        "symbol:restock",
        target,
        "calls",
        JSON.stringify({ targetName, range: { start, end: start + 1 }, data }),
        "go",
        "parse",
        resolution,
      );
  link(
    "link:aaaaaaaaaaaaaaaa1",
    "symbol:put",
    at("s.Put"),
    "s.Put",
    "resolved",
  );
  link(
    "link:aaaaaaaaaaaaaaaa2",
    null,
    at("unknown()"),
    "unknown",
    "unresolved",
    { reason: "no-symbol" },
  );
  link("link:aaaaaaaaaaaaaaaa3", null, at("x.Get"), "x.Get", "ambiguous", {
    open: { reason: "receiver-type-unknown" },
  });
  db.prepare(
    "INSERT INTO graph_candidates VALUES ('link:aaaaaaaaaaaaaaaa3','symbol:boxget','calls'),('link:aaaaaaaaaaaaaaaa3','symbol:cartget','calls')",
  ).run();
  db.close();
  return { db: join(dir, "graph.sqlite"), readText: () => src };
}

test("pymtheg: definite, candidate set and unresolved stay distinct", () => {
  const dir = tmp();
  try {
    const r = pymtheg.normalise(pymthegStore(dir));
    const restock = r.symbols.find((s) => s.name === "Restock");
    assert.equal(
      restock.line,
      4,
      "UTF-16 offset after non-ASCII text maps to the declaration line",
    );
    assert.deepEqual(
      r.symbols
        .filter((s) => s.name === "Get")
        .map((s) => [s.line, s.container]),
      [
        [11, "Box"],
        [12, "Cart"],
      ],
    );
    const calls = r.edges.filter((e) => e.kind === "calls");
    const definite = calls.filter((e) => e.certainty === "definite");
    assert.equal(definite.length, 1);
    assert.deepEqual(definite[0].from, {
      file: "shop.go",
      line: 5,
      symbol: "Restock",
      kind: "callable",
      declLine: 4,
    });
    assert.deepEqual(definite[0].to, {
      file: "shop.go",
      line: 10,
      symbol: "Put",
      kind: "callable",
      container: "Store",
    });
    const cands = calls.filter((e) => e.certainty === "candidate");
    assert.equal(
      cands.length,
      2,
      "one edge per set member, each marked candidate",
    );
    for (const c of cands)
      assert.deepEqual(
        { size: c.set.size, open: c.set.open },
        { size: 2, open: true },
      );
    const unresolved = calls.filter((e) => e.certainty === "unresolved");
    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0].to.unresolved, true);
    assert.equal(unresolved[0].to.symbol, "unknown");
    assert.equal(unresolved[0].reason, "no-symbol");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("codegraph: edges keep resolvedBy, confidence and heuristic provenance", () => {
  const dir = tmp();
  try {
    const db = new DatabaseSync(join(dir, "codegraph.db"));
    db.exec(`CREATE TABLE nodes(id TEXT PRIMARY KEY, kind TEXT, name TEXT, qualified_name TEXT, file_path TEXT, start_line INTEGER);
      CREATE TABLE edges(id INTEGER PRIMARY KEY, source TEXT, target TEXT, kind TEXT, metadata TEXT, line INTEGER, col INTEGER, provenance TEXT);
      CREATE TABLE files(path TEXT PRIMARY KEY, errors TEXT);
      CREATE TABLE unresolved_refs(id INTEGER PRIMARY KEY, from_node_id TEXT, reference_name TEXT, reference_kind TEXT, line INTEGER, col INTEGER, status TEXT);`);
    db.exec(`INSERT INTO files VALUES ('shop.go', NULL);
      INSERT INTO nodes VALUES ('file:shop.go','file','shop.go','shop.go','shop.go',1),
        ('f1','function','Restock','Restock','shop.go',4),
        ('m1','method','Put','Store::Put','shop.go',10),
        ('v1','variable','limit','limit','shop.go',2);
      INSERT INTO edges VALUES (1,'f1','m1','calls','{"confidence":0.7,"resolvedBy":"instance-method"}',5,2,NULL),
        (2,'f1','m1','calls','{"confidence":0.4,"resolvedBy":"exact-match"}',6,2,'heuristic'),
        (3,'f1','v1','references','{"valueRef":true}',NULL,NULL,NULL),
        (4,'file:shop.go','f1','contains',NULL,NULL,NULL,NULL);
      INSERT INTO unresolved_refs VALUES (1,'f1','fmt.Println','calls',7,2,'failed');`);
    db.close();
    const r = codegraph.normalise({ db: join(dir, "codegraph.db") });
    const calls = r.edges.filter((e) => e.kind === "calls" && !e.to.unresolved);
    assert.deepEqual(
      calls.map((e) => e.certainty),
      ["instance-method@0.7", "exact-match@0.4+heuristic"],
    );
    assert.deepEqual(calls[0].to, {
      file: "shop.go",
      line: 10,
      symbol: "Put",
      kind: "callable",
      container: "Store",
    });
    const ref = r.edges.find((e) => e.kind === "references");
    assert.equal(
      ref.from.noSite,
      true,
      "an edge without a line has no known site",
    );
    assert.equal(ref.certainty, "value-ref");
    const un = r.edges.find((e) => e.to.unresolved);
    assert.deepEqual(
      [un.to.symbol, un.certainty, un.from.line],
      ["Println", "unresolved(failed)", 7],
    );
    assert.equal(
      r.symbols.some((s) => s.kind === "file"),
      true,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("graphify: labels, containers from method edges, file nodes and confidence", () => {
  const graph = {
    nodes: [
      {
        id: "f",
        label: "shop.go",
        source_file: "shop.go",
        source_location: "L1",
      },
      {
        id: "store",
        label: "Store",
        source_file: "shop.go",
        source_location: "L3",
        _callable_class: true,
      },
      {
        id: "put",
        label: ".Put()",
        source_file: "shop.go",
        source_location: "L10",
        _callable: true,
      },
      {
        id: "restock",
        label: "Restock()",
        source_file: "shop.go",
        source_location: "L4",
        _callable: true,
      },
      {
        id: "ext",
        label: "fmt.Println",
        file_type: "concept",
        external: true,
        source_file: "",
      },
    ],
    edges: [
      {
        source: "store",
        target: "put",
        relation: "method",
        confidence: "EXTRACTED",
        source_file: "shop.go",
        source_location: "L10",
      },
      {
        source: "restock",
        target: "put",
        relation: "calls",
        confidence: "INFERRED",
        confidence_score: 0.85,
        context: "call",
        source_file: "shop.go",
        source_location: "L5",
      },
      {
        source: "restock",
        target: "ext",
        relation: "calls",
        confidence: "EXTRACTED",
        source_file: "shop.go",
        source_location: "L7",
      },
      {
        source: "f",
        target: "restock",
        relation: "contains",
        confidence: "EXTRACTED",
        source_file: "shop.go",
        source_location: "L4",
      },
    ],
  };
  const r = graphify.normalise({ graph });
  const put = r.symbols.find((s) => s.name === "Put");
  assert.deepEqual(put, {
    file: "shop.go",
    line: 10,
    kind: "callable",
    name: "Put",
    container: "Store",
  });
  assert.equal(r.symbols.find((s) => s.line === 1).kind, "file");
  const call = r.edges.find((e) => e.kind === "calls" && !e.to.external);
  assert.equal(call.certainty, "INFERRED@0.85");
  assert.deepEqual(call.from, {
    file: "shop.go",
    line: 5,
    symbol: "Restock",
    kind: "callable",
    declLine: 4,
  });
  const ext = r.edges.find((e) => e.to.external);
  assert.equal(ext.to.symbol, "Println");
  assert.equal(
    r.edges.find((e) => e.kind === "contains").from.symbol,
    "",
    "a file node is a file-level source",
  );
});

const sym = (file, line, symbol, container) => ({
  file,
  line,
  symbol,
  ...(container ? { container } : {}),
});
const edge = (kind, from, fromDecl, site, to, certainty) => ({
  kind,
  class: edgeClass(kind),
  from: { ...from, line: site, declLine: fromDecl },
  to,
  certainty,
});
const result = (tool, edges, files = ["a.go", "b.go"]) => ({
  tool,
  files,
  failedFiles: [],
  symbols: [],
  edges,
});

test("matching: declaration lines within the tolerance match, further apart do not", () => {
  const from = sym("a.go", 10, "Run");
  const a = result("pymtheg", [
    edge("calls", from, 10, 12, sym("b.go", 20, "Put", "Store"), "definite"),
  ]);
  const near = result("codegraph", [
    edge(
      "calls",
      sym("a.go", 10 + TOLERANCE, "Run"),
      10 + TOLERANCE,
      12,
      sym("b.go", 20 - 1, "Put"),
      "exact-match@0.9",
    ),
  ]);
  const far = result("graphify", [
    edge(
      "calls",
      sym("a.go", 10, "Run"),
      10,
      40,
      sym("b.go", 20 + TOLERANCE + 1, "Put"),
      "EXTRACTED",
    ),
  ]);
  const clusters = cluster([
    ["pymtheg", a],
    ["codegraph", near],
    ["graphify", far],
  ]);
  assert.equal(clusters.length, 2);
  assert.deepEqual(Object.keys(clusters[0].members), ["pymtheg", "codegraph"]);
  assert.deepEqual(Object.keys(clusters[1].members), ["graphify"]);
});

test("matching: the container breaks ties between same-named methods", () => {
  const from = sym("a.go", 1, "Run");
  const p = result("pymtheg", [
    edge("calls", from, 1, 2, sym("b.go", 10, "Get", "Box"), "definite"),
    edge("calls", from, 1, 3, sym("b.go", 11, "Get", "Cart"), "definite"),
  ]);
  const c = result("codegraph", [
    edge(
      "calls",
      from,
      1,
      3,
      sym("b.go", 11, "Get", "Cart"),
      "instance-method@0.7",
    ),
  ]);
  const clusters = cluster([
    ["pymtheg", p],
    ["codegraph", c],
  ]);
  const matched = clusters.find((x) => x.members.codegraph);
  assert.equal(matched.members.pymtheg.to.container, "Cart");
});

test("matching: pass 2 joins edges attributed to different enclosing symbols at the same call site", () => {
  const p = result("pymtheg", [
    edge("calls", sym("a.go", 1, ""), 1, 7, sym("b.go", 3, "Put"), "definite"),
  ]);
  const g = result("graphify", [
    edge(
      "calls",
      sym("a.go", 6, "init"),
      6,
      8,
      sym("b.go", 3, "Put"),
      "EXTRACTED",
    ),
  ]);
  const clusters = cluster([
    ["pymtheg", p],
    ["graphify", g],
  ]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].via.graphify, "site");
});

test("diff: buckets, candidate sets kept apart, and order-independent output", () => {
  const from = sym("a.go", 1, "Run");
  const pEdges = [
    edge("calls", from, 1, 2, sym("b.go", 5, "Both"), "definite"),
    edge("calls", from, 1, 3, sym("b.go", 6, "OnlyUs"), "definite"),
    {
      ...edge("calls", from, 1, 4, sym("b.go", 7, "Maybe"), "candidate"),
      set: { id: "s", size: 2, open: false },
    },
    {
      ...edge(
        "calls",
        from,
        1,
        5,
        { symbol: "Missed", unresolved: true },
        "unresolved",
      ),
      reason: "receiver-type-unknown",
    },
    edge("imports", from, 1, 1, sym("b.go", 1, ""), "definite"),
  ];
  const cEdges = [
    edge("calls", from, 1, 2, sym("b.go", 5, "Both"), "exact-match@0.9"),
    edge("calls", from, 1, 5, sym("b.go", 8, "Missed"), "instance-method@0.7"),
  ];
  const d1 = diff([
    ["pymtheg", result("pymtheg", pEdges)],
    ["codegraph", result("codegraph", cEdges)],
  ]);
  assert.equal(d1.buckets.all.total, 1);
  assert.equal(d1.buckets["only:pymtheg:definite"].total, 1);
  assert.equal(
    d1.buckets["only:pymtheg:candidate"].total,
    1,
    "a candidate set member is never counted as definite",
  );
  assert.equal(d1.buckets["others-not-pymtheg"].total, 1);
  assert.deepEqual(d1.buckets["others-not-pymtheg"].byAbsentState, {
    "unresolved(receiver-type-unknown)": 1,
  });
  assert.equal(d1.buckets["others-not-pymtheg"].sample[0].to.symbol, "Missed");
  assert.equal(
    pairsOf(result("pymtheg", pEdges)).length,
    3,
    "imports and unresolved edges are not compared",
  );
  const d2 = diff([
    ["pymtheg", result("pymtheg", [...pEdges].reverse())],
    ["codegraph", result("codegraph", [...cEdges].reverse())],
  ]);
  assert.deepEqual(d2, d1);
});

test("repository list: the sweep format is validated entry by entry", () => {
  const { ok, bad } = loadRepos(
    JSON.stringify([
      {
        id: "chi",
        language: "go",
        url: "https://github.com/go-chi/chi",
        commit: "c64ed7d6635f33a8b2feaff7dcfa55677023ac7d",
        category: "x",
        why: "y",
      },
      {
        id: "short",
        language: "go",
        url: "https://github.com/x/y",
        commit: "c64ed7d",
      },
      {
        id: "py",
        language: "python",
        url: "https://github.com/x/y",
        commit: "c64ed7d6635f33a8b2feaff7dcfa55677023ac7d",
      },
    ]),
  );
  assert.deepEqual(
    ok.map((r) => r.id),
    ["chi"],
  );
  assert.deepEqual(
    bad.map((b) => [b.entry, b.problems]),
    [
      ["short", ["commit (full SHA)"]],
      ["py", ["language"]],
    ],
  );
});

test("normalised output: JSON Lines round trip keeps every field", () => {
  const dir = tmp();
  try {
    const big = "x".repeat(300_000);
    const r = {
      tool: "pymtheg",
      files: ["a.go", "b.go"],
      failedFiles: [],
      fileStatus: { "a.go": "clean" },
      notes: { n: 1 },
      symbols: Array.from({ length: 50 }, (_, i) => ({
        file: "a.go",
        line: i + 1,
        kind: "function",
        name: `f${i}`,
      })),
      edges: Array.from({ length: 50 }, (_, i) =>
        edge(
          "calls",
          sym("a.go", 1, "f0"),
          1,
          i + 2,
          { file: "b.go", line: i, symbol: i === 7 ? big : `g${i}` },
          "definite",
        ),
      ),
    };
    const file = join(dir, "n.jsonl");
    writeNormalised(file, r);
    assert.deepEqual(readNormalised(file), r);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isolation: a missing isolation tool stops the run unless --no-isolate", async () => {
  assert.equal(await probeIsolation("pymtheg-no-such-command"), false);
  await assert.rejects(
    requireIsolation(true, async () => false),
    /--no-isolate/,
  );
  assert.equal(await requireIsolation(true, async () => true), true);
  let probed = false;
  const off = await requireIsolation(false, async () => {
    probed = true;
    return true;
  });
  assert.deepEqual([off, probed], [false, false]);
});

test("repository list: sweep ids of the form owner/name are accepted", () => {
  const sha = "ea20e800216417c8d3b5dfc54a863bbd9e0b3e20";
  const { ok, bad } = loadRepos(
    JSON.stringify([
      {
        id: "pingdotgg/t3code",
        language: "typescript",
        url: "https://github.com/pingdotgg/t3code.git",
        commit: sha,
      },
      {
        id: "a/../b",
        language: "go",
        url: "https://github.com/x/y",
        commit: sha,
      },
      {
        id: "../x",
        language: "go",
        url: "https://github.com/x/y",
        commit: sha,
      },
      {
        id: "a__b",
        language: "go",
        url: "https://github.com/x/y",
        commit: sha,
      },
    ]),
  );
  assert.deepEqual(
    ok.map((r) => r.id),
    ["pingdotgg/t3code"],
  );
  assert.deepEqual(
    bad.map((b) => b.entry),
    ["a/../b", "../x", "a__b"],
  );
  assert.equal(repoDir("pingdotgg/t3code"), "pingdotgg__t3code");
});
