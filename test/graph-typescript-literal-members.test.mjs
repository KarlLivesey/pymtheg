// SPDX-License-Identifier: MIT
// C-41: members of object literals and type literals as link targets. Each
// positive case was unresolved (`local`) before; the negatives keep their
// outcome. The checker's own declaration list decides: one declaration is a
// definite target, several a candidate set, none or an open index nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import typescript from "../dist/graph/languages/typescript/index.js";

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "Bundler",
  },
  include: ["src"],
});

/**
 * Indexes `files` and returns, for each `calls` link in `file`, keyed by the
 * line it is on, its outcome: the target's `file#identity`, the sorted
 * candidates, or `<resolution>:<reason>`.
 */
async function outcomes(files, file, byName = false) {
  const scratch = await mkdtemp(join(tmpdir(), "c41-members-"));
  const root = join(scratch, "project");
  const store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "c41");
  try {
    for (const [path, text] of Object.entries({
      "tsconfig.json": tsconfig,
      ...files,
    })) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    const report = await indexProject(
      root,
      new LanguageRegistry([typescript]),
      store,
    );
    assert.deepEqual(report.analysisErrors, []);
    const symbols = new Map(
      store.findSymbols().map((s) => [s.id, `${s.file}#${s.identity}`]),
    );
    const text = store.getFile(file).text;
    const result = {};
    for (const link of store.links()) {
      if (link.file !== file || link.kind !== "calls") continue;
      const start = text.lastIndexOf("\n", link.range.start - 1) + 1;
      const end = text.indexOf("\n", link.range.start);
      const site = text.slice(start, end < 0 ? undefined : end).trim();
      result[byName ? `${site} @${link.targetName}` : site] =
        link.resolution === "resolved"
          ? symbols.get(link.targetId)
          : link.resolution === "ambiguous"
            ? link.candidates.map(({ id }) => symbols.get(id)).sort()
            : `${link.resolution}:${link.data?.reason ?? ""}`;
    }
    return result;
  } finally {
    store.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

test("a call on a member of a type literal links to that member, as an interface member's does", async () => {
  const got = await outcomes(
    {
      "src/api.ts": [
        "export type Api = { query(): void; run: () => void; nested: { go(): void } };",
        "export declare const api: Api;",
        "export declare const inline: { m(): void; maybe?(): void };",
        "export interface Holder { inner: { q(): void } }",
        "export declare const holder: Holder;",
        "export type Box<X> = { get(): X };",
        "export declare const box: Box<number>;",
        "export interface Plain { m(): void }",
        "export declare const plain: Plain;",
        "",
      ].join("\n"),
      "src/use.ts": [
        'import { api, inline, holder, box, plain } from "./api";',
        "api.query();",
        "api.run();",
        "api.nested.go();",
        "inline.m();",
        "inline.maybe?.();",
        "holder.inner.q();",
        "box.get();",
        "plain.m();",
        "",
      ].join("\n"),
    },
    "src/use.ts",
  );
  assert.deepEqual(got, {
    "api.query();": "src/api.ts#Api.[type].query",
    "api.run();": "src/api.ts#Api.[type].run",
    "api.nested.go();": "src/api.ts#Api.[type].nested.go",
    "inline.m();": "src/api.ts#inline.[type].m",
    "inline.maybe?.();": "src/api.ts#inline.[type].maybe",
    "holder.inner.q();": "src/api.ts#Holder.inner.[type].q",
    "box.get();": "src/api.ts#Box.[type].get",
    // An interface member, as before.
    "plain.m();": "src/api.ts#Plain.m",
  });
});

test("type literals with the same member names stay distinct; a written union is a candidate set", async () => {
  const got = await outcomes(
    {
      "src/use.ts": [
        "declare const one: { run(): void };",
        "declare const two: { run(): void };",
        "declare const pick: boolean;",
        "one.run();",
        "two.run();",
        "declare const either: { run(): void } | { run(): void };",
        "either.run();",
        "declare const both: { run(): void } & { stop(): void };",
        "both.stop();",
        "",
      ].join("\n"),
    },
    "src/use.ts",
  );
  assert.deepEqual(got, {
    "one.run();": "src/use.ts#one.[type].run",
    "two.run();": "src/use.ts#two.[type].run",
    "either.run();": [
      "src/use.ts#either.[type].[|0].run",
      "src/use.ts#either.[type].[|1].run",
    ],
    "both.stop();": "src/use.ts#both.[type].[&1].stop",
  });
});

test("a computed union of identical type literals is never one definite member", async () => {
  // The checker reduces `pick ? one : two` to one of the two identical
  // literal types, so its declaration list names one member: the walk gives both.
  const got = await outcomes(
    {
      "src/use.ts": [
        "declare const one: { run(): void };",
        "declare const two: { run(): void };",
        "declare const pick: boolean;",
        "(pick ? one : two).run();",
        "const chosen = pick ? one : two;",
        "chosen.run();",
        "function choose() { return pick ? one : two; }",
        "choose().run();",
        "",
      ].join("\n"),
    },
    "src/use.ts",
  );
  assert.deepEqual(got, {
    "(pick ? one : two).run();": [
      "src/use.ts#one.[type].run",
      "src/use.ts#two.[type].run",
    ],
    "chosen.run();": ["src/use.ts#one.[type].run", "src/use.ts#two.[type].run"],
    "choose().run();": [
      "src/use.ts#one.[type].run",
      "src/use.ts#two.[type].run",
    ],
  });
});

test("members of type literals in parameters and nested type positions are targets", async () => {
  const got = await outcomes(
    {
      "src/use.ts": [
        "export function render(db: { getConfig(): number }, list: { fn(): void }[]) {",
        "  db.getConfig();",
        "}",
        "declare const box: Promise<{ open(): void }>;",
        "declare const nested: { inner: { go(): void }[] };",
        "declare const pair: [{ a(): void }, { b(): void }];",
        "",
      ].join("\n"),
    },
    "src/use.ts",
  );
  assert.deepEqual(got, {
    "db.getConfig();": "src/use.ts#render.[param:db].[type].getConfig",
  });
});

test("object-literal members: equal names stay distinct; spread, computed keys and reduced unions give no wrong definite link", async () => {
  const got = await outcomes(
    {
      "src/objects.ts": [
        "export const one = { run() {} };",
        "export const two = { run() {} };",
        "const base = { start() {} };",
        "export const spread = { ...base, stop() {} };",
        "const key = 'dyn';",
        "export const computed = { [key]() {}, plain() {} };",
        "declare const pick: boolean;",
        "export const chosen = pick ? one : two;",
        "export const nested = { inner: { go() {} } };",
        "",
      ].join("\n"),
      "src/use.ts": [
        'import { one, two, spread, computed, chosen, nested } from "./objects";',
        "one.run();",
        "two.run();",
        "spread.start();",
        "spread.stop();",
        "computed.dyn();",
        "computed.plain();",
        "chosen.run();",
        "nested.inner.go();",
        "",
      ].join("\n"),
    },
    "src/use.ts",
  );
  assert.deepEqual(got, {
    // Equal member names in two literals: two symbols, never merged.
    "one.run();": "src/objects.ts#one.run",
    "two.run();": "src/objects.ts#two.run",
    // The checker reduces `pick ? one : two` to `one`'s type; the producers
    // give both members (a wrong definite `one.run` before C-41).
    "chosen.run();": ["src/objects.ts#one.run", "src/objects.ts#two.run"],
    // A spread member is the spread object's own declaration.
    "spread.start();": "src/objects.ts#base.start",
    "spread.stop();": "src/objects.ts#spread.stop",
    // A computed key the checker knows as one name ('dyn' from a const).
    "computed.dyn();": "src/objects.ts#computed.[key]",
    "computed.plain();": "src/objects.ts#computed.plain",
    "nested.inner.go();": "src/objects.ts#nested.[object].inner.go",
  });
});

test("a member of a literal bound to a name, through a value that can change, is not one definite link", async () => {
  const got = await outcomes(
    {
      "src/use.ts": [
        "let state = { run() {} };",
        "export function reset() { state = { run() {} }; }",
        "state.run();",
        "declare const pick: boolean;",
        "const first = { stop() {} };",
        "const second = { stop() {} };",
        "(pick ? first : second).stop();",
        "(first ?? second).stop();",
        "first.stop();",
        "",
      ].join("\n"),
    },
    "src/use.ts",
  );
  assert.deepEqual(got, {
    "state.run();": "unresolved:multiple-object-producers",
    "(pick ? first : second).stop();": [
      "src/use.ts#first.stop",
      "src/use.ts#second.stop",
    ],
    // `first` is never nullish, so the value is always `first`.
    "(first ?? second).stop();": "src/use.ts#first.stop",
    "first.stop();": "src/use.ts#first.stop",
  });
});

test("member symbols of literals leave every contains link resolved", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "c41-contains-"));
  const root = join(scratch, "project");
  const store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "c41");
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "tsconfig.json"), tsconfig);
    await writeFile(
      join(root, "src/api.ts"),
      [
        "export type Api = { query(): void; nested: { go(): void } };",
        "export function render(db: { getConfig(): number }) { db.getConfig(); }",
        "export const one = { run() {}, inner: { go() {} } };",
        "export declare const both: { run(): void } & { stop(): void };",
        "",
      ].join("\n"),
    );
    const report = await indexProject(
      root,
      new LanguageRegistry([typescript]),
      store,
    );
    assert.deepEqual(report.analysisErrors, []);
    const symbols = new Map(store.findSymbols().map((s) => [s.id, s]));
    const members = [...symbols.values()].filter((s) =>
      s.identity.includes(".[type]."),
    );
    assert.ok(members.length >= 4, "type-literal member symbols");
    const contains = store.links().filter((l) => l.kind === "contains");
    assert.ok(contains.length > 0);
    for (const link of contains) {
      assert.equal(link.resolution, "resolved", link.targetName);
      assert.ok(symbols.has(link.targetId), link.targetName);
      assert.ok(symbols.has(link.sourceId), link.targetName);
    }
  } finally {
    store.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("no step of a member call's receiver is a value the checker reduced from several producers", async () => {
  // C-41 review: the object a property is read from can itself be computed,
  // and the checker reduces identical types to one arm. The receiver's chain
  // is walked to its producers: one producer keeps the link, several give a
  // candidate set of each arm's member, and a value the walk cannot follow
  // leaves the call unresolved. Interface and object-literal members too.
  const got = await outcomes(
    {
      "src/use.ts": [
        "type Shim = { process: { argv(): string[] } };",
        "declare const nodeShim: Shim;",
        "declare const webShim: { process: { argv(): string[] } };",
        "declare const isNode: boolean;",
        "const shim = isNode ? nodeShim : webShim;",
        "shim.process.argv();",
        "nodeShim.process.argv();",
        "type Api = { shell: { open(): void } };",
        "declare const desktop: Api | undefined;",
        "declare const web: { shell: { open(): void } };",
        "const api = desktop ?? web;",
        "api.shell.open();",
        "declare const pick: boolean;",
        "declare const a: { util: { run(): void } };",
        "declare const b: { util: { run(): void } };",
        "function choose() { if (pick) return a; return b; }",
        "choose().util.run();",
        "const list = [a, b];",
        "list[1].util.run();",
        "for (const x of list) x.util.run();",
        "list.forEach((c) => c.util.run());",
        "declare const f1: () => { run(): void };",
        "declare const f2: () => { run(): void };",
        "(pick ? f1 : f2)().run();",
        "declare const given: { log: { info(m: string): void } } | undefined;",
        "const ctx = given ?? { log: { info() {} } };",
        "ctx.log.info('x');",
        "declare function same<T>(value: T): T;",
        "same(pick ? a : b).util.run();",
        "same(a).util.run();",
        "[a, b][0]!.util.run();",
        "interface IA { run(): void }",
        "interface IB { run(): void }",
        "declare const ia: IA;",
        "declare const ib: IB;",
        "const ichosen = pick ? ia : ib;",
        "ichosen.run();",
        "const csv = { format() {} };",
        "const tsv = { format() {} };",
        "const formats = [csv, tsv];",
        "formats[1]!.format();",
        "for (const f of formats) f.format();",
        "declare function createApi<T>(config: T): { util: T };",
        "const made = createApi({ run() {} });",
        "made.util.run();",
        "",
      ].join("\n"),
    },
    "src/use.ts",
    true,
  );
  assert.deepEqual(got, {
    "shim.process.argv(); @shim.process.argv": [
      "src/use.ts#Shim.[type].process.argv",
      "src/use.ts#webShim.[type].process.argv",
    ],
    // A written path stays definite.
    "nodeShim.process.argv(); @nodeShim.process.argv":
      "src/use.ts#Shim.[type].process.argv",
    "api.shell.open(); @api.shell.open": [
      "src/use.ts#Api.[type].shell.open",
      "src/use.ts#web.[type].shell.open",
    ],
    "choose().util.run(); @choose": "src/use.ts#choose",
    "choose().util.run(); @(expression).run": [
      "src/use.ts#a.[type].util.run",
      "src/use.ts#b.[type].util.run",
    ],
    // One element: the right one, where the checker names the first.
    "list[1].util.run(); @(expression).run": "src/use.ts#b.[type].util.run",
    "for (const x of list) x.util.run(); @x.util.run": [
      "src/use.ts#a.[type].util.run",
      "src/use.ts#b.[type].util.run",
    ],
    "list.forEach((c) => c.util.run()); @list.forEach": "library:",
    "list.forEach((c) => c.util.run()); @c.util.run": [
      "src/use.ts#a.[type].util.run",
      "src/use.ts#b.[type].util.run",
    ],
    "(pick ? f1 : f2)().run(); @(expression)": "unresolved:no-symbol",
    // Each arm's member is in a function type's return: no symbol.
    "(pick ? f1 : f2)().run(); @(expression).run":
      "unresolved:reduced-receiver",
    // The literal arm's member has no anchor: its producers decide.
    "ctx.log.info('x'); @ctx.log.info": "unresolved:object-producer-unverified",
    "same(pick ? a : b).util.run(); @same": "src/use.ts#same",
    // A generic call whose type argument was inferred from a reduced value.
    "same(pick ? a : b).util.run(); @(expression).run":
      "unresolved:receiver-unverified",
    "same(a).util.run(); @same": "src/use.ts#same",
    "same(a).util.run(); @(expression).run": "src/use.ts#a.[type].util.run",
    "[a, b][0]!.util.run(); @(expression).run": "src/use.ts#a.[type].util.run",
    // Interface members: main linked `IA.run` only.
    "ichosen.run(); @ichosen.run": ["src/use.ts#IA.run", "src/use.ts#IB.run"],
    // Object-literal members: main linked `csv.format`.
    "formats[1]!.format(); @(expression).format": "src/use.ts#tsv.format",
    "for (const f of formats) f.format(); @f.format": [
      "src/use.ts#csv.format",
      "src/use.ts#tsv.format",
    ],
    "const made = createApi({ run() {} }); @createApi": "src/use.ts#createApi",
    // A literal in a call argument has no symbol (further work).
    "made.util.run(); @made.util.run": "unresolved:local",
  });
});

test("anchored object-literal members through elements, iteration and callbacks are each element's", async () => {
  // C-41 review: main linked each of these to `a.setup`, the first element.
  const got = await outcomes(
    {
      "src/use.ts": [
        "const a = { setup() {} };",
        "const b = { setup() {} };",
        "const list = [a, b];",
        "declare const i: number;",
        "list[i].setup();",
        "list[0].setup();",
        "for (const p of list) p.setup();",
        "for (const q of [a, b]) q.setup();",
        "list.forEach((r) => r.setup());",
        "const impl = { run() {} };",
        "declare const given: { run(): void } | undefined;",
        "const api = given ?? impl;",
        "api.run();",
        "",
      ].join("\n"),
    },
    "src/use.ts",
    true,
  );
  assert.deepEqual(got, {
    "list[i].setup(); @(expression).setup": [
      "src/use.ts#a.setup",
      "src/use.ts#b.setup",
    ],
    "list[0].setup(); @(expression).setup": "src/use.ts#a.setup",
    "for (const p of list) p.setup(); @p.setup": [
      "src/use.ts#a.setup",
      "src/use.ts#b.setup",
    ],
    "for (const q of [a, b]) q.setup(); @q.setup": [
      "src/use.ts#a.setup",
      "src/use.ts#b.setup",
    ],
    "list.forEach((r) => r.setup()); @list.forEach": "library:",
    "list.forEach((r) => r.setup()); @r.setup": [
      "src/use.ts#a.setup",
      "src/use.ts#b.setup",
    ],
    "api.run(); @api.run": [
      "src/use.ts#given.[type].[|0].run",
      "src/use.ts#impl.run",
    ],
  });
});

test("the walk keeps what the checker narrows, instantiates or types by context", async () => {
  // C-41 review, from the sweep: none of these is a reduced union, and each
  // keeps the checker's single member.
  const got = await outcomes(
    {
      "src/use.ts": [
        "class Filter { toString(): string { return ''; } }",
        "declare const results: (string | Filter)[];",
        "results.map((r) => (typeof r === 'string' ? r : r.toString()));",
        "class Base { start() {} }",
        "class Fast extends Base { ready() {} }",
        "declare function make(): Base;",
        "const adapter = make();",
        "if (adapter instanceof Fast) adapter.ready();",
        "interface Check<T> { toBe(value: T): void }",
        "declare function expect<T>(actual: T): Check<T>;",
        "declare const pick: boolean;",
        "declare const a: { n: number };",
        "declare const b: { n: number };",
        "expect(pick ? a : b).toBe(a);",
        "class Opt<T> { inner!: T; unwrap() { return this.inner; } }",
        "class NonOpt<T> { inner!: T; unwrap() { return this.inner; } }",
        "declare const wrapped: NonOpt<Opt<number>>;",
        "wrapped.unwrap().unwrap();",
        "interface Action { checked?(state: number): boolean; perform(state: number): boolean }",
        "declare function register(action: Action): Action;",
        "register({ checked: (state) => state > 0, perform(state) { return !this.checked!(state); } });",
        "",
      ].join("\n"),
    },
    "src/use.ts",
    true,
  );
  assert.deepEqual(got, {
    "results.map((r) => (typeof r === 'string' ? r : r.toString())); @results.map":
      "library:",
    "results.map((r) => (typeof r === 'string' ? r : r.toString())); @r.toString":
      "src/use.ts#Filter.toString",
    "const adapter = make(); @make": "src/use.ts#make",
    "if (adapter instanceof Fast) adapter.ready(); @adapter.ready":
      "src/use.ts#Fast.ready",
    "expect(pick ? a : b).toBe(a); @expect": "src/use.ts#expect",
    "expect(pick ? a : b).toBe(a); @(expression).toBe": "src/use.ts#Check.toBe",
    "wrapped.unwrap().unwrap(); @wrapped.unwrap": "src/use.ts#NonOpt.unwrap",
    "wrapped.unwrap().unwrap(); @(expression).unwrap": "src/use.ts#Opt.unwrap",
    "register({ checked: (state) => state > 0, perform(state) { return !this.checked!(state); } }); @register":
      "src/use.ts#register",
    "register({ checked: (state) => state > 0, perform(state) { return !this.checked!(state); } }); @this.checked":
      "src/use.ts#Action.checked",
  });
});

test("a callback parameter typed by a generic call keeps the declared container's members", async () => {
  // C-41 review, from the sweep: `middleware: (gDM) => gDM().concat(…)`.
  const got = await outcomes(
    {
      "src/use.ts": [
        "declare const pick: boolean;",
        "declare const c1: { m(): void };",
        "declare const c2: { m(): void };",
        "interface Tuple<T> { concat(x: T): Tuple<T> }",
        "declare function configure<M>(options: { seed: M; middleware: (gdm: () => Tuple<M>) => Tuple<M> }): void;",
        "configure({ seed: pick ? c1 : c2, middleware: (gdm) => gdm().concat(c1) });",
        "declare function run<T>(value: T, f: (x: T) => void): void;",
        "run(pick ? c1 : c2, (x) => x.m());",
        "",
      ].join("\n"),
    },
    "src/use.ts",
    true,
  );
  assert.deepEqual(got, {
    "configure({ seed: pick ? c1 : c2, middleware: (gdm) => gdm().concat(c1) }); @configure":
      "src/use.ts#configure",
    "configure({ seed: pick ? c1 : c2, middleware: (gdm) => gdm().concat(c1) }); @gdm":
      "unresolved:local",
    "configure({ seed: pick ? c1 : c2, middleware: (gdm) => gdm().concat(c1) }); @(expression).concat":
      "src/use.ts#Tuple.concat",
    "run(pick ? c1 : c2, (x) => x.m()); @run": "src/use.ts#run",
    "run(pick ? c1 : c2, (x) => x.m()); @x.m": "unresolved:receiver-unverified",
  });
});

test("nested type positions have their places; a type literal's overloads are one symbol", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "c41-ids-"));
  const root = join(scratch, "project");
  const store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "c41");
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "tsconfig.json"), tsconfig);
    await writeFile(
      join(root, "src/use.ts"),
      [
        "export type Over = { run(): void; run(x: number): void };",
        "declare const o: Over;",
        "o.run();",
        "o.run(1);",
        "declare const box: Promise<{ open(): void }>;",
        "declare const nested: { inner: { go(): void }[] };",
        "declare const pair: [{ a(): void }, { b(): void }];",
        "declare const either: { run(): void } | { stop(): void };",
        "export function render(db: { getConfig(): number }) {}",
        "",
      ].join("\n"),
    );
    await indexProject(root, new LanguageRegistry([typescript]), store);
    const identities = store.findSymbols().map((s) => s.identity);
    for (const identity of [
      "box.[type].[<0>].open",
      "nested.[type].inner.[].go",
      "pair.[type].[#0].a",
      "pair.[type].[#1].b",
      // Inserting a union arm before another shifts its index.
      "either.[type].[|0].run",
      "either.[type].[|1].stop",
    ])
      assert.ok(identities.includes(identity), identity);
    // PR 60's symbol keys carry the nested places and the parameter slot:
    // `kind:identity`, no ordinal (the overload set is one symbol).
    const keys = new Map(
      store.findSymbols().map((s) => [s.identity, [s.key, s.ordinal]]),
    );
    for (const [identity, key] of [
      ["box.[type].[<0>].open", "method:box.[type].[<0>].open"],
      ["nested.[type].inner.[].go", "method:nested.[type].inner.[].go"],
      ["pair.[type].[#1].b", "method:pair.[type].[#1].b"],
      ["either.[type].[|1].stop", "method:either.[type].[|1].stop"],
      ["Over.[type].run", "method:Over.[type].run"],
      [
        "render.[param:db].[type].getConfig",
        "method:render.[param:db].[type].getConfig",
      ],
    ])
      assert.deepEqual(keys.get(identity), [key, 0], identity);
    // Like an interface's overloads: one symbol, which both calls reach.
    assert.equal(
      identities.filter((identity) => identity === "Over.[type].run").length,
      1,
    );
    const symbols = new Map(store.findSymbols().map((s) => [s.id, s.identity]));
    const calls = store
      .links()
      .filter((link) => link.kind === "calls" && link.targetName === "o.run");
    assert.deepEqual(
      calls.map((link) => symbols.get(link.targetId)),
      ["Over.[type].run", "Over.[type].run"],
    );
  } finally {
    store.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("a file's listing shows type-literal members after its other symbols, by position", async () => {
  // C-41 review: a generated schema of type literals added thousands of
  // symbols to one file; at a listing limit they displaced symbols shown
  // before.
  const scratch = await mkdtemp(join(tmpdir(), "c41-listing-"));
  const root = join(scratch, "project");
  const store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "c41");
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "tsconfig.json"), tsconfig);
    await writeFile(
      join(root, "src/schema.ts"),
      [
        "export type Schema = {",
        ...Array.from({ length: 20 }, (_, i) => `  t${i}: { m${i}(): void };`),
        "};",
        "export const config = { load() {} };",
        "export class Service { start() {} stop() {} }",
        "export function helper() {}",
        "",
      ].join("\n"),
    );
    await indexProject(root, new LanguageRegistry([typescript]), store);
    const all = store.symbolsForFile("src/schema.ts", 1000);
    const members = all.filter((symbol) => symbol.data?.typeMember);
    assert.equal(members.length, 40);
    const others = all.filter((symbol) => !symbol.data?.typeMember);
    // Every other symbol comes first, so a limit shows them before members.
    assert.deepEqual(
      store
        .symbolsForFile("src/schema.ts", others.length)
        .map((symbol) => symbol.identity),
      others.map((symbol) => symbol.identity),
    );
    assert.ok(others.some((symbol) => symbol.identity === "config.load"));
    // Members in source order.
    const starts = members.map((symbol) => symbol.range.start);
    assert.deepEqual(
      starts,
      [...starts].sort((a, b) => a - b),
    );
  } finally {
    store.close();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("a call that is not on a declared member of a literal stays unlinked", async () => {
  const got = await outcomes(
    {
      "src/use.ts": [
        "declare const keyed: { [key: string]: () => void };",
        "declare const mapped: { [K in 'a' | 'b']: () => void };",
        "declare const name: string;",
        "keyed.run();",
        "mapped.a();",
        "export function f(cb: () => void) {",
        "  cb();",
        "  const { factory } = { factory: () => 2 };",
        "  factory();",
        "}",
        "",
      ].join("\n"),
    },
    "src/use.ts",
  );
  assert.deepEqual(got, {
    "keyed.run();": "unresolved:index-signature",
    "mapped.a();": got["mapped.a();"],
    "cb();": "unresolved:local",
    "factory();": "unresolved:local",
  });
  assert.ok(
    typeof got["mapped.a();"] === "string" &&
      got["mapped.a();"].startsWith("unresolved"),
    `mapped type member: ${got["mapped.a();"]}`,
  );
});

/**
 * C-41 review 2: for every step kind the walk follows, a value with two
 * producers never gives a definite link to one producer's member. Each case
 * is one file; `pick`, `k`, `one`, `two`, `a`, `b` as the reviewer's fixture.
 */
const TWO_PRODUCERS = {
  // B1: array methods and iterators.
  "find on a literal": "[a, b].find((x) => !!k)!.run();",
  "find on a const array":
    "const list = [a, b];\nlist.find((x) => !!k)!.run();",
  at: "const list = [a, b];\nlist.at(-1)!.run();",
  "filter then index":
    "const list = [a, b];\nlist.filter((x) => !!k)[0]!.run();",
  pop: "const list = [a, b];\nlist.pop()!.run();",
  "slice then index": "const list = [a, b];\nlist.slice(1)[0]!.run();",
  "values iterator": "const list = [a, b];\nlist.values().next().value!.run();",
  entries: "const list = [a, b];\nfor (const [, f] of list.entries()) f.run();",
  reduce: "const list = [a, b];\nlist.reduce((x, y) => y).run();",
  "spread then sort": "const list = [a, b];\n[...list].sort()[0]!.run();",
  "Array.from": "const list = [a, b];\nArray.from(list)[0]!.run();",
  "object literals in an array":
    "const formats = [one, two];\nformats.find((f) => !!k)!.run();",
  // B2: parameter defaults.
  "a default and a call": "function use(x = a) { x.run(); }\nuse(b);\nuse();",
  "a destructured default":
    "function opts({ h = a } = {}) { h.run(); }\nopts({ h: b });\nopts();",
  "a constructor parameter property":
    "class P { constructor(private h = one) {} go() { this.h.run(); } }\nnew P(two);",
  // B3: fields and properties.
  "a field written elsewhere":
    "class S { h = a; swap() { this.h = b; } go() { this.h.run(); } }",
  "a property written elsewhere":
    "const state = { h: a };\nstate.h = b;\nstate.h.run();",
  "a field set in constructor branches":
    "class S { h; constructor() { if (pick) this.h = one; else this.h = two; } go() { this.h.run(); } }",
  // B4: generic calls.
  "two arguments to one type parameter":
    "declare function either<T>(x: T, y: T): T;\neither(a, b).run();",
  "two object literals to one type parameter":
    "declare function either<T>(x: T, y: T): T;\neither(one, two).run();",
  "an optional first argument":
    "declare function orElse<T>(x: T | undefined, y: T): T;\norElse(pick ? one : undefined, two).run();",
  "a rest parameter":
    "declare function firstOf<T>(...xs: T[]): T;\nfirstOf(one, two).run();",
  "an array argument":
    "declare function head<T>(xs: T[]): T;\nconst list = [a, b];\nhead(list).run();",
  "a Set of the elements":
    "const list = [a, b];\nnew Set(list).values().next().value!.run();",
  // B5: await and promise callbacks.
  "await of a generic result":
    "declare function load<T>(v: T): Promise<T>;\nasync function go() { (await load(pick ? a : b)).run(); }",
  "a promise callback":
    "declare function load<T>(v: T): Promise<T>;\nload(pick ? a : b).then((v) => v.run());",
  // Review round 2, reviewer B: promises and arrays of two shims.
  "Promise.all":
    "async function go() { const [x] = await Promise.all([a, b]); x.run(); }",
  "Promise.resolve": "Promise.resolve(pick ? a : b).then((x) => x.run());",
  "filter then forEach":
    "const list = [a, b];\nlist.filter((x) => !!k).forEach((x) => x.run());",
  // Producers added after creation.
  "an array pushed to":
    "const plugins = [one];\nplugins.push(two);\nfor (const x of plugins) x.run();",
  "a field set through a setter":
    "class L { private logger = one; setLogger(l: typeof two) { this.logger = l; } go() { this.logger.run(); } }",
  "a property reassigned":
    "const config = { r: one };\nconfig.r = two;\nconfig.r.run();",
  "defaults spread under options":
    "declare const opts: { r?: { run(): void } };\nconst merged = { ...{ r: one }, ...opts };\nmerged.r!.run();",
  "a spread of a choice":
    "const merged = { ...(pick ? { r: one } : { r: two }) };\nmerged.r.run();",
  "as const": "([pick ? one : two] as const)[0].run();",
  // Kinds the first round already covered, kept as a guard.
  "a conditional": "(pick ? a : b).run();",
  "nullish coalescing":
    "declare const maybe: typeof a | undefined;\n(maybe ?? b).run();",
  "an element by computed index":
    "const list = [a, b];\nlist[k.length]!.run();",
  "for-of": "const list = [a, b];\nfor (const x of list) x.run();",
  forEach: "const list = [a, b];\nlist.forEach((x) => x.run());",
  "a reassigned let": "let x = a;\nif (pick) x = b;\nx.run();",
  "an inferred return":
    "function choose() { if (pick) return a; return b; }\nchoose().run();",
};

test("no step kind gives a definite link to one of two producers", async () => {
  const header = [
    "declare const pick: boolean;",
    "declare const k: string;",
    "const one = { run() {} };",
    "const two = { run() {} };",
    "declare const a: { run(): void };",
    "declare const b: { run(): void };",
    "",
  ].join("\n");
  const failures = [];
  for (const [kind, body] of Object.entries(TWO_PRODUCERS)) {
    const got = await outcomes(
      { "src/use.ts": header + body + "\n" },
      "src/use.ts",
      true,
    );
    for (const [key, outcome] of Object.entries(got)) {
      if (!/@.*\brun$/.test(key)) continue;
      if (typeof outcome === "string" && outcome.startsWith("src/"))
        failures.push(`${kind}: ${key} -> ${outcome}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("an interface or class member keeps its link through a receiver the walk cannot follow", async () => {
  // C-41 review 2, reviewer B: `Unsubscribable.unsubscribe` and the like are
  // one declaration whatever producer supplied the value.
  const got = await outcomes(
    {
      "src/use.ts": [
        "interface Unsubscribable { unsubscribe(): void }",
        "class Store { getState() { return 1; } }",
        "declare function subscribe(): Unsubscribable;",
        "let sub: any;",
        "[1].forEach(() => { sub = subscribe(); });",
        "declare const list: Unsubscribable[];",
        "list.reduce((x, y) => y).unsubscribe();",
        "declare const stores: Store[];",
        "Array.from(stores)[0]!.getState();",
        "",
      ].join("\n"),
    },
    "src/use.ts",
    true,
  );
  assert.equal(
    got["list.reduce((x, y) => y).unsubscribe(); @(expression).unsubscribe"],
    "src/use.ts#Unsubscribable.unsubscribe",
  );
  assert.equal(
    got["Array.from(stores)[0]!.getState(); @(expression).getState"],
    "src/use.ts#Store.getState",
  );
});
