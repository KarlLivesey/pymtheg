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
async function outcomes(files, file) {
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
      result[site] =
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
  // literal types, so its declaration list names one member: no link.
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
    "(pick ? one : two).run();": "unresolved:local",
    "chosen.run();": "unresolved:local",
    "choose().run();": "unresolved:local",
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
