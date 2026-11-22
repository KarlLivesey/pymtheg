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
