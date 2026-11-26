// SPDX-License-Identifier: MIT
// A Go call through a local binding that provably holds exactly one func
// literal targets the enclosing function, with the binding's name and span in
// `data.localBinding` (the Rust and TypeScript form). A call through a
// parameter, result or receiver stays unresolved with the reason `local`.
// Anything else (two assignments, an address taken, a named function value)
// is as before. An edit that changes which case a call is in re-indexes to
// what a cold index stores.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  discoverLanguages,
  indexProject,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import { graphWork, resetGraphWork } from "../dist/graph/work.js";
import { compareRows, storeRows } from "../scripts/reindex/dump.mjs";

const source = `package p

type Op func(int) int

func Closure() int {
	f := func(x int) int { return x }
	return f(1)
}

func Recursive() int {
	var fib func(int) int
	fib = func(n int) int {
		if n < 2 {
			return n
		}
		return fib(n-1) + fib(n-2)
	}
	return fib(5)
}

func Twice(c bool) int {
	g := func() int { return 1 }
	if c {
		g = func() int { return 2 }
	}
	return g()
}

func Escapes() int {
	e := func() int { return 1 }
	swap(&e)
	return e()
}

func swap(p *func() int) {}

func Named() int {
	h := Closure
	return h()
}

func Shadowed() int {
	s := func() int { return 1 }
	{
		s := Closure
		return s()
	}
}

func Param(pf func() int, op Op) (rf func() int) {
	rf = pf
	return func() int { return pf() + op(1) + rf() }
}

func (o Op) Apply() int { return o(2) }

func Nested() int {
	k := func() int { return 3 }
	inner := func() int { return k() }
	return inner()
}

func Reassigned() int {
	var f func() int
	f = Closure
	return f()
}

func mk() (int, func()) { return 0, func() {} }

func Multi() {
	var c func()
	_, c = mk()
	c()
}

type HF func()

func (h *HF) Reset() { *h = nil }

func NamedType() {
	var h HF = func() {}
	h.Reset()
	h()
}

func NamedTypeWritten() {
	var w HF
	w = func() {}
	w()
}

func Other() int { return 7 }

func VarNamed() int {
	var f = Other
	var g func() int = Other
	return f() + g()
}

func Ranged(fs []func()) {
	var g func()
	g = func() {}
	for _, g = range fs {
	}
	g()
}

func Received(ch chan func()) {
	var f func()
	f = func() {}
	select {
	case f = <-ch:
	default:
	}
	f()
}

var pkg = func() int { return 1 }

var literal = func() int {
	c := func() int { return 1 }
	return c()
}

var typed func() int = func() int {
	c := func() int { return 2 }
	return c()
}

func Package() int { return pkg() }
`;

function tree(text) {
  const base = mkdtempSync(join(tmpdir(), "go-local-"));
  const root = join(base, "tree");
  const write = (path, body) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  };
  write("go.mod", "module example.com/m\n\ngo 1.22\n");
  write("p/p.go", text);
  return { base, root, write };
}

test("calls through one local func literal target the enclosing function; parameter calls are `local`", async () => {
  const { base, root } = tree(source);
  const store = new SqliteGraphStore(join(base, "graph.sqlite"));
  try {
    await indexProject(root, await discoverLanguages(), store);
    const symbols = new Map(
      store
        .findSymbols({ file: "p/p.go" })
        .map((symbol) => [symbol.id, symbol]),
    );
    const calls = store
      .links()
      .filter((link) => link.file === "p/p.go" && link.kind === "calls")
      .map((link) => ({
        name: link.targetName,
        from: symbols.get(link.sourceId)?.name,
        target: link.targetId ? symbols.get(link.targetId)?.name : null,
        localBinding: link.data?.localBinding?.name ?? null,
        reason: link.data?.reason ?? null,
      }))
      .sort((a, b) =>
        `${a.from} ${a.name}`.localeCompare(`${b.from} ${b.name}`),
      );
    const by = (from, name) =>
      calls.filter((call) => call.from === from && call.name === name);
    // One func literal: the enclosing function, with the binding.
    assert.deepEqual(by("Closure", "f"), [
      {
        name: "f",
        from: "Closure",
        target: "Closure",
        localBinding: "f",
        reason: null,
      },
    ]);
    // Declared without a value, assigned one func literal (recursion).
    assert.equal(by("Recursive", "fib").length, 3);
    for (const call of by("Recursive", "fib"))
      assert.deepEqual(
        [call.target, call.localBinding, call.reason],
        ["Recursive", "fib", null],
      );
    // From a closure inside the same function.
    for (const name of ["k", "inner"])
      assert.deepEqual(
        by("Nested", name).map((call) => [call.target, call.localBinding]),
        [["Nested", name]],
        name,
      );
    // Two literals, or a write the extractor cannot see: as before.
    for (const [from, name] of [
      ["Twice", "g"],
      ["Escapes", "e"],
    ])
      assert.deepEqual(
        by(from, name).map((call) => [
          call.target,
          call.localBinding,
          call.reason,
        ]),
        [[null, null, null]],
        `${from} ${name}`,
      );
    // Declared without a value and written once, but not with a func
    // literal: a named function, or one value of a multi-value call. No
    // claim; the target is the one main gives.
    assert.deepEqual(
      by("Reassigned", "f").map((call) => [call.target, call.localBinding]),
      [[null, null]],
    );
    assert.deepEqual(
      by("Multi", "c").map((call) => [call.target, call.localBinding]),
      [[null, null]],
    );
    // Declared with a value that is not a func literal: a named function,
    // with or without a declared func type. Main's targets.
    assert.deepEqual(
      [...by("VarNamed", "f"), ...by("VarNamed", "g")].map((call) => [
        call.name,
        call.target,
        call.localBinding,
      ]),
      [
        ["f", "Other", null],
        ["g", null, null],
      ],
    );
    // A func literal, then a write the extractor cannot follow (a range or
    // receive `=`): no claim, as main.
    for (const [from, name] of [
      ["Ranged", "g"],
      ["Received", "f"],
    ])
      assert.deepEqual(
        by(from, name).map((call) => [call.target, call.localBinding]),
        [[null, null]],
        `${from} ${name}`,
      );
    // A binding of a named func type: a method may write it (`h.Reset()`
    // takes `&h`), so it is never claimed, with a value or written once.
    for (const [from, name] of [
      ["NamedType", "h"],
      ["NamedTypeWritten", "w"],
    ])
      assert.deepEqual(
        by(from, name).map((call) => [call.target, call.localBinding]),
        [[null, null]],
        `${from} ${name}`,
      );
    // A named function value, shadowing included: its own target, as before.
    assert.deepEqual(
      by("Named", "h").map((call) => [call.target, call.localBinding]),
      [["Closure", null]],
    );
    assert.deepEqual(
      by("Shadowed", "s").map((call) => [call.target, call.localBinding]),
      [["Closure", null]],
    );
    // Parameter, result and receiver calls: unresolved, `local`.
    for (const [from, name] of [
      ["Param", "pf"],
      ["Param", "op"],
      ["Param", "rf"],
      ["Apply", "o"],
    ])
      assert.deepEqual(
        by(from, name).map((call) => [
          call.target,
          call.localBinding,
          call.reason,
        ]),
        [[null, null, "local"]],
        `${from} ${name}`,
      );
    // A package-level func literal is not local: as before.
    assert.deepEqual(
      by("Package", "pkg").map((call) => [call.localBinding, call.reason]),
      [[null, null]],
    );
    // A closure inside a package-level func literal has no enclosing
    // function to target: as before.
    assert.deepEqual(
      calls
        .filter((call) => call.name === "c" && call.from !== "Multi")
        .map((call) => [call.target, call.localBinding, call.reason]),
      [
        [null, null, null],
        [null, null, null],
      ],
    );
  } finally {
    store.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("an edit between one closure and two re-indexes to what a cold index stores", async () => {
  const { base, root, write } = tree(source);
  const path = join(base, "graph.sqlite");
  try {
    const registry = await discoverLanguages();
    const first = new SqliteGraphStore(path);
    await indexProject(root, registry, first);
    const projectId = first.projectId;
    first.close();
    const edits = [
      // One literal becomes two, then back; a parameter becomes a local.
      source.replace(
        "f := func(x int) int { return x }",
        "f := func(x int) int { return x }\n\tf = func(x int) int { return -x }",
      ),
      source,
      source.replace(
        "func Param(pf func() int, op Op) (rf func() int) {",
        "func Param(op Op) (rf func() int) {\n\tpf := func() int { return 0 }",
      ),
    ];
    for (const [step, text] of edits.entries()) {
      write("p/p.go", text);
      const store = new SqliteGraphStore(path);
      await indexProject(root, registry, store);
      store.close();
      const cold = join(base, `cold-${step}.sqlite`);
      const fresh = new SqliteGraphStore(cold, projectId);
      await indexProject(root, registry, fresh);
      fresh.close();
      assert.deepEqual(
        compareRows(storeRows(path), storeRows(cold)),
        [],
        `step ${step}`,
      );
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a store whose Go records were made by module version 32 is re-parsed and equals a cold index", async () => {
  const { base, root } = tree(source);
  const path = join(base, "graph.sqlite");
  try {
    const registry = await discoverLanguages();
    const first = new SqliteGraphStore(path);
    await indexProject(root, registry, first);
    const projectId = first.projectId;
    first.close();
    // As version 32 left them: no local-call facts, and its version. The
    // completion record is put back after the rewrite, so the next run
    // trusts every record whose version is current, and only the version
    // can make it parse them again.
    const db = new DatabaseSync(path);
    const meta = db.prepare("SELECT key, value FROM graph_meta").all();
    let rewritten = 0;
    for (const row of db.prepare("SELECT path, body FROM graph_files").all()) {
      const file = JSON.parse(row.body);
      if (file.module !== "go") continue;
      file.version = "32";
      for (const link of file.result.links ?? [])
        if (link.data) {
          delete link.data.localBinding;
          delete link.data.localParameter;
          delete link.data.reason;
        }
      db.prepare("UPDATE graph_files SET body=? WHERE path=?").run(
        JSON.stringify(file),
        row.path,
      );
      rewritten++;
    }
    for (const { key, value } of meta)
      db.prepare(
        "INSERT OR REPLACE INTO graph_meta (key, value) VALUES (?, ?)",
      ).run(key, value);
    db.close();
    assert.ok(rewritten > 0);
    resetGraphWork();
    const again = new SqliteGraphStore(path);
    await indexProject(root, registry, again);
    again.close();
    assert.equal(
      graphWork.counts["parse.go.files"],
      rewritten,
      "every Go record is parsed again",
    );
    const cold = join(base, "cold.sqlite");
    const fresh = new SqliteGraphStore(cold, projectId);
    await indexProject(root, registry, fresh);
    fresh.close();
    assert.deepEqual(compareRows(storeRows(path), storeRows(cold)), []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
