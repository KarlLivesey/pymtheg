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
import { test } from "node:test";
import {
  discoverLanguages,
  indexProject,
  SqliteGraphStore,
} from "../dist/graph/index.js";
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

var pkg = func() int { return 1 }

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
