// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import {
  checkLanguageConformance,
  contentHash,
  discoverLanguages,
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import toy from "../dist/graph/languages/toy/index.js";

async function sandbox(run) {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-graph-review-"));
  const root = join(scratch, "project");
  await mkdir(root);
  const database = join(scratch, "index.sqlite");
  const store = new SqliteGraphStore(database, "review-project");
  let closed = false;
  try {
    await run({
      scratch,
      root,
      database,
      store,
      closeInitial() {
        store.close();
        closed = true;
      },
    });
  } finally {
    if (!closed) store.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
const registry = () => new LanguageRegistry([toy]);

test("A1: edits above a symbol preserve IDs; repeated identities use source-order ordinals", async () => {
  await sandbox(async ({ root, store }) => {
    await writeFile(join(root, "lib.toy"), "def helper\ncall helper\n");
    await indexProject(root, registry(), store);
    const id = store.findSymbols({ name: "helper" })[0].id;
    await writeFile(
      join(root, "lib.toy"),
      "# a new comment\ndef helper\ncall helper\n",
    );
    await indexProject(root, registry(), store);
    assert.equal(store.findSymbols({ name: "helper" })[0].id, id);
    await writeFile(
      join(root, "lib.toy"),
      "def init\ncall missing\ndef init\n",
    );
    await indexProject(root, registry(), store);
    const duplicates = store
      .findSymbols({ name: "init" })
      .sort((a, b) => a.ordinal - b.ordinal);
    assert.deepEqual(
      duplicates.map((symbol) => symbol.ordinal),
      [0, 1],
    );
    assert.notEqual(duplicates[0].id, duplicates[1].id);
    await writeFile(
      join(root, "lib.toy"),
      "# 😀\ndef init\ncall missing\ndef init\n",
    );
    await indexProject(root, registry(), store);
    assert.deepEqual(
      store
        .findSymbols({ name: "init" })
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((symbol) => symbol.id),
      duplicates.map((symbol) => symbol.id),
    );
    const text = "A.f\nB.f\n";
    const file = {
      path: "methods.toy",
      text,
      hash: contentHash(text),
      module: "toy",
      version: "2",
      result: {
        status: "clean",
        diagnostics: [],
        links: [],
        symbols: [
          {
            key: "a",
            name: "f",
            identity: "A.f",
            kind: "method",
            range: { start: 0, end: 3 },
          },
          {
            key: "b",
            name: "f",
            identity: "B.f",
            kind: "method",
            range: { start: 4, end: 7 },
          },
        ],
      },
    };
    store.replaceFile(file);
    const methods = new Map(
      store
        .findSymbols({ kind: "method" })
        .map((symbol) => [symbol.identity, symbol.id]),
    );
    assert.notEqual(methods.get("A.f"), methods.get("B.f"));
    file.text = "B.f\nA.f\n";
    file.hash = contentHash(file.text);
    file.result.symbols[0].range = { start: 4, end: 7 };
    file.result.symbols[1].range = { start: 0, end: 3 };
    store.replaceFile(file);
    for (const symbol of store.findSymbols({ kind: "method" }))
      assert.equal(symbol.id, methods.get(symbol.identity));
  });
});

const unicodeText =
  "# café 😀\ndef answer\ncall missing\n# trailing padding keeps wrong byte positions in bounds\n";
const unicodeFixtures = [{ path: "unicode.toy", text: unicodeText }];
const unicodeExpected = {
  symbols: [
    {
      file: "unicode.toy",
      name: "unicode.toy",
      kind: "file",
      identity: "unicode.toy",
      at: unicodeText,
    },
    {
      file: "unicode.toy",
      name: "answer",
      kind: "function",
      identity: "answer",
      at: "def answer",
      range: {
        start: unicodeText.indexOf("def answer"),
        end: unicodeText.indexOf("def answer") + 10,
      },
    },
  ],
  links: [
    {
      file: "unicode.toy",
      kind: "calls",
      targetName: "missing",
      source: { name: "answer", kind: "function" },
      target: null,
      at: "call missing",
    },
  ],
};
test("A2: kit checks exact Unicode positions and rejects zero, off-by-one and byte-offset variants", async () => {
  await checkLanguageConformance(toy, unicodeFixtures, unicodeExpected);
  for (const mode of ["zero", "off-by-one", "bytes"]) {
    const broken = {
      ...toy,
      parse(input) {
        const result = toy.parse(input);
        for (const fact of [...result.symbols, ...result.links]) {
          if (mode === "zero") fact.range = { start: 0, end: 0 };
          else if (fact.kind !== "file") {
            const delta =
              mode === "bytes"
                ? Buffer.byteLength(input.text.slice(0, fact.range.start)) -
                  fact.range.start
                : 1;
            fact.range = {
              start: fact.range.start + delta,
              end: fact.range.end + delta,
            };
          }
        }
        return result;
      },
    };
    await assert.rejects(
      checkLanguageConformance(broken, unicodeFixtures, unicodeExpected),
      /Incorrect source position/,
      mode,
    );
  }
});

// Test-only compiler module. Every compiler read comes from the captured snapshot, never ts.sys.
function compilerModule(observations) {
  return {
    id: "compiler-fixture",
    version: "1",
    extensions: [".ts"],
    contextFiles: ["tsconfig*.json"],
    analyze(context) {
      observations.push({
        files: context.files.map((file) => file.path),
        changed: context.changedFiles,
        contexts: context.changedContextFiles,
      });
      const config = JSON.parse(
        context.contextFiles.find((file) => file.path === "tsconfig.json").text,
      );
      const sources = new Map(
        context.files.map((file) => [
          "/" + file.path,
          ts.createSourceFile(
            "/" + file.path,
            file.text,
            ts.ScriptTarget.Latest,
            true,
          ),
        ]),
      );
      const host = {
        getSourceFile: (path) => sources.get(path),
        getDefaultLibFileName: () => "/__none.d.ts",
        writeFile() {
          throw Error("no writes");
        },
        getCurrentDirectory: () => "/",
        getCanonicalFileName: (path) => path,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
        fileExists: (path) => sources.has(path),
        readFile: (path) => sources.get(path)?.text,
        directoryExists: () => true,
        getDirectories: () => [],
      };
      const program = ts.createProgram(
        [...sources.keys()],
        {
          noLib: true,
          types: [],
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          baseUrl: "/",
          paths: config.compilerOptions.paths,
        },
        host,
      );
      assert.deepEqual(program.getSyntacticDiagnostics(), []);
      const checker = program.getTypeChecker();
      return context.files.map((file) => {
        const source = sources.get("/" + file.path);
        const result = {
          status: "clean",
          diagnostics: [],
          symbols: [],
          links: [],
        };
        const visit = (node, owner = null) => {
          if (ts.isFunctionDeclaration(node) && node.name) {
            owner = node.name.text;
            result.symbols.push({
              key: owner,
              name: owner,
              identity: owner,
              kind: "function",
              range: { start: node.getStart(source), end: node.end },
            });
          }
          if (ts.isCallExpression(node)) {
            let symbol = checker.getSymbolAtLocation(node.expression);
            if (symbol?.flags & ts.SymbolFlags.Alias)
              symbol = checker.getAliasedSymbol(symbol);
            const declaration = symbol?.declarations?.[0];
            result.links.push({
              sourceKey: owner,
              kind: "calls",
              targetName: node.expression.getText(source),
              range: { start: node.getStart(source), end: node.end },
              data: declaration
                ? {
                    file: declaration.getSourceFile().fileName.slice(1),
                    key: symbol.name,
                  }
                : null,
            });
          }
          ts.forEachChild(node, (child) => visit(child, owner));
        };
        visit(source);
        return { path: file.path, result };
      });
    },
    resolve({ symbols, links }) {
      return links.flatMap((link) => {
        const target = symbols.find(
          (symbol) =>
            symbol.file === link.data?.file && symbol.key === link.data?.key,
        );
        return target ? [{ linkId: link.id, targetId: target.id }] : [];
      });
    },
  };
}
test("A3: snapshot compiler resolves alias and barrel on cold reopen, then config-only change retargets it", async () => {
  await sandbox(async ({ root, store, database, closeInitial }) => {
    const sources = {
      "api.ts": "export function f() {}\n",
      "barrel.ts": "export { f } from './api';\n",
      "main.ts": "import { f } from '@api'; export function run() { f(); }\n",
      "other.ts": "export function f() {}\n",
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@api": ["barrel.ts"] } },
      }),
    };
    for (const [path, text] of Object.entries(sources))
      await writeFile(join(root, path), text);
    const observations = [];
    const first = await indexProject(
      root,
      new LanguageRegistry([compilerModule(observations)]),
      store,
    );
    assert.deepEqual(first.failed, []);
    assert.deepEqual(first.analysisErrors, []);
    assert.deepEqual(first.resolutionErrors, []);
    assert.equal(first.contextFiles, 1);
    const api = store.findSymbols({ file: "api.ts", name: "f" })[0];
    assert.equal(store.links()[0].targetId, api.id);
    closeInitial();
    const reopened = new SqliteGraphStore(database);
    const cold = [];
    try {
      const bytes = await readFile(database);
      const repeat = await indexProject(
        root,
        new LanguageRegistry([compilerModule(cold)]),
        reopened,
      );
      assert.equal(repeat.indexed, 0);
      assert.equal(repeat.unchanged, 4);
      assert.equal(cold.length, 1);
      assert.deepEqual(cold[0].changed, []);
      assert.equal(reopened.links()[0].targetId, api.id);
      assert.deepEqual(await readFile(database), bytes);
      await writeFile(
        join(root, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { paths: { "@api": ["other.ts"] } },
        }),
      );
      const changed = await indexProject(
        root,
        new LanguageRegistry([compilerModule(cold)]),
        reopened,
      );
      assert.equal(changed.indexed, 0);
      assert.equal(changed.unchanged, 4);
      assert.deepEqual(cold[1].contexts, ["tsconfig.json"]);
      assert.equal(
        reopened.links()[0].targetId,
        reopened.findSymbols({ file: "other.ts", name: "f" })[0].id,
      );
      assert.equal(
        reopened.findSymbols({ file: "api.ts", name: "f" })[0].id,
        api.id,
      );
      await rm(join(root, "tsconfig.json"));
      const missing = await indexProject(
        root,
        new LanguageRegistry([compilerModule(cold)]),
        reopened,
      );
      assert.deepEqual(cold[2].contexts, ["tsconfig.json"]);
      assert.equal(missing.analysisErrors.length, 1);
      assert.ok(missing.failedCount);
    } finally {
      reopened.close();
    }
  });
});

test("A4: storage read/write failures propagate, preserving existing facts instead of pretending a parser failed", async () => {
  await sandbox(async ({ root, store, database }) => {
    await writeFile(join(root, "x.toy"), "def x\ncall missing\n");
    await indexProject(root, registry(), store);
    const symbols = store.findSymbols();
    const links = store.links();
    const bytes = await readFile(database);
    for (const asyncFailure of [false, true]) {
      const broken = new Proxy(store, {
        get(target, key) {
          if (key === "getFile")
            return asyncFailure
              ? async () => {
                  throw Error("storage unavailable");
                }
              : () => {
                  throw Error("storage unavailable");
                };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      await assert.rejects(
        indexProject(root, registry(), broken),
        /storage unavailable/,
      );
      assert.deepEqual(store.findSymbols(), symbols);
      assert.deepEqual(store.links(), links);
      assert.deepEqual(await readFile(database), bytes);
    }
    const brokenWriter = new Proxy(store, {
      get(target, key) {
        if (key === "replaceAnalysis")
          return () => {
            throw Error("storage write unavailable");
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await assert.rejects(
      indexProject(root, registry(), brokenWriter),
      /storage write unavailable/,
    );
    assert.deepEqual(store.findSymbols(), symbols);
    assert.deepEqual(store.links(), links);
  });
});

test("A5: added and ambiguous links persist and query without collapsing candidates", async () => {
  await sandbox(async ({ root, store, database }) => {
    for (const [path, text] of Object.entries({
      "main.toy": "def main\ncall mystery\n",
      "left.toy": "def left\n",
      "right.toy": "def right\n",
    }))
      await writeFile(join(root, path), text);
    let add = true;
    const module = {
      ...toy,
      resolve({ symbols, links }) {
        const main = symbols.find((symbol) => symbol.name === "main");
        const targets = symbols.filter((symbol) =>
          ["left", "right"].includes(symbol.name),
        );
        return {
          resolutions:
            targets.length === 2
              ? [
                  {
                    linkId: links[0].id,
                    candidateIds: targets.map((symbol) => symbol.id),
                  },
                ]
              : [],
          links: add
            ? [
                {
                  key: "implicit",
                  file: "main.toy",
                  sourceId: main.id,
                  kind: "implements",
                  targetName: "left",
                  range: main.range,
                  targetId: targets.find((symbol) => symbol.name === "left").id,
                },
              ]
            : [],
        };
      },
    };
    const reg = new LanguageRegistry([module]);
    const report = await indexProject(root, reg, store);
    assert.deepEqual(report.resolutionErrors, []);
    assert.equal(report.ambiguous, 1);
    assert.equal(report.unresolved, 0);
    const left = store.findSymbols({ name: "left" })[0];
    const main = store.findSymbols({ name: "main" })[0];
    assert.equal(store.incoming(left.id).length, 2);
    assert.equal(store.outgoing(main.id, "implements")[0].origin, "analysis");
    assert.equal(store.ambiguous()[0].targetId, null);
    assert.equal(store.ambiguous()[0].candidates.length, 2);
    assert.equal(store.neighbourhood(main.id, 1).symbols.length, 3);
    const reopened = new SqliteGraphStore(database);
    try {
      assert.deepEqual(reopened.links(), store.links());
    } finally {
      reopened.close();
    }
    const before = store.links();
    assert.throws(
      () =>
        store.replaceAnalysis("toy", {
          resolutions: [
            {
              linkId: before.find((link) => link.origin === "parse").id,
              candidateIds: [left.id, left.id],
            },
          ],
          links: [],
        }),
      /distinct/,
    );
    assert.deepEqual(store.links(), before);
    store.removeFile("right.toy");
    assert.equal(store.ambiguous()[0].candidates.length, 1);
    assert.equal(store.ambiguous()[0].targetId, null);
    add = false;
    await rm(join(root, "right.toy"));
    await indexProject(root, reg, store);
    assert.equal(store.links().length, 1);
    assert.equal(store.unresolved().length, 1);
  });
});

test("A6: claims use exact-name > pattern > extension, then literal length; decline and ties are explicit", async () => {
  const generic = { ...toy, id: "generic", extensions: [".ts", ".json"] };
  const declaration = {
    ...toy,
    id: "declaration",
    extensions: [],
    patterns: ["*.d.ts", "tsconfig.*.json"],
  };
  const exact = {
    ...toy,
    id: "exact",
    extensions: [],
    filenames: ["special.d.ts"],
  };
  const reg = new LanguageRegistry([generic, declaration, exact]);
  assert.equal(reg.claim("src/api.d.ts").id, "declaration");
  assert.equal(reg.claim("src/api.ts").id, "generic");
  assert.equal(reg.claim("tsconfig.build.json").id, "declaration");
  assert.equal(reg.claim("other.json").id, "generic");
  assert.equal(reg.claim("special.d.ts").id, "exact");
  assert.equal(
    new LanguageRegistry([declaration]).claim("other.json"),
    undefined,
  );
  assert.equal(
    new LanguageRegistry([
      declaration,
      { ...exact, accepts: () => false },
    ]).claim("special.d.ts").id,
    "declaration",
  );
  const narrow = { ...declaration, id: "narrow", patterns: ["api*.d.ts"] };
  assert.equal(
    new LanguageRegistry([declaration, narrow]).claim("api-test.d.ts").id,
    "narrow",
  );
  await sandbox(async ({ root, store }) => {
    await writeFile(join(root, "x.toy"), "def x\n");
    await writeFile(join(root, "good.unique"), "def good\n");
    const report = await indexProject(
      root,
      new LanguageRegistry([
        toy,
        { ...toy, id: "tie" },
        { ...toy, id: "unique", extensions: [".unique"] },
      ]),
      store,
    );
    assert.deepEqual(report.failed, ["x.toy"]);
    assert.equal(report.indexed, 1);
    assert.equal(store.findSymbols({ name: "good" }).length, 1);
  });
});

test("A7: invalid UTF-8 is failed with original-byte hash and never reaches the parser", async () => {
  await sandbox(async ({ root, store }) => {
    const bytes = Buffer.from([0x64, 0x65, 0x66, 0x20, 0xff, 0x0a]);
    await writeFile(join(root, "bad.toy"), bytes);
    let parses = 0;
    const report = await indexProject(
      root,
      new LanguageRegistry([
        {
          ...toy,
          parse(input) {
            parses++;
            return toy.parse(input);
          },
        },
      ]),
      store,
    );
    assert.equal(parses, 0);
    assert.deepEqual(report.failed, ["bad.toy"]);
    assert.match(report.errors[0].message, /encoding/);
    assert.equal(store.getFile("bad.toy").hash, contentHash(bytes));
    assert.equal(store.getFile("bad.toy").result.status, "failed");
    assert.equal(store.findSymbols().length, 0);
  });
});

test("A8: ordering is stable across locale environments", async () => {
  await sandbox(async ({ root, store }) => {
    for (const path of ["é.toy", "a.toy", "Z.toy"])
      await writeFile(join(root, path), "def x\n");
    for (const path of ["\uE000.cfg", "😀.cfg"])
      await writeFile(join(root, path), "context");
    const contextRegistry = new LanguageRegistry([
      { ...toy, contextFiles: ["*.cfg"] },
    ]);
    await indexProject(root, contextRegistry, store);
    const before = await readFile(join(root, "..", "index.sqlite"));
    await indexProject(root, contextRegistry, store);
    assert.deepEqual(await readFile(join(root, "..", "index.sqlite")), before);
    const url = pathToFileURL(
      join(process.cwd(), "dist/graph/registry.js"),
    ).href;
    const code = `import {LanguageRegistry} from ${JSON.stringify(url)}; console.log(new LanguageRegistry([${["z", "a", "b"].map((id) => `{id:'${id}',version:'1',extensions:['.${id}'],parse(){}}`).join(",")}]).modules.map(m=>m.id).join(','));`;
    const run = (locale) =>
      execFileSync(process.execPath, ["--input-type=module", "-e", code], {
        env: { ...process.env, LANG: locale, LC_ALL: locale },
        encoding: "utf8",
      });
    assert.equal(run("C"), run("sv_SE.UTF-8"));
  });
});

test("A10: production discovery hides test-only languages, including the toy, even from an unrelated working directory", async () => {
  // Real language modules may or may not be present; the property is that
  // production discovery omits exactly the test-only modules, never which
  // real languages exist.
  const describe = (registry) =>
    registry.modules.map((module) => ({
      id: module.id,
      testOnly: module.testOnly === true,
    }));
  const check = (production, testMode) => {
    const productionIds = production.map((module) => module.id);
    const testModeIds = testMode.map((module) => module.id);
    assert.deepEqual(
      production.filter((module) => module.testOnly),
      [],
      "production discovery returned a test-only module",
    );
    assert.ok(!productionIds.includes("toy"), "production offers toy");
    const toyEntry = testMode.find((module) => module.id === "toy");
    assert.ok(toyEntry, "test-mode discovery is missing toy");
    assert.equal(toyEntry.testOnly, true, "toy is not marked test-only");
    for (const id of productionIds)
      assert.ok(testModeIds.includes(id), `test mode dropped ${id}`);
    assert.deepEqual(
      testModeIds.filter((id) => !productionIds.includes(id)),
      testMode.filter((module) => module.testOnly).map((module) => module.id),
      "test mode minus production must be exactly the test-only modules",
    );
  };
  const production = await discoverLanguages();
  const testMode = await discoverLanguages(undefined, {
    includeTestOnly: true,
  });
  check(describe(production), describe(testMode));
  assert.equal(production.claim("x.toy"), undefined);
  assert.equal(testMode.claim("x.toy").id, "toy");
  await sandbox(async ({ scratch }) => {
    const url = pathToFileURL(
      join(process.cwd(), "dist/graph/registry.js"),
    ).href;
    const code = `import {discoverLanguages} from ${JSON.stringify(url)}; const d = (r) => r.modules.map((m) => ({ id: m.id, testOnly: m.testOnly === true })); const p = await discoverLanguages(); const t = await discoverLanguages(undefined, { includeTestOnly: true }); console.log(JSON.stringify({ production: d(p), testMode: d(t), productionToy: p.claim('x.toy')?.id ?? null, testToy: t.claim('x.toy')?.id ?? null }));`;
    const output = JSON.parse(
      execFileSync(process.execPath, ["--input-type=module", "-e", code], {
        cwd: scratch,
        encoding: "utf8",
      }),
    );
    check(output.production, output.testMode);
    assert.equal(output.productionToy, null);
    assert.equal(output.testToy, "toy");
  });
});

test("A3: analyze-only compiler modules can pass the same positional conformance kit", async () => {
  const api = "export function f() {}\n";
  const main =
    "import { f } from '@api'; export function run() { f(); missing(); }\n";
  await checkLanguageConformance(
    compilerModule([]),
    [
      { path: "api.ts", text: api },
      { path: "barrel.ts", text: "export { f } from './api';\n" },
      { path: "main.ts", text: main },
      {
        path: "tsconfig.json",
        text: JSON.stringify({
          compilerOptions: { paths: { "@api": ["barrel.ts"] } },
        }),
        context: true,
      },
    ],
    {
      symbols: [
        {
          file: "api.ts",
          name: "f",
          identity: "f",
          kind: "function",
          at: "export function f() {}",
        },
        {
          file: "main.ts",
          name: "run",
          identity: "run",
          kind: "function",
          at: "export function run() { f(); missing(); }",
        },
      ],
      links: [
        {
          file: "main.ts",
          kind: "calls",
          targetName: "f",
          source: { name: "run", kind: "function" },
          target: { file: "api.ts", name: "f", kind: "function" },
          at: "f()",
        },
        {
          file: "main.ts",
          kind: "calls",
          targetName: "missing",
          source: { name: "run", kind: "function" },
          target: null,
          at: "missing()",
        },
      ],
    },
  );
});

test("parse and project analysis compose with canonical partial status in the conformance kit", async () => {
  const both = {
    ...toy,
    analyze({ files }) {
      return files.map((file) => ({
        path: file.path,
        result: {
          ...file.result,
          status: "partial",
          diagnostics: [{ message: "Fixture project qualification" }],
        },
      }));
    },
  };
  await checkLanguageConformance(
    both,
    unicodeFixtures.map((fixture) => ({ ...fixture, status: "partial" })),
    unicodeExpected,
  );
});

test("late target addition resolves retained links without reparsing the caller", async () => {
  await sandbox(async ({ root, store }) => {
    const parsed = [];
    const reg = new LanguageRegistry([
      {
        ...toy,
        parse(input) {
          parsed.push(input.path);
          return toy.parse(input);
        },
      },
    ]);
    await writeFile(
      join(root, "main.toy"),
      "import later.toy\ndef main\ncall later\n",
    );
    const first = await indexProject(root, reg, store);
    assert.equal(first.unresolved, 2);
    const main = store.findSymbols({ name: "main" })[0].id;
    await writeFile(join(root, "later.toy"), "def later\n");
    const next = await indexProject(root, reg, store);
    assert.equal(next.indexed, 1);
    assert.equal(next.unchanged, 1);
    assert.equal(next.unresolved, 0);
    assert.deepEqual(parsed, ["main.toy", "later.toy"]);
    assert.equal(store.findSymbols({ name: "main" })[0].id, main);
  });
});

test("A2/A5: positional kit checks added links and candidate sets independent of fixture order", async () => {
  const text = "def main\ncall choose\ncall missing\ndef left\ndef right\n";
  const module = {
    ...toy,
    resolve({ symbols, links }) {
      const named = (name) => symbols.find((symbol) => symbol.name === name);
      return {
        resolutions: [
          {
            linkId: links.find((link) => link.targetName === "choose").id,
            candidateIds: [named("left").id, named("right").id],
          },
        ],
        links: [
          {
            key: "implicit",
            file: "x.toy",
            sourceId: named("main").id,
            kind: "implements",
            targetName: "left",
            range: named("main").range,
            targetId: named("left").id,
          },
        ],
      };
    },
  };
  for (const order of [
    ["left", "right"],
    ["right", "left"],
  ]) {
    await checkLanguageConformance(module, [{ path: "x.toy", text }], {
      symbols: [
        {
          file: "x.toy",
          name: "x.toy",
          kind: "file",
          identity: "x.toy",
          at: text,
        },
        ...["main", "left", "right"].map((name) => ({
          file: "x.toy",
          name,
          kind: "function",
          identity: name,
          at: `def ${name}`,
        })),
      ],
      links: [
        {
          file: "x.toy",
          kind: "calls",
          targetName: "choose",
          source: { name: "main", kind: "function" },
          target: null,
          candidates: order.map((name) => ({
            file: "x.toy",
            name,
            kind: "function",
          })),
          at: "call choose",
        },
        {
          file: "x.toy",
          kind: "calls",
          targetName: "missing",
          source: { name: "main", kind: "function" },
          target: null,
          at: "call missing",
        },
        {
          file: "x.toy",
          kind: "implements",
          targetName: "left",
          source: { name: "main", kind: "function" },
          target: { file: "x.toy", name: "left", kind: "function" },
          at: "def main",
        },
      ],
    });
  }
});
