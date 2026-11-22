// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import typescript, {
  statistics,
} from "../dist/graph/languages/typescript/index.js";
import tsCompiler from "typescript";
import { GraphView } from "../dist/mcp/graph-view.js";

// Resolution rules of the TypeScript/JavaScript module: each rule has a positive
// case, a look-alike negative case and, where relevant, an ambiguous case.

const registry = () => new LanguageRegistry([typescript]);
async function project(files, run) {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-graph-typescript-"));
  const root = join(scratch, "project");
  const database = join(scratch, "graph.sqlite");
  let store = new SqliteGraphStore(database, "typescript-rules");
  const write = async (path, text) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  };
  try {
    await mkdir(root);
    for (const [path, text] of Object.entries(files)) await write(path, text);
    const report = await indexProject(root, registry(), store);
    const graph = {
      root,
      database,
      write,
      remove: (path) => rm(join(root, path)),
      get store() {
        return store;
      },
      reopen() {
        store.close();
        store = new SqliteGraphStore(database);
      },
      reindex: () => indexProject(root, registry(), store),
      /** Links in `file` whose range text is `at` (optionally of `kind`). */
      links(file, at, kind) {
        const text = store.getFile(file).text;
        return store
          .links()
          .filter(
            (link) =>
              link.file === file &&
              text.slice(link.range.start, link.range.end) === at &&
              (kind === undefined || link.kind === kind),
          );
      },
      link(file, at, kind) {
        const found = graph.links(file, at, kind);
        assert.equal(
          found.length,
          1,
          `one ${kind ?? "link"} at ${at} in ${file}`,
        );
        return found[0];
      },
      symbol(file, identity, kind) {
        const found = store
          .findSymbols({ file })
          .filter(
            (symbol) =>
              symbol.identity === identity &&
              (kind === undefined || symbol.kind === kind),
          );
        assert.equal(found.length, 1, `one symbol ${identity} in ${file}`);
        return found[0];
      },
      /** "file#identity" of a link's definite target or null. */
      target(link) {
        const symbol = store
          .findSymbols()
          .find((symbol) => symbol.id === link.targetId);
        return symbol ? `${symbol.file}#${symbol.identity}` : null;
      },
      candidates(link) {
        const all = store.findSymbols();
        return link.candidates
          .map(({ id }) => all.find((symbol) => symbol.id === id))
          .map((symbol) => `${symbol.file}#${symbol.identity}`)
          .sort();
      },
    };
    await run(graph, report);
  } finally {
    store.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
const clean = (report) => {
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.analysisErrors, []);
  assert.deepEqual(report.resolutionErrors, []);
};

const libraryTarget = (link) => {
  assert.equal(
    link.resolution,
    "library",
    `${link.targetName} ${JSON.stringify(link.data)}`,
  );
  assert.equal(link.libraries.length, 1);
  const { id, ...target } = link.libraries[0];
  return target;
};

test("bundled declarations prove the owner of an existing runtime use", async () => {
  await project(
    {
      // Vitest packages/vitest/src/node/pools/browser.ts uses Map.delete on openingSessions.
      "browser.ts": `export class BrowserPool {
        openingSessions = new Map<string, object>();
        close(sessionId: string) { this.openingSessions.delete(sessionId); }
      }
      declare const value: any;
      declare const unknownValue: unknown;
      value.delete('x');
      unknownValue.delete('x');
      class Local { local = true; delete(key: string) { return key.length > 0; } }
      function remove(mixed: Map<string, object> | Local) { mixed.delete('x'); }
      JSON.parse('null');
      Promise.all([]);
      ['a'].map(x => x);
      document.querySelector('a');
      fetch('/');
      export {};`,
      "script.js": `console.log('ready');\nprocess.cwd();`,
      "es-only/jsconfig.json": '{"compilerOptions":{"lib":["ES2022"]}}',
      "es-only/browser.js": `document.querySelector('a');`,
    },
    async (graph, report) => {
      clean(report);
      const calls = (at) =>
        graph
          .links("browser.ts", at, "calls")
          .sort((a, b) => a.range.start - b.range.start);
      const [mapDelete, any, unknown, mixed] = calls("delete");
      assert.deepEqual(libraryTarget(mapDelete), {
        ecosystem: "typescript-lib",
        unit: "es",
        symbol: "Map.prototype.delete",
        evidence: "declaring-owner",
      });
      assert.equal(any.resolution, "unresolved");
      assert.equal(unknown.resolution, "unresolved");
      assert.equal(mixed.resolution, "ambiguous");
      assert.equal(mixed.libraries[0].symbol, "Map.prototype.delete");
      assert.ok(
        mixed.candidates.some(
          ({ id }) => id === graph.symbol("browser.ts", "Local.delete").id,
        ),
      );
      assert.equal(libraryTarget(calls("parse")[0]).symbol, "JSON.parse");
      assert.equal(libraryTarget(calls("all")[0]).symbol, "Promise.all");
      assert.equal(
        libraryTarget(calls("map")[0]).symbol,
        "Array.prototype.map",
      );
      assert.equal(libraryTarget(calls("querySelector")[0]).unit, "dom");
      assert.equal(
        libraryTarget(calls("querySelector")[0]).symbol,
        "ParentNode.prototype.querySelector",
      );
      const fetch = calls("fetch")[0];
      assert.equal(fetch.resolution, "ambiguous");
      assert.deepEqual(
        fetch.libraries.map(({ unit, symbol }) => [unit, symbol]).sort(),
        [
          ["dom", "fetch"],
          ["globals", "fetch"],
        ],
      );
      const log = graph.link("script.js", "log", "calls");
      assert.equal(log.resolution, "ambiguous");
      assert.deepEqual(
        log.libraries.map(({ unit, symbol }) => [unit, symbol]).sort(),
        [
          ["console", "Console.prototype.log"],
          ["dom", "Console.prototype.log"],
        ],
      );
      assert.equal(
        graph.link("script.js", "cwd", "calls").resolution,
        "unresolved",
      );
      assert.equal(
        graph.link("es-only/browser.js", "querySelector", "calls").resolution,
        "unresolved",
      );
    },
  );
});

test("missing packages prove imports and namespace exports at their lexical bindings", async () => {
  await project(
    {
      "package.json": JSON.stringify({
        dependencies: {
          zod: "4.4.1",
          "@scope/pkg": "^2.0.0",
          "missing-pkg": "^1",
          "react-router-dom": "^7",
        },
      }),
      "main.ts": `import { z } from 'zod';
        import fs from 'node:fs';
        import * as path from 'path';
        import * as sub from '@scope/pkg/client';
        import type { compile } from 'missing-pkg';
        import { renamed } from './barrel';
        import { getZ } from './nested/bridge';
        type Compile = typeof compile;
        z.string();
        fs.readFileSync('x');
        path['join']('a', 'b');
        sub.make();
        const pathAlias = path;
        pathAlias.resolve('a');
        renamed();
        getZ();
        compile();
        function shadow(path: any) { path.join('a'); }`,
      "barrel.ts": `export { make as renamed } from '@scope/pkg/client';`,
      "nested/package.json": '{"dependencies":{"zod":"3.26.0"}}',
      "nested/bridge.ts": `export { z as getZ } from 'zod';`,
      "jsx.tsx": `import ReactRouterDom = require('react-router-dom');
        import Link = ReactRouterDom.Link;
        import Nested = ReactRouterDom.Link.Nested;
        export const view = <ReactRouterDom.Link />;`,
      "ambient.d.ts": `import type * as http from 'node:http';
        export class IncomingMessage extends http.IncomingMessage {}`,
      "non-ambient.ts": `import type * as http from 'node:http';
        export class IncomingMessage extends http.IncomingMessage {}`,
      "common.cjs": `const fs = require('fs');
        const { join: combine } = require('node:path');
        fs.readFileSync('x');
        combine('x', 'y');
        require('node:fs').existsSync('x');
        let mutable = require('path');
        mutable = {};
        mutable.basename('x');`,
    },
    async (graph, report) => {
      clean(report);
      const call = (at) => graph.link("main.ts", at, "calls");
      assert.deepEqual(libraryTarget(graph.link("main.ts", "z", "imports")), {
        ecosystem: "npm",
        unit: "zod",
        symbol: "z",
        evidence: "import-binding",
        version: "4.4.1",
        versionSource: "package.json",
      });
      assert.deepEqual(libraryTarget(call("string")), {
        ecosystem: "npm",
        unit: "zod",
        evidence: "import-path",
        version: "4.4.1",
        versionSource: "package.json",
      });
      assert.deepEqual(libraryTarget(call("readFileSync")), {
        ecosystem: "node",
        unit: "fs",
        symbol: "readFileSync",
        evidence: "import-binding",
      });
      assert.equal(libraryTarget(call("path['join']")).symbol, "join");
      assert.equal(libraryTarget(call("resolve")).symbol, "resolve");
      assert.deepEqual(libraryTarget(call("make")), {
        ecosystem: "npm",
        unit: "@scope/pkg",
        symbol: "client:make",
        evidence: "import-binding",
      });
      assert.equal(libraryTarget(call("renamed")).symbol, "client:make");
      assert.deepEqual(libraryTarget(call("getZ")), {
        ecosystem: "npm",
        unit: "zod",
        symbol: "z",
        evidence: "import-binding",
        version: "3.26.0",
        versionSource: "nested/package.json",
      });
      assert.equal(call("compile").resolution, "unresolved");
      assert.equal(
        libraryTarget(graph.link("main.ts", "compile", "references")).symbol,
        "compile",
      );
      assert.equal(
        libraryTarget(graph.link("jsx.tsx", "Link", "calls")).symbol,
        "Link",
      );
      assert.deepEqual(
        libraryTarget(
          graph.link("jsx.tsx", "ReactRouterDom.Link", "references"),
        ),
        {
          ecosystem: "npm",
          unit: "react-router-dom",
          symbol: "Link",
          evidence: "import-binding",
        },
      );
      assert.equal(
        graph.link("jsx.tsx", "ReactRouterDom.Link.Nested", "references")
          .libraries?.[0]?.symbol,
        undefined,
      );
      assert.deepEqual(
        libraryTarget(
          graph.link("ambient.d.ts", "http.IncomingMessage", "extends"),
        ),
        {
          ecosystem: "node",
          unit: "http",
          symbol: "IncomingMessage",
          evidence: "import-binding",
        },
      );
      assert.equal(
        graph.link("non-ambient.ts", "http.IncomingMessage", "extends")
          .resolution,
        "unresolved",
      );
      assert.equal(call("join").resolution, "unresolved");
      const common = (at) => graph.link("common.cjs", at, "calls");
      assert.equal(
        libraryTarget(common("readFileSync")).symbol,
        "readFileSync",
      );
      assert.equal(libraryTarget(common("combine")).symbol, "join");
      assert.equal(libraryTarget(common("existsSync")).symbol, "existsSync");
      assert.equal(common("basename").resolution, "unresolved");
    },
  );
});

test("bare packages need positive route evidence and builtin polyfills keep both routes", async () => {
  await project(
    {
      "package.json": '{"dependencies":{"url":"^0.11.4","zod":"^4"}}',
      "pkg/package.json": '{"name":"fixture"}',
      "pkg/tsconfig.json": '{"compilerOptions":{"baseUrl":"src"}}',
      "pkg/src/use.ts": `import * as polyfill from 'url';
        import * as builtin from 'node:url';
        import * as path from 'path';
        import { z } from 'zod';
        import { initialData } from '@site/src/initialData';
        import * as theme from '@theme-original/MDXComponents';
        import { Modal } from 'components/Modal';
        import 'uno.css';
        polyfill.parse('x'); builtin.format('x');
        path.join('x'); z(); initialData(); theme.load(); Modal();`,
      "nested/package.json": '{"workspaces":["pkg"]}',
      "nested/pkg/package.json": '{"name":"nested-pkg"}',
      "nested/pkg/use.ts": `import { z } from 'zod'; z();`,
    },
    async (graph, report) => {
      clean(report);
      const roots = (link) =>
        link.libraries
          .map(({ ecosystem, unit, symbol }) => [ecosystem, unit, symbol])
          .sort();
      const file = "pkg/src/use.ts";
      for (const [kind, text, symbol] of [
        ["imports", "'url'", undefined],
        ["calls", "parse", "parse"],
      ]) {
        const link = graph.link(file, text, kind);
        assert.equal(link.resolution, "ambiguous");
        assert.deepEqual(roots(link), [
          ["node", "url", symbol],
          ["npm", "url", symbol],
        ]);
      }
      assert.equal(
        libraryTarget(graph.link(file, "format", "calls")).ecosystem,
        "node",
      );
      assert.equal(
        libraryTarget(graph.link(file, "join", "calls")).unit,
        "path",
      );
      assert.equal(libraryTarget(graph.link(file, "z", "calls")).unit, "zod");
      for (const specifier of [
        "@site/src/initialData",
        "@theme-original/MDXComponents",
        "components/Modal",
        "uno.css",
      ])
        assert.equal(
          graph.link(file, "'" + specifier + "'", "imports").resolution,
          "unresolved",
        );
      assert.equal(
        graph.link("nested/pkg/use.ts", "z", "calls").resolution,
        "unresolved",
      );
    },
  );
});

test("an expected missing global type package keeps overlapping runtime declarations open", async () => {
  const source = `console.log('x'); setTimeout(() => {}, 1);
    const urlValue = new URL('https://example.test'); urlValue.toString();
    const init: RequestInit = {}; new Response().json(); fetch('https://example.test', init);
    const stream = new ReadableStream(); stream.getReader();
    const channel = new MessageChannel(); channel.port2.postMessage('x');
    navigator.vibrate(500); performance.now(); new TextEncoder().encode('x');
    declare const canvas: HTMLCanvasElement;
    declare const context: CanvasRenderingContext2D;
    context.drawImage(canvas, 0, 0);
    const values = [1]; values.map(String); Promise.resolve(); JSON.parse('{}');`;
  await project(
    {
      "manifest/package.json": '{"devDependencies":{"@types/node":"^24"}}',
      "manifest/use.ts": source,
      "options/tsconfig.json":
        '{"compilerOptions":{"target":"es2022","types":["node","vitest/globals"]},"files":["use.ts"]}',
      "options/use.ts": source,
      "reference/tsconfig.json":
        '{"compilerOptions":{"target":"es2022","types":[]},"files":["use.ts"]}',
      "reference/use.ts": '/// <reference types="node" />\n' + source,
      "other/package.json": '{"devDependencies":{"@types/node":"^24"}}',
      "other/tsconfig.json":
        '{"compilerOptions":{"target":"es2022","types":["vite/client","vitest/globals","jest","react"]},"files":["use.ts"]}',
      "other/use.ts": source,
      "other-browser/tsconfig.json":
        '{"compilerOptions":{"target":"es2022","types":["vite/client","vitest/globals","jest","react"]},"files":["use.ts"]}',
      "other-browser/use.ts": source,
      "browser/package.json": '{"devDependencies":{"@types/node":"^24"}}',
      "browser/tsconfig.base.json":
        '{"compilerOptions":{"target":"es2022","types":[]}}',
      "browser/tsconfig.json":
        '{"extends":"./tsconfig.base.json","files":["use.ts"]}',
      "browser/use.ts": source,
      "web/tsconfig.json":
        '{"compilerOptions":{"target":"es2022"},"files":["use.ts"]}',
      "web/use.ts": source,
      "workers/tsconfig.json":
        '{"compilerOptions":{"target":"es2022","types":["@cloudflare/workers-types"]},"files":["use.ts"]}',
      "workers/use.ts": source,
    },
    async (graph, report) => {
      clean(report);
      for (const root of ["manifest", "options", "reference", "other"]) {
        const file = root + "/use.ts";
        for (const [name, node] of [
          ["log", "console"],
          ["setTimeout", "timers"],
          ["URL", "url"],
          ["fetch", "globals"],
          ["toString", "url"],
          ["now", "perf_hooks"],
          ["encode", "util"],
          ["postMessage", "worker_threads"],
        ]) {
          const call = graph.link(file, name, "calls");
          assert.equal(call.resolution, "ambiguous");
          assert.deepEqual(
            call.libraries.map(({ unit }) => unit).sort(),
            ["dom", node].sort(),
          );
        }
        for (const [text, kind, dom, node] of [
          ["RequestInit", "references", "RequestInit", "RequestInit"],
          ["json", "calls", "Body.prototype.json", "Response.prototype.json"],
          [
            "getReader",
            "calls",
            "ReadableStream.prototype.getReader",
            "ReadableStream.prototype.getReader",
          ],
        ]) {
          const link = graph.link(file, text, kind);
          assert.equal(link.resolution, "ambiguous");
          assert.deepEqual(
            link.libraries
              .map(({ ecosystem, symbol }) => [ecosystem, symbol])
              .sort(),
            [
              ["dom", dom],
              ["node", node],
            ],
          );
          if (text === "getReader")
            assert.equal(
              link.libraries.find(({ ecosystem }) => ecosystem === "node").unit,
              "stream/web",
            );
        }
        const member = graph.link(file, "vibrate", "calls");
        assert.equal(member.resolution, "unresolved");
        assert.equal(member.data.reason, "missing-global-types");
        for (const name of ["map", "resolve", "parse"])
          assert.equal(
            libraryTarget(graph.link(file, name, "calls")).unit,
            "es",
          );
      }
      for (const root of ["other-browser", "browser", "web"])
        for (const name of [
          "log",
          "setTimeout",
          "json",
          "getReader",
          "drawImage",
        ])
          assert.equal(
            libraryTarget(graph.link(root + "/use.ts", name, "calls")).unit,
            "dom",
          );
      assert.equal(
        graph.link("workers/use.ts", "json", "calls").data.reason,
        "missing-global-types",
      );
      assert.equal(
        libraryTarget(graph.link("workers/use.ts", "drawImage", "calls")).unit,
        "dom",
      );
    },
  );
});

test("Node runtime evidence in a JavaScript file keeps shared globals open", async () => {
  const shared = "console.log('start'); setTimeout(() => {}, 10);\n";
  await project(
    {
      "package.json": '{"dependencies":{"lit":"^3.0.0"}}',
      "scripts/release.js":
        shared +
        "const fs = require('fs'); console.info(fs.readFileSync('x', 'utf8'));",
      "scripts/check.mjs":
        shared +
        "import { execSync } from 'node:child_process'; execSync('git status');",
      "scripts/hashbang.js": "#!/usr/bin/env node\n" + shared,
      "scripts/working-directory.js": shared + "process.cwd();",
      "scripts/directory.js": shared + "const current = __dirname;",
      "scripts/colors.cjs": shared + "require('picocolors');",
      "scripts/computed.cjs": shared + "require(packageName);",
      "commonjs/package.json": '{"type":"commonjs"}',
      "commonjs/colors.js": shared + "require('picocolors');",
      "commonjs/shadowed/tsconfig.json":
        '{"compilerOptions":{"allowJs":true},"files":["script.cjs"]}',
      "commonjs/shadowed/script.cjs":
        shared + "function use(require) { require('picocolors'); }",
      "commonjs/esm/package.json": '{"type":"module"}',
      "commonjs/esm/tsconfig.json":
        '{"compilerOptions":{"module":"esnext","moduleResolution":"bundler","allowJs":true},"files":["colors.js"]}',
      "commonjs/esm/colors.js": shared + "require('picocolors'); export {};",
      "browser/tsconfig.json":
        '{"compilerOptions":{"allowJs":true},"files":["script.js"]}',
      "browser/script.js":
        shared + "export {}; const process = {cwd() {}}; process.cwd();",
      "polyfill/package.json": '{"dependencies":{"path":"^0.12.0"}}',
      "polyfill/tsconfig.json":
        '{"compilerOptions":{"allowJs":true},"files":["browser.js"]}',
      "polyfill/browser.js":
        shared + "import * as path from 'path'; path.join('a', 'b');",
    },
    async (graph, report) => {
      clean(report);
      for (const path of [
        "scripts/release.js",
        "scripts/check.mjs",
        "scripts/hashbang.js",
        "scripts/working-directory.js",
        "scripts/directory.js",
        "scripts/colors.cjs",
        "scripts/computed.cjs",
        "commonjs/colors.js",
      ])
        for (const [name, unit] of [
          ["log", "console"],
          ["setTimeout", "timers"],
        ]) {
          const link = graph.link(path, name, "calls");
          assert.equal(link.resolution, "ambiguous", path + " " + name);
          assert.deepEqual(
            link.libraries.map(({ unit }) => unit).sort(),
            ["dom", unit].sort(),
          );
        }
      assert.equal(
        libraryTarget(graph.link("scripts/release.js", "readFileSync", "calls"))
          .symbol,
        "readFileSync",
      );
      for (const path of [
        "browser/script.js",
        "polyfill/browser.js",
        "commonjs/shadowed/script.cjs",
        "commonjs/esm/colors.js",
      ])
        assert.equal(
          libraryTarget(graph.link(path, "log", "calls")).unit,
          "dom",
        );
    },
  );
});

test("require in a JavaScript package without a type field supplies Node evidence", async () => {
  const shared = "console.log('start'); setTimeout(() => {}, 10);";
  await project(
    {
      "package.json": "{}",
      "direct/tsconfig.json": '{"files":["entry.js"]}',
      "direct/entry.js": "require('./dep.cjs'); " + shared,
      "direct/dep.cjs": "module.exports = {};",
      "parenthesised/tsconfig.json": '{"files":["entry.js"]}',
      "parenthesised/entry.js": "(require)('./dep.cjs'); " + shared,
      "parenthesised/dep.cjs": "module.exports = {};",
    },
    async (graph, report) => {
      clean(report);
      for (const file of ["direct/entry.js", "parenthesised/entry.js"])
        for (const name of ["log", "setTimeout"]) {
          const link = graph.link(file, name, "calls");
          assert.equal(link.resolution, "ambiguous");
          assert.deepEqual(
            link.libraries.map(({ ecosystem }) => ecosystem).sort(),
            ["dom", "node"],
          );
        }
    },
  );
});

test("Node evidence from sibling files and missing package types applies to the compiler program", async () => {
  const shared = "new URL('https://example.test'); structuredClone({});";
  const isolated =
    '{"compilerOptions":{"types":[]},"files":["browser.ts","entry.ts"]}';
  const importVite = "import { build } from 'vite'; export { build };";
  await project(
    {
      "missing/package.json":
        '{"devDependencies":{"@types/node":"^24","vite":"^8"}}',
      "missing/tsconfig.json": isolated,
      "missing/entry.ts": importVite,
      "missing/browser.ts": shared,
      "twin/tsconfig.json": isolated,
      "twin/entry.ts": importVite,
      "twin/browser.ts": shared,
      "captured/package.json":
        '{"devDependencies":{"@types/node":"^24","vite":"^8"}}',
      "captured/tsconfig.json":
        '{"compilerOptions":{"types":[],"paths":{"vite":["./vite.d.ts"]}},"files":["browser.ts","entry.ts"]}',
      "captured/entry.ts": importVite,
      "captured/browser.ts": shared,
      "captured/vite.d.ts": "export declare function build(): void;",
      "referenced/tsconfig.json":
        '{"compilerOptions":{"types":[],"paths":{"vite":["./vite.d.ts"]}},"files":["browser.ts","entry.ts"]}',
      "referenced/entry.ts": importVite,
      "referenced/browser.ts": shared,
      "referenced/vite.d.ts":
        '/// <reference types="node" />\nexport declare function build(): void;',
      "runtime/tsconfig.json": isolated,
      "runtime/entry.ts":
        "import { readFileSync } from 'node:fs'; export { readFileSync };",
      "runtime/browser.ts": shared,
      "bun/tsconfig.json":
        '{"compilerOptions":{"allowJs":true},"files":["script.js"]}',
      "bun/script.js": "#!/usr/bin/env bun\n" + shared,
      "deno/tsconfig.json":
        '{"compilerOptions":{"allowJs":true},"files":["script.js"]}',
      "deno/script.js": "#!/usr/bin/env deno\n" + shared,
    },
    async (graph, report) => {
      clean(report);
      for (const root of ["missing", "referenced", "runtime"])
        for (const name of ["URL", "structuredClone"])
          assert.deepEqual(
            graph
              .link(root + "/browser.ts", name, "calls")
              .libraries.map(({ ecosystem }) => ecosystem)
              .sort(),
            ["dom", "node"],
          );
      for (const root of ["twin", "captured"])
        assert.equal(
          libraryTarget(graph.link(root + "/browser.ts", "URL", "calls")).unit,
          "dom",
        );
      for (const root of ["bun", "deno"])
        assert.equal(
          graph.link(root + "/script.js", "URL", "calls").data.reason,
          "missing-global-types",
        );
    },
  );
});

test("inherited Web API members keep Node candidates through checkout heritage", async () => {
  const source = `class AppResponse<T> extends Response {
    data() { return this.json(); }
  }
  class PageResponse extends AppResponse<string> {}
  interface TypedResponse extends Response {}
  declare const typed: TypedResponse;
  new PageResponse().json();
  typed.json();
  type Key = CryptoKey;
  export {};`;
  await project(
    {
      "node/tsconfig.json": '{"compilerOptions":{"types":["node"]}}',
      "node/response.ts": source,
      "web/tsconfig.json": '{"compilerOptions":{"types":[]}}',
      "web/response.ts": source,
    },
    async (graph, report) => {
      clean(report);
      const calls = graph.links("node/response.ts", "json", "calls");
      assert.equal(calls.length, 3);
      for (const link of calls) {
        assert.equal(link.resolution, "ambiguous");
        assert.deepEqual(
          link.libraries.map(({ unit, symbol }) => [unit, symbol]).sort(),
          [
            ["dom", "Body.prototype.json"],
            ["globals", "Response.prototype.json"],
          ],
        );
      }
      for (const link of graph.links("web/response.ts", "json", "calls"))
        assert.equal(libraryTarget(link).symbol, "Body.prototype.json");
      assert.equal(
        libraryTarget(graph.link("node/response.ts", "CryptoKey", "references"))
          .ecosystem,
        "dom",
      );
    },
  );
});

test("npm aliases and captured workspace catalogs prove the registry name and exact pin", async () => {
  await project(
    {
      "package.json": '{"packageManager":"pnpm@10.0.0"}',
      "pnpm-workspace.yaml": `packages:
  - 'packages/*'
catalog:
  'default-alias': 'npm:real-default@2.0.1'
catalogs:
  named:
    'scoped-alias': 'npm:@scope/real@3.1.0'
`,
      "packages/pretty-format/package.json": JSON.stringify({
        name: "@sample/pretty-format",
        dependencies: {
          "react-is-18": "npm:react-is@18.3.1",
          "range-alias": "npm:@scope/range@^4",
          "local-name-alias": "npm:@sample/local@3.0.0",
          "git-alias": "github:example/fixture",
          "tar-alias": "https://example.test/archive.tgz",
          "default-alias": "catalog:",
          "scoped-alias": "catalog:named",
          "absent-alias": "catalog:absent",
          "linked-alias": "portal:../local",
        },
      }),
      "packages/local/package.json":
        '{"name":"@sample/local","main":"index.ts"}',
      "packages/local/index.ts": "export function local() {}",
      "bun/package.json": JSON.stringify({
        packageManager: "bun@1.3.11",
        workspaces: {
          packages: ["apps/*"],
          catalog: { effect: "4.0.0-beta.59" },
        },
      }),
      "bun/apps/server/package.json":
        '{"name":"@sample/server","dependencies":{"effect":"catalog:"}}',
      "bun/apps/server/use.ts": "import { run } from 'effect'; run();",
      "packages/pretty-format/use.ts": `import * as ReactIs18 from 'react-is-18';
        import { run as nested } from 'range-alias/sub';
        import { local as installed } from 'local-name-alias';
        import { run as fromGit } from 'git-alias';
        import { run as fromTar } from 'tar-alias';
        import { run as fromDefault } from 'default-alias';
        import { run as fromNamed } from 'scoped-alias';
        import { run as fromAbsent } from 'absent-alias';
        import { local } from 'linked-alias';
        ReactIs18.isElement({}); nested(); fromGit(); fromTar(); installed();
        fromDefault(); fromNamed(); fromAbsent(); local();`,
    },
    async (graph, report) => {
      clean(report);
      const file = "packages/pretty-format/use.ts";
      const call = (name) => graph.link(file, name, "calls");
      assert.deepEqual(
        libraryTarget(graph.link(file, "'react-is-18'", "imports")),
        {
          ecosystem: "npm",
          unit: "react-is",
          evidence: "import-path",
          version: "18.3.1",
          versionSource: "packages/pretty-format/package.json",
        },
      );
      assert.equal(libraryTarget(call("isElement")).symbol, "isElement");
      assert.deepEqual(libraryTarget(call("nested")), {
        ecosystem: "npm",
        unit: "@scope/range",
        symbol: "sub:run",
        evidence: "import-binding",
      });
      assert.deepEqual(libraryTarget(call("installed")), {
        ecosystem: "npm",
        unit: "@sample/local",
        symbol: "local",
        evidence: "import-binding",
        version: "3.0.0",
        versionSource: "packages/pretty-format/package.json",
      });
      assert.deepEqual(
        libraryTarget(graph.link("bun/apps/server/use.ts", "run", "calls")),
        {
          ecosystem: "npm",
          unit: "effect",
          symbol: "run",
          evidence: "import-binding",
          version: "4.0.0-beta.59",
          versionSource: "bun/package.json",
        },
      );
      for (const [name, unit, version] of [
        ["fromDefault", "real-default", "2.0.1"],
        ["fromNamed", "@scope/real", "3.1.0"],
      ]) {
        assert.deepEqual(libraryTarget(call(name)), {
          ecosystem: "npm",
          unit,
          symbol: "run",
          evidence: "import-binding",
          version,
          versionSource: "pnpm-workspace.yaml",
        });
      }
      for (const name of ["fromGit", "fromTar", "fromAbsent"])
        assert.equal(call(name).resolution, "unresolved");
      assert.equal(
        graph.target(call("local")),
        "packages/local/index.ts#local",
      );
    },
  );
});

test("captured declarations prove an inherited package member and preserve project augmentations", async () => {
  await project(
    {
      "package.json":
        '{"dependencies":{"local-types":"file:packages/local-types","external-kit":"^4.0.0"}}',
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          typeRoots: ["./types"],
          types: ["node"],
          paths: {
            "external-kit": ["./vendor/kit/index.d.ts"],
            "our-types": ["./vendor/our/index.d.ts"],
            "app/*": ["./src/*"],
          },
        },
      }),
      "types/node/package.json": '{"name":"@types/node","types":"index.d.ts"}',
      "types/node/index.d.ts": `declare module 'node:fs' { export function readFileSync(path: string): string; }
      declare namespace NodeJS { interface Process { cwd(): string } }
      declare var process: NodeJS.Process;`,
      "vendor/kit/package.json": '{"name":"external-kit","types":"index.d.ts"}',
      "vendor/kit/index.d.ts": `declare class Directory { list(): string[] }
      export declare class Store extends Directory {}
      export declare function open(): Store;`,
      "vendor/kit/ambient.d.ts":
        'declare module "kit-ambient-alias" { export function extra(): void }',
      "vendor/our/package.json": '{"name":"our-types","types":"index.d.ts"}',
      "vendor/our/index.d.ts": "export declare function own(): void;",
      "packages/local-types/package.json":
        '{"name":"@types/local-types","types":"index.d.ts"}',
      "packages/local-types/index.d.ts":
        "export declare function localDeclaration(): void;",
      "src/entry.ts": "export function here() {}",
      "local.d.ts": `interface Window { __pymthegLocal(): void; }
      interface Console { log(local: number): void; }`,
      "main.ts": `import { readFileSync } from 'node:fs';
      import { open } from 'external-kit';
      import { extra } from 'kit-ambient-alias';
      import { own } from 'our-types';
      import { localDeclaration } from 'local-types';
      import { here } from 'app/entry';
      import { missing } from 'app/missing';
      process.cwd(); readFileSync('x'); open().list(); extra(); own(); here(); missing();
      window.__pymthegLocal(); console.log(4); localDeclaration();`,
    },
    async (graph, report) => {
      clean(report);
      const call = (at) => graph.link("main.ts", at, "calls");
      assert.equal(
        graph.target(call("cwd")),
        "types/node/index.d.ts#NodeJS.Process.cwd",
      );
      assert.match(
        graph.target(call("readFileSync")),
        /^types\/node\/index\.d\.ts#.*readFileSync$/,
      );
      assert.deepEqual(libraryTarget(call("open")), {
        ecosystem: "npm",
        unit: "external-kit",
        symbol: "open",
        evidence: "import-binding",
      });
      assert.equal(libraryTarget(call("extra")).unit, "external-kit");
      assert.equal(
        libraryTarget(graph.link("main.ts", "'kit-ambient-alias'", "imports"))
          .unit,
        "external-kit",
      );
      assert.deepEqual(libraryTarget(call("list")), {
        ecosystem: "npm",
        unit: "external-kit",
        symbol: "Directory.prototype.list",
        evidence: "declaring-owner",
      });
      assert.equal(graph.target(call("here")), "src/entry.ts#here");
      assert.equal(graph.target(call("own")), "vendor/our/index.d.ts#own");
      assert.equal(
        graph.target(call("localDeclaration")),
        "packages/local-types/index.d.ts#localDeclaration",
      );
      assert.equal(call("missing").resolution, "unresolved");
      assert.equal(
        graph.target(call("__pymthegLocal")),
        "local.d.ts#Window.__pymthegLocal",
      );
      assert.equal(call("log").resolution, "ambiguous");
      assert.equal(call("log").libraries[0].symbol, "Console.prototype.log");
    },
  );
});

test("test globals require program evidence and respect shadowing", async () => {
  // tRPC packages/react-query/test/useUtils.test.tsx uses this global call.
  const trpc = "test('client query sad path', async () => {});";
  await project(
    {
      "vitest/tsconfig.json":
        '{"compilerOptions":{"types":["vitest/globals"]}}',
      "vitest/main.ts":
        trpc +
        " const x: typeof vi = null!; vi.mock('pkg'); bench('demo', () => {});",
      "ambiguous/tsconfig.json":
        '{"compilerOptions":{"types":["vitest/globals","jest"]}}',
      "ambiguous/main.ts": "expect(1); test('example', () => {});",
      "shadow/tsconfig.json":
        '{"compilerOptions":{"types":["jest","vitest/globals"]}}',
      "shadow/package.json": '{"dependencies":{"other":"^1.0.0"}}',
      "shadow/main.ts": `import { check as expect } from 'other';
      declare global { function describe(label: string): void; }
      describe('mine'); expect(1);
      function scope() { const test = () => 1; return test(); }
      export {};`,
      "setup/tsconfig.json": '{"files":["main.ts","setup.ts"]}',
      "setup/package.json": '{"dependencies":{"vitest":"^4.0.0"}}',
      "setup/setup.ts": "import 'vitest/globals';",
      "setup/main.ts": trpc,
      "reference/tsconfig.json": '{"files":["main.ts","setup.ts"]}',
      "reference/main.ts": "suite('mocha', () => {}); expect(1);",
      "reference/setup.ts": '/// <reference types="mocha" />\nexport {};',
      "dependency/tsconfig.json": '{"files":["main.ts"]}',
      "dependency/package.json":
        '{"devDependencies":{"@types/jest":"^29","vitest":"^4"}}',
      "dependency/main.ts": trpc,
      "custom/tsconfig.json":
        '{"compilerOptions":{"types":["jest"],"typeRoots":["./own"]}}',
      "custom/main.ts": trpc,
      "redirected/tsconfig.json":
        '{"compilerOptions":{"types":["vitest/globals"]}}',
      "redirected/package.json":
        '{"devDependencies":{"vitest":"npm:other-test-kit@^1"}}',
      "redirected/main.ts": trpc,
      "deno/tsconfig.json": '{"compilerOptions":{"types":["vitest/globals"]}}',
      "deno/deno.json": '{"imports":{"vitest/globals":"npm:other-test-kit"}}',
      "deno/main.ts": trpc,
      "captured/tsconfig.json":
        '{"compilerOptions":{"types":["jest","mocha"],"typeRoots":["./types"]}}',
      "captured/package.json":
        '{"devDependencies":{"jest":"^29","mocha":"^11"}}',
      "captured/types/jest/package.json":
        '{"name":"jest","types":"index.d.ts"}',
      "captured/types/jest/index.d.ts":
        "declare var test: (name: string, body: () => void) => void;",
      "captured/types/mocha/package.json":
        '{"name":"mocha","types":"index.d.ts"}',
      "captured/types/mocha/index.d.ts":
        "export {}; declare global { var test: (name: string, body: () => void) => void }",
      "captured/main.ts": trpc,
    },
    async (graph, report) => {
      clean(report);
      for (const dir of ["vitest", "setup"])
        assert.deepEqual(
          libraryTarget(graph.link(dir + "/main.ts", "test", "calls")),
          {
            ecosystem: "npm",
            unit: "vitest",
            symbol: "test",
            evidence: "declared-builtin",
          },
        );
      assert.equal(
        libraryTarget(graph.link("vitest/main.ts", "vi", "references")).symbol,
        "vi",
      );
      assert.equal(
        graph.link("vitest/main.ts", "mock", "calls").resolution,
        "unresolved",
      );
      assert.equal(
        graph.link("vitest/main.ts", "bench", "calls").resolution,
        "unresolved",
      );
      for (const name of ["test", "expect"]) {
        const link = graph.link("ambiguous/main.ts", name, "calls");
        assert.equal(link.resolution, "ambiguous");
        assert.deepEqual(
          link.libraries.map(({ unit, symbol }) => [unit, symbol]).sort(),
          [
            ["jest", name],
            ["vitest", name],
          ],
        );
      }
      const captured = graph.link("captured/main.ts", "test", "calls");
      assert.equal(captured.resolution, "ambiguous");
      assert.deepEqual(captured.libraries.map(({ unit }) => unit).sort(), [
        "jest",
        "mocha",
      ]);
      assert.equal(
        libraryTarget(graph.link("shadow/main.ts", "expect", "calls")).unit,
        "other",
      );
      for (const name of ["describe", "test"])
        assert.equal(
          graph.link("shadow/main.ts", name, "calls").resolution,
          "resolved",
        );
      assert.equal(
        libraryTarget(graph.link("reference/main.ts", "suite", "calls")).unit,
        "mocha",
      );
      for (const [dir, name] of [
        ["dependency", "test"],
        ["reference", "expect"],
        ["custom", "test"],
        ["redirected", "test"],
        ["deno", "test"],
      ])
        assert.equal(
          graph.link(dir + "/main.ts", name, "calls").resolution,
          "unresolved",
        );
    },
  );
});

test("competing ambient test requests withhold only their declared names", async () => {
  const config = (...types) => JSON.stringify({ compilerOptions: { types } });
  const testCode =
    "expect(true).to.be.true; describe('suite', () => {}); it('case', () => {});";
  await project(
    {
      "cypress/tsconfig.json": config("cypress", "jest"),
      "cypress/main.ts": testCode + " beforeAll(() => {}); cy();",
      "mixed/tsconfig.json": config("cypress", "jest", "vitest/globals"),
      "mixed/main.ts": testCode + " const mock: typeof vi = null!;",
      "cypress-only/tsconfig.json": config("cypress"),
      "cypress-only/main.ts": testCode,
      "jasmine/tsconfig.json": config("jasmine", "jest"),
      "jasmine/main.ts": testCode + " test('other', () => {});",
      "reference/tsconfig.json": config("jest"),
      "reference/main.ts":
        '/// <reference types="@types/jasmine" />\n' + testCode,
      "setup/tsconfig.json": config("jest"),
      "setup/package.json": '{"devDependencies":{"cypress":"^16"}}',
      "setup/setup.ts": "import 'cypress';",
      "setup/main.ts": testCode,
      "assertions/tsconfig.json": config("@types/chai", "vitest/globals"),
      "assertions/main.ts":
        "assert(true); expect(true); test('case', () => {});",
      "wdio/tsconfig.json": config(
        "@wdio/globals/types",
        "@types/qunit",
        "jest",
      ),
      "wdio/main.ts":
        "expect(true); test('case', () => {}); it('other', () => {});",
      "jest-dom/tsconfig.json": config(
        "@testing-library/jest-dom",
        "vitest/globals",
      ),
      "jest-dom/main.ts": "expect(true);",
      "imports-only/tsconfig.json": config(
        "@playwright/test",
        "ava",
        "bun-types",
        "@types/bun",
        "node",
        "jest",
      ),
      "imports-only/main.ts": "expect(true);",
      "shadow/tsconfig.json": config("cypress", "jest"),
      "shadow/package.json": '{"dependencies":{"other":"^1"}}',
      "shadow/main.ts": `import { check as expect } from 'other';
        declare global { function describe(label: string): void; }
        expect(true); describe('mine');
        function scope() { const test = () => 1; return test(); }`,
    },
    async (graph, report) => {
      clean(report);
      const call = (dir, name) => graph.link(dir + "/main.ts", name, "calls");
      const blocked = (dir, name, ...requests) => {
        const link = call(dir, name);
        assert.equal(link.resolution, "unresolved");
        assert.equal(link.libraries, undefined);
        assert.equal(link.data.reason, "competing-test-globals");
        assert.deepEqual(link.data.competingTypes, requests);
      };
      for (const name of ["expect", "describe", "it"]) {
        blocked("cypress", name, "cypress");
        blocked("mixed", name, "cypress");
        blocked("jasmine", name, "jasmine");
        blocked("reference", name, "@types/jasmine");
        blocked("setup", name, "cypress");
        assert.equal(call("cypress-only", name).data.reason, "no-symbol");
      }
      blocked("assertions", "assert", "@types/chai");
      blocked("assertions", "expect", "@types/chai");
      blocked("wdio", "expect", "@types/qunit", "@wdio/globals/types");
      blocked("wdio", "test", "@types/qunit");
      blocked("jest-dom", "expect", "@testing-library/jest-dom");
      assert.equal(libraryTarget(call("cypress", "beforeAll")).unit, "jest");
      assert.equal(call("cypress", "cy").data.reason, "no-symbol");
      assert.equal(
        libraryTarget(graph.link("mixed/main.ts", "vi", "references")).symbol,
        "vi",
      );
      assert.equal(libraryTarget(call("jasmine", "test")).unit, "jest");
      assert.equal(libraryTarget(call("assertions", "test")).unit, "vitest");
      assert.equal(libraryTarget(call("wdio", "it")).unit, "jest");
      assert.equal(libraryTarget(call("imports-only", "expect")).unit, "jest");
      assert.equal(libraryTarget(call("shadow", "expect")).unit, "other");
      assert.equal(call("shadow", "describe").resolution, "resolved");
      assert.equal(call("shadow", "test").resolution, "resolved");
    },
  );
});

test("immutable member aliases preserve the checker owner and overlapping global candidates", async () => {
  await project(
    {
      "tsconfig.json": '{"files":["node.ts","member.ts"]}',
      "node.ts": "import 'node:fs';",
      "node-only/tsconfig.json":
        '{"compilerOptions":{"lib":["es2022"],"types":["node"]}}',
      "node-only/main.ts":
        "new URL('https://example.test'); fetch('https://example.test');",
      "no-node/tsconfig.json":
        '{"compilerOptions":{"lib":["es2022"],"types":[]}}',
      "no-node/main.ts": "new URL('https://example.test');",
      "mixed-runtime/tsconfig.json":
        '{"compilerOptions":{"lib":["es2022"],"types":["node","bun"]}}',
      "mixed-runtime/main.ts": "btoa('abc');",
      "member.ts": `declare const receiver: any;
      function makeError(): object { return { toString() { return 'custom'; } }; }
      function example() {
      const log = console.log;
      const maximum = (Math.max);
      const key = 'min';
      const written = JSON.parse;
      JSON.parse = () => null;
      const unsafe = receiver.parse;
      const error = makeError();
      const stringify = error.toString;
      const renderKey = 'toString';
      log('ready'); maximum(1, 2); Math[key](1, 2); written('{}'); unsafe('{}');
      stringify(); error[renderKey]();
      }`,
    },
    async (graph, report) => {
      clean(report);
      const call = (name) => graph.link("member.ts", name, "calls");
      assert.deepEqual(libraryTarget(call("maximum")), {
        ecosystem: "typescript-lib",
        unit: "es",
        symbol: "Math.max",
        evidence: "declaring-owner",
      });
      assert.equal(call("log").resolution, "ambiguous");
      assert.equal(libraryTarget(call("Math[key]")).symbol, "Math.min");
      assert.deepEqual(
        libraryTarget(graph.link("node-only/main.ts", "URL", "calls")),
        {
          ecosystem: "node",
          unit: "url",
          symbol: "URL",
          evidence: "declared-builtin",
        },
      );
      assert.equal(
        libraryTarget(graph.link("node-only/main.ts", "fetch", "calls")).unit,
        "globals",
      );
      assert.equal(
        graph.link("no-node/main.ts", "URL", "calls").resolution,
        "unresolved",
      );
      assert.equal(
        graph.link("mixed-runtime/main.ts", "btoa", "calls").resolution,
        "unresolved",
      );
      assert.deepEqual(
        call("log")
          .libraries.map(({ ecosystem, unit }) => [ecosystem, unit])
          .sort(),
        [
          ["dom", "dom"],
          ["node", "console"],
        ],
      );
      for (const name of ["written", "unsafe", "stringify", "error[renderKey]"])
        assert.equal(call(name).resolution, "unresolved");
    },
  );
});

test("package members use their declarations through returns and re-exports", async () => {
  await project(
    {
      "package.json":
        '{"dependencies":{"browser-kit":"^2","uncaptured-kit":"^1"}}',
      "tsconfig.json":
        '{"compilerOptions":{"paths":{"browser-kit":["./vendor/kit/index.d.ts"]}}}',
      "vendor/kit/package.json": '{"name":"browser-kit","types":"index.d.ts"}',
      "vendor/kit/index.d.ts": `export interface Page { locator(selector: string): Locator }
      export type Locator = { click(): void };
      export interface A { run(): void; one(): void }
      export interface B { run(): void; two(): void }
      export declare function page(): Page;`,
      "barrel.ts": `export { page as open } from 'browser-kit';
      export type { A, B } from 'browser-kit';
      export type { Page as UnknownPage } from 'uncaptured-kit';`,
      "main.ts": `import { open, type A, type B, type UnknownPage } from './barrel';
      open().locator('input[name="lastName"]').click();
      declare const union: A | B;
      declare const both: A & B;
      declare const page: UnknownPage;
      declare function fetchPage(): UnknownPage;
      declare const unknown: any;
      union.run(); both.run(); both.one(); page.locator('input');
      fetchPage().locator('input'); unknown.locator('input');`,
    },
    async (graph, report) => {
      clean(report);
      const call = (name) =>
        graph.store
          .links()
          .find(
            (link) =>
              link.file === "main.ts" &&
              link.kind === "calls" &&
              link.targetName === name,
          );
      assert.deepEqual(libraryTarget(call("(expression).click")), {
        ecosystem: "npm",
        unit: "browser-kit",
        symbol: "Locator.click",
        evidence: "declaring-owner",
      });
      assert.equal(libraryTarget(call("both.one")).symbol, "A.prototype.one");
      for (const name of ["union.run", "both.run"]) {
        const match = call(name);
        assert.equal(match.resolution, "ambiguous");
        assert.deepEqual(match.libraries.map(({ symbol }) => symbol).sort(), [
          "A.prototype.run",
          "B.prototype.run",
        ]);
      }
      for (const text of ["page.locator", "(expression).locator"])
        assert.deepEqual(libraryTarget(call(text)), {
          ecosystem: "npm",
          unit: "uncaptured-kit",
          evidence: "import-path",
        });
      assert.equal(call("unknown.locator").data.reason, "any-receiver");
    },
  );
});

test("Deno package aliases and scoped maps select the actual registry or checkout file", async () => {
  await project(
    {
      // Hono runtime-tests/deno/deno.json uses this registry mapping.
      "deno/tsconfig.json":
        '{"compilerOptions":{"module":"esnext","allowImportingTsExtensions":false}}',
      "deno/deno.jsonc": `{
        // Deno expands inline package-root aliases to package subpaths.
        "imports": {
          "@std/assert": "jsr:@std/assert@^1.0.3",
          "fs": "node:fs",
          "helper": "./helper.ts",
          "remote": "https://example.test/mod.ts"
        },
        "scopes": { "./legacy/": { "@std/assert": "npm:assert@^2.0.0" } }
      }`,
      "deno/helper.ts": "export function here() {}",
      "deno/main.ts": `import { assertEquals as equal } from '@std/assert';
        import { assertRejects } from '@std/assert/assert-rejects';
        import * as fs from 'fs';
        import { here } from 'helper';
        import { go } from 'remote';
        import { fail } from 'unmapped';
        equal(1, 1); assertRejects(() => Promise.reject()); fs.readFileSync('x');
        here(); go(); fail();`,
      "deno/legacy/main.ts": `import { equal } from '@std/assert'; equal(1, 1);`,
      "separate/deno.json": '{"importMap":"./maps/import-map.json"}',
      "separate/maps/import-map.json":
        '{"imports":{"package/":"npm:@scope/other@2.0.0/"}}',
      "separate/main.ts": `import { load } from 'package/client'; load();`,
      "variants/deno.precompile.json":
        '{"imports":{"@std/assert":"jsr:@std/assert@^1.0.3","only":"node:fs"}}',
      "variants/deno.react-jsx.json":
        '{"imports":{"@std/assert":"jsr:@std/assert@^1.0.3","only":"npm:fs"}}',
      "variants/main.ts": `import { assertEquals } from '@std/assert';
        import { readFileSync } from 'only';
        assertEquals(1, 1); readFileSync('x');`,
      "uncaptured/deno.json": '{"importMap":"../unavailable.json"}',
      "uncaptured/main.ts": `import { load } from 'package'; load();`,
    },
    async (graph, report) => {
      clean(report);
      const call = (name) => graph.link("deno/main.ts", name, "calls");
      assert.deepEqual(libraryTarget(call("equal")), {
        ecosystem: "jsr",
        unit: "@std/assert",
        symbol: "assertEquals",
        evidence: "import-binding",
      });
      assert.equal(
        libraryTarget(call("assertRejects")).symbol,
        "assert-rejects:assertRejects",
      );
      assert.equal(libraryTarget(call("readFileSync")).ecosystem, "node");
      assert.equal(graph.target(call("here")), "deno/helper.ts#here");
      assert.equal(call("go").resolution, "unresolved");
      assert.equal(call("fail").resolution, "unresolved");
      assert.deepEqual(
        libraryTarget(graph.link("deno/legacy/main.ts", "equal", "calls")),
        {
          ecosystem: "npm",
          unit: "assert",
          symbol: "equal",
          evidence: "import-binding",
        },
      );
      assert.deepEqual(
        libraryTarget(graph.link("separate/main.ts", "load", "calls")),
        {
          ecosystem: "npm",
          unit: "@scope/other",
          symbol: "client:load",
          evidence: "import-binding",
        },
      );
      assert.equal(
        libraryTarget(graph.link("variants/main.ts", "assertEquals", "calls"))
          .ecosystem,
        "jsr",
      );
      assert.equal(
        graph.link("variants/main.ts", "readFileSync", "calls").resolution,
        "unresolved",
      );
      assert.equal(
        graph.link("uncaptured/main.ts", "load", "calls").resolution,
        "unresolved",
      );
    },
  );
});

test("CommonJS destructuring proves the written export and leaves rest, nesting and defaults open", async () => {
  await project(
    {
      "use.cjs": `const { 'readFileSync': read } = require('node:fs');
        const { ...rest } = require('node:path');
        const { posix: { basename: nested } } = require('node:path');
        const { 'writeFileSync': write = () => 1 } = require('node:fs');
        read('x'); rest.join('a', 'b'); nested('x'); write('x');`,
    },
    async (graph, report) => {
      clean(report);
      const at = (text, kind) => graph.link("use.cjs", text, kind);
      for (const [text, kind] of [
        ["'readFileSync': read", "imports"],
        ["read", "calls"],
      ])
        assert.equal(libraryTarget(at(text, kind)).symbol, "readFileSync");
      for (const [text, kind] of [
        ["...rest", "imports"],
        ["join", "calls"],
        ["nested", "calls"],
      ])
        assert.deepEqual(libraryTarget(at(text, kind)), {
          ecosystem: "node",
          unit: "path",
          evidence: "import-path",
        });
      assert.equal(
        libraryTarget(at("'writeFileSync': write = () => 1", "imports")).symbol,
        undefined,
      );
      assert.equal(at("write", "calls").resolution, "unresolved");
    },
  );
});

test("writes to a module binding withhold only the affected member names", async () => {
  await project(
    {
      "package.json": '{"dependencies":{"patched-fs":"^1"}}',
      "use.cjs": `const fs = require('node:fs');
        const alias = fs;
        alias.readFileSync('x'); fs.statSync('x'); fs.unlinkSync('x'); fs.existsSync('x');
        fs.writeFileSync('x');
        fs.readFileSync = () => 'fake';
        alias.writeFileSync = () => null;
        Object.assign(fs, { statSync: () => null });
        delete fs['unlinkSync'];
        function unrelated(fs) { fs.existsSync = () => false; }`,
      "typed.ts": `import * as fs from 'patched-fs';
        fs.statSync('x'); fs.statSync = () => null;
        fs.existsSync('x');`,
      "types/patched-fs/package.json":
        '{"name":"patched-fs","types":"index.d.ts"}',
      "types/patched-fs/index.d.ts": `declare module 'patched-fs' {
        export function statSync(path: string): unknown;
        export function existsSync(path: string): boolean;
      }`,
      "tsconfig.json":
        '{"compilerOptions":{"typeRoots":["./types"],"types":["patched-fs"]},"files":["typed.ts"]}',
      "jsconfig.json": '{"files":["use.cjs"]}',
    },
    async (graph, report) => {
      clean(report);
      const call = (file, name) => graph.link(file, name, "calls");
      for (const name of [
        "readFileSync",
        "statSync",
        "unlinkSync",
        "writeFileSync",
      ])
        assert.deepEqual(libraryTarget(call("use.cjs", name)), {
          ecosystem: "node",
          unit: "fs",
          evidence: "import-path",
        });
      assert.equal(
        libraryTarget(call("use.cjs", "existsSync")).symbol,
        "existsSync",
      );
      assert.deepEqual(libraryTarget(call("typed.ts", "statSync")), {
        ecosystem: "npm",
        unit: "patched-fs",
        evidence: "import-path",
      });
      assert.equal(
        libraryTarget(call("typed.ts", "existsSync")).symbol,
        "existsSync",
      );
    },
  );
});

test("written imports can be independent of source or compiler configuration gaps", async () => {
  await project(
    {
      "package.json": '{"dependencies":{"package":"^1"}}',
      "broken.ts": "export function broken( {",
      "use.ts": `import { join } from 'node:path';
        import { build as run } from 'package';
        import { broken } from './broken';
        join('a', 'b'); run(); broken(); Promise.resolve(1);`,
      "partial/tsconfig.json": '{"extends":"@missing/base"}',
      "partial/use.ts": `import { readFile } from 'node:fs/promises';
        import { parse } from 'package'; readFile('x'); parse();`,
    },
    async (graph, report) => {
      clean(report);
      const call = (file, name) => graph.link(file, name, "calls");
      assert.equal(libraryTarget(call("use.ts", "join")).symbol, "join");
      assert.equal(libraryTarget(call("use.ts", "run")).symbol, "build");
      assert.equal(call("use.ts", "broken").data.reason, "invalid-code");
      assert.equal(call("use.ts", "resolve").resolution, "unresolved");
      assert.equal(
        libraryTarget(call("partial/use.ts", "readFile")).symbol,
        "readFile",
      );
      assert.equal(
        call("partial/use.ts", "parse").data.reason,
        "incomplete-config",
      );
    },
  );
});

test("relative imports resolve to the module; a missing relative file stays unresolved", async () => {
  await project(
    {
      "a.ts": "export function f() {}\n",
      "b.ts":
        'import { f } from "./a";\nimport { g } from "./missing";\nf();\ng();\n',
    },
    async (graph, report) => {
      clean(report);
      assert.equal(graph.target(graph.link("b.ts", '"./a"')), "a.ts#a.ts");
      assert.equal(graph.target(graph.link("b.ts", "f", "imports")), "a.ts#f");
      const missing = graph.link("b.ts", '"./missing"');
      assert.equal(missing.resolution, "unresolved");
      assert.equal(missing.targetName, "./missing");
      assert.equal(missing.data.reason, "missing-module");
      assert.equal(graph.link("b.ts", "g", "calls").resolution, "unresolved");
    },
  );
});

test("barrel chains resolve to the original declaration, never to a same-named look-alike", async () => {
  await project(
    {
      "impl.ts": "export function tool() {}\n",
      "decoy.ts": "export function tool() {}\n",
      "level1.ts": 'export * from "./impl";\n',
      "level2.ts": 'export { tool as renamed } from "./level1";\n',
      "use.ts": 'import { renamed } from "./level2";\nrenamed();\n',
    },
    async (graph, report) => {
      clean(report);
      const call = graph.link("use.ts", "renamed", "calls");
      assert.equal(graph.target(call), "impl.ts#tool");
      assert.notEqual(graph.target(call), "decoy.ts#tool");
      assert.equal(
        graph.target(graph.link("level2.ts", "tool as renamed")),
        "impl.ts#tool",
      );
    },
  );
});

test("tsconfig paths aliases resolve or stay unresolved when their targets are missing", async () => {
  await project(
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@core/*": ["src/core/*"], "@nope/*": ["src/absent/*"] },
        },
      }),
      "src/core/log.ts": "export function log() {}\n",
      "src/app.ts":
        'import { log } from "@core/log";\nimport { other } from "@nope/log";\nlog();\nother();\n',
    },
    async (graph, report) => {
      clean(report);
      assert.equal(
        graph.target(graph.link("src/app.ts", "log", "calls")),
        "src/core/log.ts#log",
      );
      const unknown = graph.link("src/app.ts", '"@nope/log"');
      assert.equal(unknown.resolution, "unresolved");
      assert.equal(unknown.data.reason, "unresolved-alias");
    },
  );
});

test("default imports under another name resolve; a named import of a default-only export does not", async () => {
  await project(
    {
      "maker.ts": "export default class Maker {}\n",
      "a.ts": 'import Built from "./maker";\nnew Built();\n',
      "b.ts": 'import { Maker } from "./maker";\nnew Maker();\n',
      "anon.ts": "export default function () {}\n",
      "c.ts": 'import run from "./anon";\nrun();\n',
    },
    async (graph) => {
      assert.equal(
        graph.target(graph.link("a.ts", "Built", "calls")),
        "maker.ts#Maker",
      );
      assert.equal(
        graph.link("b.ts", "Maker", "calls").resolution,
        "unresolved",
      );
      assert.equal(
        graph.link("b.ts", "Maker", "imports").resolution,
        "unresolved",
      );
      assert.equal(
        graph.target(graph.link("c.ts", "run", "calls")),
        "anon.ts#default",
      );
    },
  );
});

test("namespace imports and export * as ns resolve member calls to the original declaration", async () => {
  await project(
    {
      "math.ts": "export function add() {}\n",
      "barrel.ts": 'export * as math from "./math";\n',
      "a.ts": 'import * as m from "./math";\nm.add();\nm.subtract();\n',
      "b.ts": 'import { math } from "./barrel";\nmath.add();\n',
    },
    async (graph) => {
      assert.equal(
        graph.target(graph.link("a.ts", "* as m")),
        "math.ts#math.ts",
      );
      assert.equal(
        graph.target(graph.link("a.ts", "add", "calls")),
        "math.ts#add",
      );
      // Not exported by the module: the checker has no declaration, so no guess.
      assert.equal(
        graph.link("a.ts", "subtract", "calls").resolution,
        "unresolved",
      );
      assert.equal(
        graph.target(graph.link("b.ts", "add", "calls")),
        "math.ts#add",
      );
    },
  );
});

test("calls follow the checker: locals shadow imports, unions give candidates, any stays unresolved", async () => {
  await project(
    {
      "lib.ts":
        "export function format() {}\nexport class A { go() {} }\nexport class B { go() {} }\nexport interface Port { go(): void }\n",
      "use.ts": [
        'import { format, A, B, Port } from "./lib";',
        "export function direct() { format(); }",
        "export function shadowed() { const format = () => 1; format(); }",
        "export function union(x: A | B) { x.go(); }",
        "export function single(x: A) { x.go(); }",
        "export function iface(x: Port) { x.go(); }",
        "export function untyped(x: any) { x.go(); }",
        "",
      ].join("\n"),
    },
    async (graph) => {
      const calls = graph.links("use.ts", "format", "calls");
      assert.equal(calls.length, 2);
      const [direct, shadowed] = calls.sort(
        (a, b) => a.range.start - b.range.start,
      );
      assert.equal(graph.target(direct), "lib.ts#format");
      assert.equal(shadowed.resolution, "unresolved");
      assert.equal(shadowed.data.reason, "local");
      const go = graph
        .links("use.ts", "go", "calls")
        .sort((a, b) => a.range.start - b.range.start);
      assert.equal(go.length, 4);
      assert.equal(go[0].resolution, "ambiguous");
      assert.deepEqual(graph.candidates(go[0]), ["lib.ts#A.go", "lib.ts#B.go"]);
      assert.equal(graph.target(go[1]), "lib.ts#A.go");
      assert.equal(graph.target(go[2]), "lib.ts#Port.go");
      assert.equal(go[3].resolution, "unresolved");
      assert.equal(go[3].targetName, "x.go");
    },
  );
});

test("checkout member chains use typed declarations and preserve open receivers", async () => {
  const source = [
    "class A { run() {} }",
    "class B { run() {} }",
    "class Holder { x = { y: new A() }; use() { this.x.y.run(); } }",
    "const chain = { b: { c() {} } };",
    'const one = { nested: { run: () => "one" as const } };',
    'const two = { nested: { run: () => "two" as const } };',
    "declare const choose: boolean;",
    "const either = choose ? one : two;",
    "function make() { return { nested: { run() {} } }; }",
    "async function later() { return new A(); }",
    "function save() {}",
    "const api = { load() {}, save, [7]() {} };",
    "function local() {",
    "  const write = () => {};",
    "  const ops = { write };",
    "  ops.write();",
    "}",
    "declare const maybe: { b: A } | undefined;",
    "declare const variant: { b: A | B };",
    "declare const openReceiver: A | Record<string, () => void>;",
    "declare const unchecked: any;",
    "declare const opaque: unknown;",
    "declare const dict: { [key: string]: () => void };",
    "declare const record: Record<string, () => void>;",
    "declare const fromLib: string | undefined;",
    "declare const key: string;",
    "declare const inferred: { run: () => void };",
    "type Run = typeof inferred.run;",
    "inferred.run();",
    "chain.b.c();",
    "either.nested.run();",
    "make().nested.run();",
    "async function then() { (await later()).run(); }",
    'maybe?.b["run"]();',
    'maybe?.["b"]["run"]();',
    "variant.b.run();",
    "openReceiver.run();",
    "unchecked.run();",
    "opaque.run();",
    "dict.missing();",
    'dict["literal"]();',
    "record.missing();",
    "api.load();",
    "api.save();",
    "api[7]();",
    "api[key]();",
    "fromLib?.trim();",
    'fromLib?.["trim"]();',
  ].join("\n");
  await project(
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, target: "es2022" },
      }),
      "use.ts": source,
    },
    async (graph, report) => {
      clean(report);
      const calls = graph.store.links().filter((link) => link.kind === "calls");
      const callOn = (line) => {
        const start = source.indexOf(line);
        const end = start + line.length;
        return calls
          .filter((link) => link.range.start >= start && link.range.end <= end)
          .sort((a, b) => b.range.end - a.range.end)[0];
      };
      for (const [line, identity] of [
        ["this.x.y.run();", "A.run"],
        ["chain.b.c();", "chain.[object].b.c"],
        ["make().nested.run();", "make.[return].[object].nested.run"],
        ["(await later()).run();", "A.run"],
        ['maybe?.b["run"]();', "A.run"],
        ['maybe?.["b"]["run"]();', "A.run"],
        ["api.load();", "api.load"],
        ["api.save();", "save"],
        ["api[7]();", "api.[7]"],
        ["ops.write();", "local.[local].ops.[object].write"],
      ])
        assert.equal(graph.target(callOn(line)), `use.ts#${identity}`, line);
      assert.deepEqual(graph.candidates(callOn("variant.b.run();")), [
        "use.ts#A.run",
        "use.ts#B.run",
      ]);
      assert.deepEqual(graph.candidates(callOn("either.nested.run();")), [
        "use.ts#one.[object].nested.run",
        "use.ts#two.[object].nested.run",
      ]);
      for (const line of ["fromLib?.trim();", 'fromLib?.["trim"]();'])
        assert.deepEqual(libraryTarget(callOn(line)), {
          ecosystem: "typescript-lib",
          unit: "es",
          symbol: "String.prototype.trim",
          evidence: "declaring-owner",
        });
      for (const [line, reason] of [
        ["openReceiver.run();", "index-signature"],
        ["unchecked.run();", "any-receiver"],
        ["opaque.run();", "unknown-receiver"],
        ["dict.missing();", "index-signature"],
        ['dict["literal"]();', "index-signature"],
        ["record.missing();", "index-signature"],
        ["api[key]();", "no-symbol"],
        ["inferred.run();", "local"],
      ]) {
        const call = callOn(line);
        assert.equal(call.resolution, "unresolved", line);
        assert.equal(call.data.reason, reason, line);
        assert.deepEqual(call.candidates, [], line);
      }
      assert.equal(
        graph.target(graph.link("use.ts", "inferred.run", "references")),
        "use.ts#inferred.[type].run",
      );
    },
  );
});

test("object-member calls account for every explicit producer and withhold opaque ones", async () => {
  const source = [
    "declare const flag: boolean, key: number;",
    "function createLogger(on: boolean) {",
    "  if (!on) return { log() {} };",
    "  return { log(m: string) { console.log(m); } };",
    "}",
    'createLogger(true).log("x");',
    "function make(flag) { if (flag) return { run() { return 1 } }; return { run() { return 2 } } }",
    "make(flag).run()",
    "function readMode(mode: number) {",
    "  switch (mode) {",
    '    case 0: return { read() { return "first"; } };',
    '    default: return { read() { return "second"; } };',
    "  }",
    "}",
    "readMode(key).read();",
    // Redux Toolkit's anySignal returns a no-op clear for the empty input
    // and a cleanup function otherwise (query/utils/signals.ts:25,37).
    "function anySignal(signals: AbortSignal[]) {",
    "  const controller = new AbortController();",
    "  const signal = controller.signal;",
    "  if (!signals.length) return { signal, clear: () => {} };",
    "  return { signal, clear: () => controller.abort() };",
    "}",
    "const composedSignal = anySignal([]);",
    "composedSignal?.clear();",
    "const choice = flag ? { take() { return 1; } } : { take() { return 2; } };",
    "choice.take();",
    "const nullable = flag ? { pick() { return 1; } } : null;",
    "const otherwise = nullable ?? { pick() { return 2; } };",
    "otherwise.pick();",
    "const viaOr = nullable || { pick() { return 3; } };",
    "viaOr.pick();",
    "function reassigned() {",
    "  let lr = { run() { return 1; } };",
    "  lr = { run() { return 2; } };",
    "  lr.run();",
    "}",
    "function mutateAlias() {",
    "  const holder = { inner: { next() { return 1; } } };",
    "  const alias = holder;",
    "  alias.inner = { next() { return 2; } };",
    "  holder.inner.next();",
    "}",
    "class Changing {",
    "  state = { update() { return 1; } };",
    "  set() { this.state = { update() { return 2; } }; }",
    "  call() { this.state.update(); }",
    "}",
    "function values(index: number) {",
    "  const first = { item() { return 1; } };",
    "  const second = { item() { return 2; } };",
    "  const list = [first, second];",
    "  list[index]!.item();",
    "  list[0]!.item();",
    "  const direct = [{ item() { return 1; } }, { item() { return 2; } }];",
    "  direct[index]!.item();",
    "}",
    "let legacy = { old() { return 1; } };",
    "legacy = { old() { return 2; } };",
    "legacy.old();",
    "const legacyFirst = { inspect() { return 1; } };",
    "const legacySecond = { inspect() { return 2; } };",
    "const legacyList = [legacyFirst, legacySecond];",
    "legacyList[key].inspect();",
    "const legacyChoice = flag ? legacyFirst : legacySecond;",
    "legacyChoice.inspect();",
  ].join("\n");
  await project(
    {
      "use.ts": source,
      "tsconfig.json": '{"compilerOptions":{"strict":true}}',
    },
    async (graph, report) => {
      clean(report);
      const calls = graph.store.links().filter((link) => link.kind === "calls");
      const symbols = new Map(
        graph.store.findSymbols().map((symbol) => [symbol.id, symbol]),
      );
      const callOn = (line) => {
        const start = source.indexOf(line);
        const end = start + line.length;
        return calls
          .filter((link) => link.range.start >= start && link.range.end <= end)
          .sort((a, b) => b.range.end - a.range.end)[0];
      };
      for (const [line, expected] of [
        [
          'createLogger(true).log("x");',
          ["log() {}", "log(m: string) { console.log(m); }"],
        ],
        ["make(flag).run()", ["run() { return 1 }", "run() { return 2 }"]],
        [
          "readMode(key).read();",
          ['read() { return "first"; }', 'read() { return "second"; }'],
        ],
        [
          "composedSignal?.clear();",
          ["clear: () => {}", "clear: () => controller.abort()"],
        ],
        ["choice.take();", ["take() { return 1; }", "take() { return 2; }"]],
        ["otherwise.pick();", ["pick() { return 1; }", "pick() { return 2; }"]],
        ["viaOr.pick();", ["pick() { return 1; }", "pick() { return 3; }"]],
      ]) {
        const call = callOn(line);
        assert.equal(call.resolution, "ambiguous", line);
        const declarations = call.candidates
          .map(({ id }) => symbols.get(id).range)
          .map(({ start, end }) => source.slice(start, end))
          .sort();
        assert.deepEqual(declarations, expected.sort(), line);
      }
      for (const [line, reason] of [
        ["lr.run();", "multiple-object-producers"],
        ["holder.inner.next();", "object-producer-unverified"],
        ["this.state.update();", "object-producer-unverified"],
        ["list[index]!.item();", "object-producer-unverified"],
        ["list[0]!.item();", "object-producer-unverified"],
      ]) {
        const call = callOn(line);
        assert.equal(call.resolution, "unresolved", line);
        assert.equal(call.data.reason, reason, line);
      }
      assert.equal(callOn("direct[index]!.item();").resolution, "unresolved");
      // Main already targets the initializer's existing symbol for this shape.
      assert.equal(graph.target(callOn("legacy.old();")), "use.ts#legacy.old");
      for (const line of [
        "legacyList[key].inspect();",
        "legacyChoice.inspect();",
      ])
        assert.equal(
          graph.target(callOn(line)),
          "use.ts#legacyFirst.inspect",
          line,
        );
    },
  );
});

test("factory fallthrough and bare returns contribute undefined", async () => {
  const source = `
    declare const flag: boolean;
    function maybe() { if (flag) return { run() { return 1; } }; }
    function fallback() { return { run() { return 2; } }; }
    function bare() { if (!flag) return; return { run() { return 3; } }; }
    async function asyncMaybe() { if (flag) return { run() { return 4; } }; }
    function always() { if (!flag) throw new Error(); return { run() { return 5; } }; }
    async function asyncFallback() { return { run() { return 6; } }; }
    function wrapped() { if (flag) return { next: maybe }; }
    (maybe() ?? fallback()).run();
    (bare() || fallback()).run();
    (wrapped()?.next() ?? fallback()).run();
    (flag ? (maybe() ?? fallback()) : always()).run();
    async function use() { ((await asyncMaybe()) ?? fallback()).run(); }
    async function promiseFirst() { (await (asyncMaybe() ?? asyncFallback()))?.run(); }
    (always() ?? fallback()).run();
  `;
  await project(
    {
      "use.ts": source,
      "tsconfig.json": '{"compilerOptions":{"strict":true}}',
    },
    async (graph, report) => {
      clean(report);
      const methods = (link) => {
        const ids = link.candidates.map(({ id }) => id);
        if (link.targetId) ids.push(link.targetId);
        return ids
          .map(
            (id) =>
              graph.store.findSymbols().find((symbol) => symbol.id === id)
                .range,
          )
          .map(({ start, end }) => source.slice(start, end))
          .sort();
      };
      for (const [callee, expected] of [
        ["(maybe() ?? fallback()).run", [1, 2]],
        ["(bare() || fallback()).run", [2, 3]],
        ["(wrapped()?.next() ?? fallback()).run", [1, 2]],
        ["(flag ? (maybe() ?? fallback()) : always()).run", [1, 2, 5]],
        ["((await asyncMaybe()) ?? fallback()).run", [2, 4]],
        ["(always() ?? fallback()).run", [5]],
        ["(await (asyncMaybe() ?? asyncFallback()))?.run", [4]],
      ]) {
        const end = source.indexOf(callee) + callee.length;
        const call = graph.store
          .links()
          .find((link) => link.kind === "calls" && link.range.end === end);
        assert.ok(call, callee);
        assert.equal(
          call.resolution,
          expected.length === 1 ? "resolved" : "ambiguous",
        );
        assert.deepEqual(
          methods(call),
          expected.map((n) => `run() { return ${n}; }`),
        );
      }
    },
  );
});

test("static object destructuring follows factory members and reachable defaults", async () => {
  // Redux Toolkit's ownRequestResult tests take gate from setup().
  const source = `
    import { serviceKey } from "./keys";
    declare const flag: boolean;
    declare function submit(value: unknown): void;
    declare const service: Function & { gate: unknown };
    Object.defineProperty(service, "name", { value: "service" });
    Object.defineProperty(service, serviceKey, { value: "service metadata" });
    function createDeferredQueue() { return { resolveOldest() {} }; }
    function setup() { const gate = createDeferredQueue(); return { gate }; }
    function nested() { return { layer: { item: createDeferredQueue() } }; }
    function maybeQueue() { return { gate: flag ? createDeferredQueue() : undefined }; }
    function maybeMissing() { return flag ? { gate: createDeferredQueue() } : {}; }
    function nullableQueue() { return { gate: flag ? createDeferredQueue() : null }; }
    function backup() { return { resolveOldest() { return 2; } }; }
    const other = { resolveOldest() {} };
    other.resolveOldest = () => {};
    const { gate } = setup();
    submit(gate);
    gate.resolveOldest();
    const { layer: { item: renamed } } = nested();
    renamed.resolveOldest();
    const { gate: defaulted = backup() } = maybeQueue();
    defaulted.resolveOldest();
    const { gate: missing = backup() } = maybeMissing();
    missing.resolveOldest();
    const { gate: nullable = backup() } = nullableQueue();
    nullable?.resolveOldest();
    let { gate: reassigned } = setup();
    reassigned = backup();
    reassigned.resolveOldest();
    function mutable() { return { changing: createDeferredQueue() }; }
    const holder = mutable();
    holder.changing = backup();
    const { changing } = holder;
    changing.resolveOldest();
    function reflectiveSetup() { return { reflected: createDeferredQueue() }; }
    const reflective = reflectiveSetup();
    Reflect.set({ reflected: createDeferredQueue() }, "reflected", backup(), reflective);
    const { reflected } = reflective;
    reflected.resolveOldest();
    const extended = {};
    Object.assign(extended, { added: backup() });
    const { added = createDeferredQueue() } = extended as { added?: ReturnType<typeof createDeferredQueue> };
    added.resolveOldest();
  `;
  await project(
    {
      "keys.ts": 'export const serviceKey = "metadata";',
      "use.ts": source,
      "tsconfig.json": '{"compilerOptions":{"strict":true}}',
    },
    async (graph, report) => {
      clean(report);
      const primary =
        "use.ts#createDeferredQueue.[return].[object].resolveOldest";
      const backup = "use.ts#backup.[return].[object].resolveOldest";
      const callAt = (expression) => {
        const end = source.indexOf(`${expression}();`) + expression.length;
        const call = graph.store
          .links()
          .find((link) => link.kind === "calls" && link.range.end === end);
        assert.ok(call, expression);
        return call;
      };
      for (const at of [
        "gate.resolveOldest",
        "renamed.resolveOldest",
        "nullable?.resolveOldest",
      ]) {
        const call = callAt(at);
        assert.equal(call.resolution, "resolved", at);
        assert.equal(graph.target(call), primary, at);
      }
      for (const at of [
        "defaulted.resolveOldest",
        "missing.resolveOldest",
        "reassigned.resolveOldest",
      ]) {
        const call = callAt(at);
        assert.equal(call.resolution, "ambiguous", at);
        assert.deepEqual(graph.candidates(call), [backup, primary], at);
      }
      for (const at of [
        "changing.resolveOldest",
        "reflected.resolveOldest",
        "added.resolveOldest",
      ]) {
        const call = callAt(at);
        assert.equal(call.resolution, "unresolved", at);
        assert.equal(call.data.reason, "object-producer-unverified", at);
      }
    },
  );
});

test("recorded generic references identify their owner and the precise binding", async () => {
  // Hono's HandlerInterface overload defaults I3 to I & I2 (src/types.ts:659).
  const source = [
    "type Input = { value?: string };",
    "interface HandlerInterface {",
    "  <I extends Input, I2 extends Input = I, I3 extends Input = I & I2>(fn: (input: I3) => void): void;",
    "}",
    "function identity<T extends Input>(value: T): T {",
    "  function inner<T>(value: T): T { return value; }",
    "  const result: T = inner(value);",
    "  return result;",
    "}",
  ].join("\n");
  await project({ "generics.ts": source }, async (graph, report) => {
    clean(report);
    const i = source.indexOf("I extends");
    const t = source.indexOf("T extends");
    const inner = source.indexOf("T>(value", t + 1);
    const refs = graph
      .links("generics.ts", "T", "references")
      .sort((a, b) => a.range.start - b.range.start);
    assert.deepEqual(
      refs.map((ref) => [
        graph.target(ref),
        ref.data.localBinding?.name,
        ref.data.localBinding?.start,
        ref.data.localBinding?.end,
      ]),
      [
        ["generics.ts#identity", "T", t, t + 1],
        ["generics.ts#identity", "T", t, t + 1],
        ["generics.ts#identity.[local].inner", "T", inner, inner + 1],
        ["generics.ts#identity.[local].inner", "T", inner, inner + 1],
        ["generics.ts#identity", "T", t, t + 1],
      ],
    );
    assert.equal(graph.store.findSymbols({ name: "T" }).length, 0);
    assert.deepEqual(
      graph
        .links("generics.ts", "I", "references")
        .map((ref) => [graph.target(ref), ref.data.localBinding]),
      [
        ["generics.ts#HandlerInterface", { name: "I", start: i, end: i + 1 }],
        ["generics.ts#HandlerInterface", { name: "I", start: i, end: i + 1 }],
      ],
    );
  });
});

test("overloads are one symbol with a definite target; repeated JS declarations keep ordinals", async () => {
  await project(
    {
      "over.ts": [
        "export function pick(a: string): string;",
        "export function pick(a: number): number;",
        "export function pick(a: any) { return a; }",
        "export class K {",
        "  constructor(a: string);",
        "  constructor(a: any) {}",
        "  m(a: string): void;",
        "  m(a: number): void;",
        "  m(a: any) {}",
        "}",
        'pick("x");',
        "pick(1);",
        'new K("x").m(1);',
        "",
      ].join("\n"),
      "repeat.js": "function twice() {}\nfunction twice() {}\ntwice();\n",
    },
    async (graph) => {
      const pick = graph.symbol("over.ts", "pick", "function");
      assert.equal(
        graph.store.findSymbols({ file: "over.ts", name: "pick" }).length,
        1,
      );
      for (const call of graph.links("over.ts", "pick", "calls"))
        assert.equal(call.targetId, pick.id);
      graph.symbol("over.ts", "K.constructor", "constructor");
      assert.equal(
        graph.target(graph.link("over.ts", "m", "calls")),
        "over.ts#K.m",
      );
      // Two complete JS declarations are not overloads: two ordinals, candidates.
      const twice = graph.store.findSymbols({
        file: "repeat.js",
        name: "twice",
      });
      assert.deepEqual(twice.map((s) => s.ordinal).sort(), [0, 1]);
      const call = graph.link("repeat.js", "twice", "calls");
      assert.equal(call.resolution, "ambiguous");
    },
  );
});

test("declaration merging gives candidates; type positions select the type declaration", async () => {
  await project(
    {
      "merge.ts": [
        "export interface Opts { a: string }",
        "export interface Opts { b: string }",
        "export namespace Shape { export const unit = 1; }",
        "export interface Shape { size: number }",
        "",
      ].join("\n"),
      "use.ts": [
        'import { Opts, Shape } from "./merge";',
        "export const o: Opts = { a: '', b: '' };",
        "export const s: Shape = { size: Shape.unit };",
        "",
      ].join("\n"),
    },
    async (graph) => {
      const opts = graph.link("use.ts", "Opts", "references");
      assert.equal(opts.resolution, "ambiguous");
      assert.equal(graph.candidates(opts).length, 2);
      const shapeImport = graph.link("use.ts", "Shape", "imports");
      assert.deepEqual(graph.candidates(shapeImport), [
        "merge.ts#Shape",
        "merge.ts#Shape",
      ]);
      const shapeType = graph.links("use.ts", "Shape", "references");
      assert.equal(shapeType.length, 1);
      assert.equal(
        graph.store.findSymbols().find((s) => s.id === shapeType[0].targetId)
          .kind,
        "interface",
      );
    },
  );
});

test("CommonJS require binds in JS files; a computed require and a require in a .ts file do not", async () => {
  await project(
    {
      "util.ts": "export function add() {}\n",
      "cjs.js": [
        "exports.helper = function () {};",
        "module.exports.other = () => 1;",
        "",
      ].join("\n"),
      "use.js": [
        'const { add } = require("./util");',
        'const whole = require("./cjs");',
        "const name = './util';",
        "const dynamic = require(name);",
        "add();",
        "whole.helper();",
        "dynamic.add();",
        "",
      ].join("\n"),
      // A module, so its `require` declaration does not leak into the global scope.
      "use.ts":
        'export {};\ndeclare const require: any;\nconst x = require("./util");\nx.add();\n',
    },
    async (graph, report) => {
      clean(report);
      assert.equal(
        graph.target(graph.link("use.js", '"./util"')),
        "util.ts#util.ts",
      );
      const [direct, viaDynamic] = graph
        .links("use.js", "add", "calls")
        .sort((a, b) => a.range.start - b.range.start);
      assert.equal(graph.target(direct), "util.ts#add");
      assert.equal(
        graph.target(graph.link("use.js", "helper", "calls")),
        "cjs.js#helper",
      );
      graph.symbol("cjs.js", "other", "function");
      // A computed require is an unresolvable import, not a call to `require`.
      const computed = graph.link("use.js", "require(name)", "imports");
      assert.equal(computed.resolution, "unresolved");
      assert.equal(computed.targetName, "(computed require)");
      assert.equal(computed.data.reason, "computed-specifier");
      assert.equal(graph.links("use.js", "require", "calls").length, 0);
      assert.equal(viaDynamic.resolution, "unresolved");
      // In TypeScript, `require` is an ordinary call: no import edge, no guess.
      assert.equal(graph.links("use.ts", '"./util"', "imports").length, 0);
      assert.equal(
        graph.link("use.ts", "add", "calls").resolution,
        "unresolved",
      );
    },
  );
});

test("JSX components link to the component; intrinsic elements and unknown components do not resolve", async () => {
  await project(
    {
      "ui.tsx": [
        "export function Card() { return <div />; }",
        "export const Panel = () => <section><Card /></section>;",
        "export function Page() { return <Panel><Missing /></Panel>; }",
        "",
      ].join("\n"),
    },
    async (graph) => {
      assert.equal(
        graph.target(graph.link("ui.tsx", "Card", "calls")),
        "ui.tsx#Card",
      );
      assert.equal(graph.symbol("ui.tsx", "Panel").kind, "function");
      assert.equal(
        graph.target(graph.link("ui.tsx", "Panel", "calls")),
        "ui.tsx#Panel",
      );
      assert.equal(graph.links("ui.tsx", "div").length, 0);
      assert.equal(graph.links("ui.tsx", "section").length, 0);
      const missing = graph.link("ui.tsx", "Missing", "calls");
      assert.equal(missing.resolution, "unresolved");
      assert.equal(missing.data.jsx, true);
    },
  );
});

test("workspace packages resolve to project source; an undeclared package directory does not", async () => {
  await project(
    {
      "package.json": JSON.stringify({
        name: "@w/core",
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/core/package.json": JSON.stringify({
        name: "@w/core",
        main: "./index.ts",
      }),
      "packages/core/index.ts": "export function core() {}\n",
      "loose/package.json": JSON.stringify({
        name: "@w/loose",
        main: "./index.ts",
      }),
      "loose/index.ts": "export function loose() {}\n",
      "packages/app/index.ts":
        'import { core } from "@w/core";\nimport { loose } from "@w/loose";\ncore();\nloose();\n',
    },
    async (graph, report) => {
      clean(report);
      assert.equal(
        graph.target(graph.link("packages/app/index.ts", "core", "calls")),
        "packages/core/index.ts#core",
      );
      const loose = graph.link("packages/app/index.ts", '"@w/loose"');
      assert.equal(loose.resolution, "unresolved");
      assert.equal(loose.data.reason, "external-package");
    },
  );
});

test("lexical references and calls use the declaration in the checker's scope", async () => {
  // A small version of the nested submitNewProject call in CommandPalette.tsx.
  const source = [
    'import { shadow } from "./outer";',
    "export function CommandPalette(callback: () => void, { project }: { project: string }) {",
    "  const title = project;",
    "  type Title = typeof title;",
    "  type Callback = typeof callback;",
    "  const submitNewProject = () => title;",
    "  let render = function () { return submitNewProject(); };",
    "  render();",
    "  { function helper() {} helper(); }",
    "  { function helper() {} helper(); }",
    "  class Dialog {}",
    "  enum Mode { Default }",
    "  const options: Mode = 0;",
    "  new Dialog();",
    "  callback();",
    "  void callback;",
    "  const shadow = () => {};",
    "  shadow();",
    "  let unstable = () => {};",
    "  if (title) ({ unstable } = { unstable: callback });",
    "  unstable();",
    "  let alias = render;",
    "  if (title) alias = callback;",
    "  alias();",
    "  return { render, options };",
    "}",
  ].join("\n");
  await project(
    {
      "outer.ts": "export function shadow() {}",
      "use.ts": source,
      "outer.cjs": "exports.shadow = function shadow() {};",
      "use.cjs": [
        'const { shadow } = require("./outer.cjs");',
        "function run() { const shadow = () => {}; shadow(); }",
        "exports.run = run;",
      ].join("\n"),
    },
    async (graph, report) => {
      clean(report);
      const target = (name, kind) =>
        graph.target(graph.link("use.ts", name, kind));
      assert.equal(
        target("submitNewProject", "calls"),
        "use.ts#CommandPalette.[local].submitNewProject",
      );
      assert.equal(
        target("render", "calls"),
        "use.ts#CommandPalette.[local].render",
      );
      assert.equal(
        target("Dialog", "calls"),
        "use.ts#CommandPalette.[local].Dialog",
      );
      assert.equal(
        target("Mode", "references"),
        "use.ts#CommandPalette.[local].Mode",
      );
      assert.equal(
        target("render", "references"),
        "use.ts#CommandPalette.[local].render",
      );
      for (const name of ["project", "title", "callback"]) {
        assert.deepEqual(graph.store.findSymbols({ file: "use.ts", name }), []);
      }
      assert.deepEqual(graph.links("use.ts", "project", "references"), []);
      for (const [name, start] of [
        ["title", source.indexOf("title =")],
        ["callback", source.indexOf("callback:")],
      ]) {
        const reference = graph.link("use.ts", name, "references");
        assert.equal(graph.target(reference), "use.ts#CommandPalette");
        assert.deepEqual(reference.data.localBinding, {
          name,
          start,
          end: start + name.length,
        });
      }
      for (const name of ["callback", "shadow", "unstable", "alias"])
        assert.equal(
          graph.link("use.ts", name, "calls").resolution,
          "unresolved",
        );
      assert.equal(
        graph.link("use.cjs", "shadow", "calls").resolution,
        "unresolved",
      );
      const helpers = () =>
        graph
          .links("use.ts", "helper", "calls")
          .sort((a, b) => a.range.start - b.range.start)
          .map((link) => link.targetId);
      const before = helpers();
      assert.equal(before.length, 2);
      assert.ok(before.every(Boolean));
      assert.notEqual(before[0], before[1]);
      assert.deepEqual(
        graph.store.searchSymbols("project", 10).map((symbol) => symbol.name),
        ["submitNewProject"],
      );
      await graph.write(
        "use.ts",
        source.replace(
          "  const title",
          "  function unrelated() {}\n  const title",
        ),
      );
      clean(await graph.reindex());
      assert.deepEqual(helpers(), before);
    },
  );
});

test("a generator callback calls the local emitRemoved in its enclosing generator", async () => {
  // Adapted from SessionCredentialService.ts:476 in the pinned T3 Code checkout.
  await project(
    {
      "session.ts": [
        "export function* makeSessionCredentialService() {",
        "  const emitRemoved = function* (sessionId: string) { yield sessionId; };",
        "  const revoke = (sessionId: string) =>",
        "    (function* () { yield* emitRemoved(sessionId); })();",
        "  return revoke;",
        "}",
      ].join("\n"),
    },
    async (graph, report) => {
      clean(report);
      const call = graph.link("session.ts", "emitRemoved", "calls");
      assert.equal(
        graph.target(call),
        "session.ts#makeSessionCredentialService.[local].emitRemoved",
      );
      assert.equal(
        graph.store.getSymbol(call.sourceId)?.identity,
        "makeSessionCredentialService.[local].revoke",
      );
    },
  );
});

test("pnpm subpath exports and checkout path dependencies use TypeScript's resolution mode", async () => {
  const exports = {
    "./devHome": { import: "./src/devHome.ts", require: "./dist/devHome.cjs" },
    "./missing": "./dist/missing.js",
  };
  await project(
    {
      "package.json": JSON.stringify({ packageManager: "pnpm@10.0.0" }),
      "pnpm-workspace.yaml":
        "packages:\n  - 'apps/*'\n  - 'packages/**'\n  - '!packages/excluded'\n",
      "tsconfig.json": JSON.stringify({
        compilerOptions: { module: "NodeNext" },
      }),
      "apps/server/package.json": JSON.stringify({
        type: "module",
        dependencies: {
          "@t3tools/shared": "workspace:*",
          "@pkg/linked": "link:../../loose",
          "@pkg/file": "file:../../loose",
          "@pkg/excluded": "workspace:*",
          "external-package": "^1",
        },
      }),
      "apps/server/migrate-dev-db.ts": [
        'import { resolveWorktreeT3Home } from "@t3tools/shared/devHome";',
        'import { resolveHome } from "@t3tools/shared/missing";',
        'import { linked } from "@pkg/linked";',
        'import { linked as localFile } from "@pkg/file";',
        'import { plugin, load } from "@t3tools/shared/devHome";',
        'import "@pkg/excluded";',
        'import "external-package";',
        "resolveWorktreeT3Home(); resolveHome(); linked(); localFile(); plugin.run();",
        "const alias = plugin; alias.run();",
        "const made = load(); made.run(); made.callback();",
      ].join("\n"),
      "apps/server/require.cts":
        'import shared = require("@t3tools/shared/devHome"); shared.resolveWorktreeT3Home();',
      "packages/nested/shared/package.json": JSON.stringify({
        name: "@t3tools/shared",
        type: "module",
        scripts: { build: "tsc" },
        exports,
      }),
      "packages/nested/shared/tsconfig.json": JSON.stringify({
        compilerOptions: { outDir: "dist", rootDir: "src", declaration: true },
      }),
      "packages/nested/shared/src/devHome.ts": [
        "export function resolveWorktreeT3Home() {}",
        "interface Plugin { run(): void; get callback(): () => void }",
        "export function load(): Plugin { return { run() {}, callback() {} }; }",
        "export const plugin: Plugin = load();",
      ].join("\n"),
      "packages/nested/shared/src/missing.ts":
        "export function resolveHome() {}",
      "packages/excluded/package.json": JSON.stringify({
        name: "@pkg/excluded",
        main: "./index.ts",
      }),
      "packages/excluded/index.ts": "export function excluded() {}",
      "loose/package.json": JSON.stringify({
        name: "loose",
        type: "module",
        exports: { ".": "./index.js" },
      }),
      "loose/index.js": "export function linked() {}",
    },
    async (graph, report) => {
      clean(report);
      const file = "apps/server/migrate-dev-db.ts";
      assert.equal(
        graph.target(graph.link(file, "resolveWorktreeT3Home", "calls")),
        "packages/nested/shared/src/devHome.ts#resolveWorktreeT3Home",
      );
      assert.equal(
        graph.target(graph.link(file, "linked", "calls")),
        "loose/index.js#linked",
      );
      assert.equal(
        graph.target(graph.link(file, "localFile", "calls")),
        "loose/index.js#linked",
      );
      const members = graph.links(file, "run", "calls");
      assert.equal(members.length, 3);
      for (const member of [
        ...members,
        graph.link(file, "callback", "calls"),
      ]) {
        assert.equal(
          graph.target(member),
          `packages/nested/shared/src/devHome.ts#Plugin.${member.targetName.split(".").at(-1)}`,
        );
      }
      for (const name of ['"@t3tools/shared/missing"', "resolveHome"]) {
        const link = graph.link(
          file,
          name,
          name.startsWith('"') ? "imports" : "calls",
        );
        assert.equal(link.resolution, "resolved");
        assert.deepEqual(link.data.unbuiltEntry, {
          proof: "tsconfig-emit",
          build: "packages/nested/shared/package.json",
          config: "packages/nested/shared/tsconfig.json",
          output: "packages/nested/shared/dist/missing.d.ts",
          source: "packages/nested/shared/src/missing.ts",
        });
      }
      assert.equal(
        graph.link(file, '"@pkg/excluded"', "imports").data.reason,
        "external-package",
      );
      assert.deepEqual(
        libraryTarget(graph.link(file, '"external-package"', "imports")),
        {
          ecosystem: "npm",
          unit: "external-package",
          evidence: "import-path",
        },
      );
      const require = graph.link(
        "apps/server/require.cts",
        '"@t3tools/shared/devHome"',
        "imports",
      );
      // The package's build is plain tsc, which emits no `.d.cts`: the
      // compiler decides, and no C-46 convention applies.
      assert.equal(require.resolution, "unresolved");
      assert.equal(require.data.reason, "workspace-build-output-missing");
    },
  );
});

test("Yarn Plug'n'Play workspace access follows declared dependencies", async () => {
  await project(
    {
      "package.json": JSON.stringify({
        packageManager: "yarn@4.0.0",
        workspaces: ["packages/*"],
      }),
      "packages/app/package.json": JSON.stringify({
        name: "app",
        dependencies: { declared: "workspace:*" },
      }),
      "packages/app/use.ts": [
        'import { run } from "declared";',
        'import { phantom } from "undeclared";',
        "run(); phantom();",
      ].join("\n"),
      "packages/declared/package.json": JSON.stringify({
        name: "declared",
        main: "./index.ts",
      }),
      "packages/declared/index.ts": "export function run() {}",
      "packages/undeclared/package.json": JSON.stringify({
        name: "undeclared",
        main: "./index.ts",
      }),
      "packages/undeclared/index.ts": "export function phantom() {}",
    },
    async (graph, report) => {
      clean(report);
      const use = "packages/app/use.ts";
      assert.equal(
        graph.target(graph.link(use, "run", "calls")),
        "packages/declared/index.ts#run",
      );
      assert.equal(
        graph.link(use, "phantom", "calls").resolution,
        "unresolved",
      );
    },
  );
});

test("a TypeScript project reference can redirect a missing workspace declaration to its source", async () => {
  await project(
    {
      "package.json": JSON.stringify({
        workspaces: ["packages/*"],
        type: "module",
        scripts: { build: "tsc -b" },
      }),
      "tsconfig.json":
        '{"files":[],"references":[{"path":"./packages/library"}]}',
      "packages/library/package.json": JSON.stringify({
        name: "library",
        type: "module",
        exports: "./dist/index.js",
      }),
      "packages/library/tsconfig.json": JSON.stringify({
        compilerOptions: {
          composite: true,
          module: "NodeNext",
          rootDir: "src",
          outDir: "dist",
        },
        include: ["src"],
      }),
      "packages/library/src/index.ts": "export function helper() {}",
      "packages/app/tsconfig.json": JSON.stringify({
        compilerOptions: { module: "NodeNext" },
        references: [{ path: "../library" }],
      }),
      "packages/app/index.ts": 'import { helper } from "library"; helper();',
    },
    async (graph, report) => {
      clean(report);
      const call = graph.link("packages/app/index.ts", "helper", "calls");
      assert.equal(graph.target(call), "packages/library/src/index.ts#helper");
      assert.deepEqual(call.data.unbuiltEntry, {
        proof: "project-reference",
        build: "package.json",
        config: "packages/library/tsconfig.json",
        output: "packages/library/dist/index.d.ts",
        source: "packages/library/src/index.ts",
      });
    },
  );
});

test("a missing declaration follows its exact emit path and the barrel's renamed exports", async () => {
  await project(
    {
      "package.json": '{"workspaces":["packages/*"],"type":"module"}',
      "packages/lib/package.json": JSON.stringify({
        name: "fixture-library",
        type: "module",
        scripts: {
          build: 'rimraf dist && tsc --project "tsconfig.build.json"',
        },
        exports: {
          types: "./definitions/start.d.mts",
          default: "./dist/start.mjs",
        },
      }),
      "packages/lib/tsconfig.json":
        '{"compilerOptions":{"rootDir":"unused","declarationDir":"definitions","declaration":true,"emitDeclarationOnly":true,"module":"NodeNext"},"files":["unused/start.mts"]}',
      "packages/lib/unused/start.mts": "export function open() {}",
      "packages/lib/tsconfig.build.json": JSON.stringify({
        compilerOptions: {
          module: "NodeNext",
          composite: true,
          emitDeclarationOnly: true,
          outDir: "dist",
          declarationDir: "definitions",
          rootDir: "source",
          tsBuildInfoFile: "tmp/metadata",
        },
        include: ["source"],
      }),
      "packages/lib/source/start.mts":
        'export { create as open } from "./build.mjs";',
      "packages/lib/source/build.mts":
        "class Session { ping() {} } export function create() { return new Session(); }",
      "use.ts": 'import { open } from "fixture-library"; open().ping();',
    },
    async (graph, report) => {
      clean(report);
      for (const [name, target] of [
        ["open", "create"],
        ["ping", "Session.ping"],
      ]) {
        const call = graph.link("use.ts", name, "calls");
        assert.equal(
          graph.target(call),
          `packages/lib/source/build.mts#${target}`,
        );
        assert.deepEqual(call.data.unbuiltEntry, {
          proof: "tsconfig-emit",
          build: "packages/lib/package.json",
          config: "packages/lib/tsconfig.build.json",
          output: "packages/lib/definitions/start.d.mts",
          source: "packages/lib/source/start.mts",
        });
      }
    },
  );
});

test("plain compiler flags do not prove deleted or out-of-checkout build inputs", async () => {
  await project(
    {
      "package.json":
        '{"workspaces":["packages/*"],"scripts":{"build":"tsc -b"}}',
      "tsconfig.json":
        '{"files":[],"references":[{"path":"../packages/referenced"}]}',
      "packages/referenced/package.json":
        '{"name":"referenced","types":"./dist/index.d.ts"}',
      "packages/referenced/tsconfig.json":
        '{"compilerOptions":{"rootDir":"src","outDir":"dist","composite":true},"files":["src/index.ts"]}',
      "packages/referenced/src/index.ts": "export function run() {}",
      "packages/cleaned/package.json":
        '{"name":"cleaned","types":"./dist/index.d.ts","scripts":{"build":"rimraf config && tsc"}}',
      "packages/cleaned/tsconfig.json":
        '{"extends":"./config/tsconfig.base.json","files":["src/index.ts"]}',
      "packages/cleaned/config/tsconfig.base.json":
        '{"compilerOptions":{"rootDir":"../src","outDir":"../dist","declaration":true}}',
      "packages/cleaned/src/index.ts": "export function run() {}",
      "consumer/use.ts":
        'import { run as outside } from "referenced"; import { run as deleted } from "cleaned"; outside(); deleted();',
    },
    async (graph, report) => {
      clean(report);
      for (const name of ["outside", "deleted"]) {
        const call = graph.link("consumer/use.ts", name, "calls");
        assert.equal(call.resolution, "unresolved");
        assert.equal(call.data.reason, "workspace-build-output-missing");
      }
    },
  );
});

test("the importer selects source conditions and existing outputs before considering emit proofs", async () => {
  await project(
    {
      "package.json": '{"workspaces":["packages/*"],"type":"module"}',
      "packages/lib/package.json": JSON.stringify({
        name: "fixture-library",
        type: "module",
        exports: {
          ".": {
            "@fixture/source": "./src/development.ts",
            default: "./dist/index.js",
          },
          "./only": { development: "./src/development.ts" },
        },
      }),
      "packages/lib/tsconfig.json":
        '{"compilerOptions":{"rootDir":"src","outDir":"dist","composite":true,"module":"NodeNext"},"include":["src"]}',
      "packages/lib/src/index.ts": "export function open() {}",
      "packages/lib/src/development.ts": "export function open() {}",
      "packages/lib/dist/index.d.ts": "export declare function open(): number;",
      "packages/ordinary/tsconfig.json":
        '{"compilerOptions":{"module":"NodeNext"},"references":[{"path":"../lib"}]}',
      "packages/ordinary/use.ts":
        'import { open } from "fixture-library"; import "fixture-library/only"; open();',
      "packages/dev/tsconfig.json":
        '{"compilerOptions":{"module":"NodeNext","customConditions":["@fixture/source","development"]}}',
      "packages/dev/use.ts":
        'import { open } from "fixture-library"; import "fixture-library/only"; open();',
    },
    async (graph, report) => {
      clean(report);
      for (const [folder, target] of [
        ["ordinary", "dist/index.d.ts"],
        ["dev", "src/development.ts"],
      ]) {
        const call = graph.link(`packages/${folder}/use.ts`, "open", "calls");
        assert.equal(graph.target(call), `packages/lib/${target}#open`);
        assert.equal(call.data.unbuiltEntry, undefined);
      }
      assert.equal(
        graph.link(
          "packages/ordinary/use.ts",
          '"fixture-library/only"',
          "imports",
        ).resolution,
        "unresolved",
      );
      assert.equal(
        graph.link("packages/dev/use.ts", '"fixture-library/only"', "imports")
          .resolution,
        "resolved",
      );
    },
  );
});

test("an implicit emit root stays usable only while all possible inputs fit inside it", async () => {
  const use = "packages/library/src/consumer/use.ts";
  const fixture = {
    "package.json":
      '{"workspaces":["packages/library","packages/library/src/consumer"]}',
    "packages/library/package.json":
      '{"name":"fixture-library","types":"./dist/index.d.ts","scripts":{"build":"tsc -p tsconfig.build.json"}}',
    "packages/library/tsconfig.build.json":
      '{"compilerOptions":{"outDir":"dist","declaration":true},"files":["src/index.ts"]}',
    "packages/library/src/consumer/package.json":
      '{"name":"fixture-consumer","dependencies":{"fixture-library":"workspace:*"}}',
    [use]: 'import { helper } from "fixture-library"; helper();',
  };
  await project(
    {
      ...fixture,
      "packages/library/src/index.ts": "export function helper() {}",
    },
    async (graph, report) => {
      clean(report);
      const call = graph.link(use, "helper", "calls");
      assert.equal(graph.target(call), "packages/library/src/index.ts#helper");
      assert.equal(
        call.data.unbuiltEntry.output,
        "packages/library/dist/index.d.ts",
      );
    },
  );
  await project(
    {
      ...fixture,
      "packages/library/src/index.ts": 'export { helper } from "../shared";',
      "packages/library/shared.ts": "export function helper() {}",
    },
    async (graph, report) => {
      clean(report);
      const call = graph.link(use, "helper", "calls");
      assert.equal(call.resolution, "unresolved");
      assert.equal(call.data.reason, "workspace-build-output-missing");
    },
  );
});

test("conflicting emit configurations leave the missing package entry unresolved", async () => {
  await project(
    {
      "package.json": '{"workspaces":["packages/*"]}',
      "packages/lib/package.json":
        '{"name":"fixture-library","types":"./dist/index.d.ts","scripts":{"build":"tsc --build"}}',
      "packages/lib/tsconfig.json":
        '{"files":[],"references":[{"path":"./tsconfig.one.json"},{"path":"./tsconfig.two.json"}]}',
      "packages/lib/tsconfig.one.json":
        '{"compilerOptions":{"rootDir":"one","composite":true,"outDir":"dist"},"files":["one/index.ts"]}',
      "packages/lib/tsconfig.two.json":
        '{"compilerOptions":{"rootDir":"two","composite":true,"outDir":"dist"},"files":["two/index.ts"]}',
      "packages/lib/one/index.ts": "export function run() {}",
      "packages/lib/two/index.ts": "export function run() {}",
      "use.ts": 'import { run } from "fixture-library"; run();',
      "packages/app/tsconfig.json":
        '{"references":[{"path":"../lib/tsconfig.one.json"},{"path":"../lib/tsconfig.two.json"}]}',
      "packages/app/use.ts": 'import { run } from "fixture-library"; run();',
    },
    async (graph, report) => {
      clean(report);
      for (const file of ["use.ts", "packages/app/use.ts"]) {
        const call = graph.link(file, "run", "calls");
        assert.equal(call.resolution, "unresolved");
        assert.equal(call.data.reason, "workspace-build-output-missing");
      }
    },
  );
});

test("a tsup CLI entry can override the manifest entry", async () => {
  await project(
    {
      "package.json": '{"workspaces":["packages/*"],"type":"module"}',
      "packages/lib/package.json": JSON.stringify({
        name: "fixture-library",
        type: "module",
        exports: {
          types: "./generated/public.d.ts",
          default: "./generated/public.js",
        },
        scripts: { build: "tsup src/alternate/index.ts" },
        tsup: {
          entry: { public: "src/public.ts" },
          outDir: "generated",
          format: ["esm"],
          bundle: false,
        },
      }),
      "packages/lib/tsconfig.json":
        '{"compilerOptions":{"rootDir":"src","outDir":"generated","declaration":true},"files":["src/public.ts"]}',
      "packages/lib/src/public.ts": "export function open() {}",
      "packages/lib/src/alternate/index.ts": "export function other() {}",
      "use.ts": 'import { open } from "fixture-library"; open();',
    },
    async (graph, report) => {
      clean(report);
      const call = graph.link("use.ts", "open", "calls");
      assert.equal(call.resolution, "unresolved");
      assert.equal(call.data.reason, "workspace-build-output-missing");
      assert.equal(call.data.assumes, undefined);
    },
  );
});

test("plain builds prove a declaration entry, and visible rollups and rewrites rule out the assumption", async () => {
  const variants = {
    plain: { build: "rm -rf dist && tsc --build tsconfig.build.json" },
    bundled: {
      build: "tsc -p tsconfig.build.json && api-extractor run --local",
    },
    generated: { build: "dts-bundle-generator src/index.ts" },
    rollup: { build: "rollup -c" },
    wrapped: { build: "wireit" },
    rewritten: {
      build: "tsc -p tsconfig.build.json",
      postbuild: "node rewrite.mjs",
    },
    packed: {
      build: "tsc -p tsconfig.build.json",
      prepack: "node rewrite.mjs",
    },
    unconfigured: {},
  };
  await project(
    {
      "package.json":
        '{"workspaces":["packages/*"],"scripts":{"build":"turbo run build"}}',
      ...Object.fromEntries(
        Object.entries(variants).flatMap(([name, scripts]) => [
          [
            `packages/${name}/package.json`,
            JSON.stringify({ name, scripts, types: "./dist/index.d.ts" }),
          ],
          [
            `packages/${name}/tsconfig.build.json`,
            '{"compilerOptions":{"rootDir":"src","outDir":"dist","declaration":true},"files":["src/index.ts"]}',
          ],
          [`packages/${name}/src/index.ts`, "export function open() {}"],
        ]),
      ),
      "packages/bundled/src/index.ts":
        "/** @internal */ export function open() {}",
      "packages/bundled/api-extractor.json":
        '{"mainEntryPointFilePath":"<projectFolder>/dist/index.d.ts","dtsRollup":{"enabled":true,"publicTrimmedFilePath":"<projectFolder>/dist/index.d.ts"}}',
      "packages/rollup/rollup.config.mjs":
        'import dts from "rollup-plugin-dts"; export default { input: "src/index.ts", plugins: [dts()] };',
      "packages/wrapped/package.json":
        '{"name":"wrapped","types":"./dist/index.d.ts","scripts":{"build":"wireit"},"wireit":{"build":{"command":"tsc -b","output":["dist/**"]}}}',
      "packages/rewritten/rewrite.mjs":
        'import { writeFileSync } from "node:fs"; writeFileSync("dist/index.d.ts", "export declare function other(): void;");',
      "packages/packed/rewrite.mjs":
        'import { writeFileSync } from "node:fs"; writeFileSync("dist/index.d.ts", "export declare function other(): void;");',
      "use.ts": Object.keys(variants)
        .map((name) => `import { open as ${name} } from "${name}"; ${name}();`)
        .join("\n"),
    },
    async (graph, report) => {
      clean(report);
      assert.equal(
        graph.target(graph.link("use.ts", "plain", "calls")),
        "packages/plain/src/index.ts#open",
      );
      assert.equal(
        graph.link("use.ts", "plain", "calls").data.assumes,
        undefined,
      );
      const assumed = graph.link("use.ts", "unconfigured", "calls");
      assert.equal(
        graph.target(assumed),
        "packages/unconfigured/src/index.ts#open",
      );
      assert.deepEqual(assumed.data.assumes, [
        "ts-unbuilt-entry-is-compiler-emit",
      ]);
      assert.equal(
        assumed.data.unbuiltEntry.output,
        "packages/unconfigured/dist/index.d.ts",
      );
      // C-46: no compiler proof, but a stated convention names the source,
      // assumption-marked; a rewrite of the output still rules it out.
      const outcome = (name) => {
        const call = graph.link("use.ts", name, "calls");
        return call.resolution === "resolved"
          ? [graph.target(call), call.data.assumes]
          : [call.resolution, call.data.reason, call.data.assumes];
      };
      assert.deepEqual(
        Object.fromEntries(
          ["bundled", "generated", "rollup", "wrapped", "rewritten", "packed"].map(
            (name) => [name, outcome(name)],
          ),
        ),
        {
          // The trimmed roll-up drops the @internal `open`: withheld.
          bundled: ["unresolved", "workspace-build-output-missing", undefined],
          generated: [
            "packages/generated/src/index.ts#open",
            ["ts-unbuilt-entry-is-src-twin"],
          ],
          rollup: [
            "packages/rollup/src/index.ts#open",
            ["ts-unbuilt-entry-is-bundler-entry"],
          ],
          wrapped: [
            "packages/wrapped/src/index.ts#open",
            ["ts-unbuilt-entry-is-src-twin"],
          ],
          rewritten: ["unresolved", "workspace-build-output-missing", undefined],
          packed: ["unresolved", "workspace-build-output-missing", undefined],
        },
      );
    },
  );
});

test("a configured unbundled export records its emit assumption without replacing an existing answer", async () => {
  await project(
    {
      "package.json": '{"workspaces":["packages/*"],"type":"module"}',
      "tsconfig.json":
        '{"compilerOptions":{"module":"NodeNext"},"files":["app.ts"]}',
      "packages/fixture-router/package.json": JSON.stringify({
        name: "fixture-router",
        scripts: { build: "vp pack" },
        exports: { "./helpers": { types: "./dist/types/helpers.d.ts" } },
      }),
      "packages/fixture-router/tsconfig.build.json":
        '{"compilerOptions":{"declaration":true,"rootDir":"src","declarationDir":"dist/types","emitDeclarationOnly":true},"files":["src/helpers.ts"]}',
      "packages/fixture-router/src/helpers.ts":
        "export function trim() {} declare global { function routeReady(): void; interface Math { max(x: number, y: number): number; } }",
      "app.ts":
        'import { trim } from "fixture-router/helpers"; trim(); routeReady(); Math.max(1, 2);',
    },
    async (graph, report) => {
      clean(report);
      const call = graph.link("app.ts", "trim", "calls");
      assert.equal(
        graph.target(call),
        "packages/fixture-router/src/helpers.ts#trim",
      );
      assert.deepEqual(call.data.assumes, [
        "ts-unbuilt-entry-is-compiler-emit",
      ]);
      assert.equal(
        call.data.unbuiltEntry.source,
        "packages/fixture-router/src/helpers.ts",
      );
      assert.deepEqual(
        graph.link("app.ts", "routeReady", "calls").data.assumes,
        ["ts-unbuilt-entry-is-compiler-emit"],
      );
      const existing = graph.link("app.ts", "max", "calls");
      assert.equal(existing.libraries[0].symbol, "Math.max");
      assert.equal(existing.data.assumes, undefined);
      const view = new GraphView({
        data: { links: [call] },
        failedFiles: [],
        staleFiles: [],
        warnings: [],
        modules: [],
        sync: {},
      });
      const [entry] = view.page("legend", 0, 1).items;
      assert.equal(entry.value, "ts-unbuilt-entry-is-compiler-emit");
      assert.match(
        entry.description,
        /declarations whose exports are those the TypeScript compiler would emit/,
      );
    },
  );
});

test("a visible bundler config must name the mapped source literally", async () => {
  const variants = {
    alternate:
      'export default defineConfig({entry: {index: "src/actual.ts"}, dts: true});',
    opaque:
      "export default defineConfig({entry: {index: chooseEntry()}, dts: true});",
    matching:
      'export default defineConfig({entry: {index: "./src/index.ts"}, dts: true});',
  };
  await project(
    {
      "package.json": '{"workspaces":["packages/*"]}',
      ...Object.fromEntries(
        Object.entries(variants).flatMap(([name, config]) => [
          [
            `packages/${name}/package.json`,
            JSON.stringify({
              name,
              types: "dist/index.d.ts",
              scripts: { build: "tsup" },
            }),
          ],
          [
            `packages/${name}/tsconfig.build.json`,
            '{"compilerOptions":{"declaration":true,"rootDir":"src","outDir":"dist"},"files":["src/index.ts"]}',
          ],
          [`packages/${name}/src/index.ts`, "export function run() {}"],
          [`packages/${name}/src/actual.ts`, "export function run() {}"],
          [
            `packages/${name}/tsup.config.ts`,
            `import { defineConfig } from "tsup"; ${config}`,
          ],
        ]),
      ),
      "app.ts": Object.keys(variants)
        .map((name) => `import {run as ${name}} from "${name}"; ${name}();`)
        .join("\n"),
    },
    async (graph, report) => {
      clean(report);
      // C-25 proves neither. C-46: the literal entry list names the source
      // of `dist/index.d.ts` (src/actual.ts); an entry that is not data
      // leaves the src/ twin.
      const alternate = graph.link("app.ts", "alternate", "calls");
      assert.equal(
        graph.target(alternate),
        "packages/alternate/src/actual.ts#run",
      );
      assert.deepEqual(alternate.data.assumes, [
        "ts-unbuilt-entry-is-bundler-entry",
      ]);
      assert.equal(
        alternate.data.unbuiltEntry.config,
        "packages/alternate/tsup.config.ts",
      );
      const opaque = graph.link("app.ts", "opaque", "calls");
      assert.equal(graph.target(opaque), "packages/opaque/src/index.ts#run");
      assert.deepEqual(opaque.data.assumes, ["ts-unbuilt-entry-is-src-twin"]);
      const call = graph.link("app.ts", "matching", "calls");
      assert.equal(graph.target(call), "packages/matching/src/index.ts#run");
      assert.deepEqual(call.data.assumes, [
        "ts-unbuilt-entry-is-compiler-emit",
      ]);
    },
  );
});

test("compiler command-line mapping overrides prevent the entry assumption", async () => {
  const variants = {
    override: "tsc -p tsconfig.build.json --rootDir release",
    explicit: "tsc src/index.ts",
    opaque: "tsc -p tsconfig.build.json --unknown",
    harmless: "tsc --project=tsconfig.build.json --pretty false",
  };
  await project(
    {
      "package.json": '{"workspaces":["packages/*"]}',
      ...Object.fromEntries(
        Object.entries(variants).flatMap(([name, build]) => [
          [
            `packages/${name}/package.json`,
            JSON.stringify({
              name,
              types: "dist/index.d.ts",
              scripts: { build },
            }),
          ],
          [
            `packages/${name}/tsconfig.build.json`,
            '{"compilerOptions":{"declaration":true,"rootDir":"src","outDir":"dist"},"files":["src/index.ts"]}',
          ],
          [`packages/${name}/src/index.ts`, "export function run() {}"],
        ]),
      ),
      "app.ts": Object.keys(variants)
        .map((name) => `import {run as ${name}} from "${name}"; ${name}();`)
        .join("\n"),
    },
    async (graph, report) => {
      clean(report);
      for (const name of ["override", "explicit", "opaque"]) {
        const call = graph.link("app.ts", name, "calls");
        assert.equal(call.resolution, "unresolved");
        assert.equal(call.data.reason, "workspace-build-output-missing");
      }
      const call = graph.link("app.ts", "harmless", "calls");
      assert.equal(graph.target(call), "packages/harmless/src/index.ts#run");
      assert.deepEqual(call.data.assumes, [
        "ts-unbuilt-entry-is-compiler-emit",
      ]);
    },
  );
});

test("a member keeps the assumed entry that supplied its receiver type", async () => {
  await project(
    {
      "package.json": '{"workspaces":["packages/*"]}',
      "packages/fixture-lib/package.json":
        '{"name":"fixture-lib","types":"dist/index.d.ts","scripts":{"build":"tsup"}}',
      "packages/fixture-lib/tsconfig.build.json":
        '{"compilerOptions":{"declaration":true,"rootDir":"src","outDir":"dist"},"include":["src"]}',
      "packages/fixture-lib/src/index.ts":
        'import { Helper } from "./helper"; export function open(): Helper { return new Helper(); }',
      "packages/fixture-lib/src/helper.ts": "export class Helper { run() {} }",
      "app.ts":
        'import type { Helper } from "./packages/fixture-lib/src/helper"; import { open } from "fixture-lib"; open().run();',
    },
    async (graph, report) => {
      clean(report);
      const call = graph.link("app.ts", "run", "calls");
      assert.equal(
        graph.target(call),
        "packages/fixture-lib/src/helper.ts#Helper.run",
      );
      assert.deepEqual(call.data.assumes, [
        "ts-unbuilt-entry-is-compiler-emit",
      ]);
      assert.deepEqual(call.data.unbuiltEntry, {
        proof: "tsconfig-emit",
        build: "packages/fixture-lib/package.json",
        assumed: true,
        config: "packages/fixture-lib/tsconfig.build.json",
        output: "packages/fixture-lib/dist/index.d.ts",
        source: "packages/fixture-lib/src/index.ts",
      });
    },
  );
});

test("a JavaScript-only emit cannot lend the TypeScript source's types or values", async () => {
  await project(
    {
      "package.json": '{"workspaces":["packages/*"],"type":"module"}',
      "tsconfig.json":
        '{"compilerOptions":{"allowJs":true,"module":"NodeNext"}}',
      "packages/lib/package.json":
        '{"name":"fixture-library","type":"module","exports":"./dist/index.js","scripts":{"build":"tsc"}}',
      "packages/lib/tsconfig.json":
        '{"compilerOptions":{"rootDir":"src","outDir":"dist","module":"NodeNext"},"files":["src/index.ts"]}',
      "packages/lib/src/index.ts":
        "export interface Hidden {} export function open() {}",
      "use.ts":
        'import type { Hidden } from "fixture-library"; import { open } from "fixture-library"; export type Alias = Hidden; open();',
    },
    async (graph, report) => {
      clean(report);
      for (const [name, kind] of [
        ["Hidden", "imports"],
        ["Hidden", "references"],
        ["open", "calls"],
      ]) {
        const link = graph.link("use.ts", name, kind);
        assert.equal(link.resolution, "unresolved");
        assert.equal(link.data.unbuiltEntry, undefined);
        assert.equal(link.data.assumes, undefined);
      }
    },
  );
});

test("a generated sibling declaration cannot replace an unproven types entry", async () => {
  await project(
    {
      "package.json": '{"workspaces":["packages/*"],"type":"module"}',
      "packages/lib/package.json": JSON.stringify({
        name: "fixture-library",
        type: "module",
        exports: {
          ".": { types: "./types/custom.d.ts", default: "./dist/entry.js" },
          "./runtime": "./dist/entry.js",
        },
        scripts: { build: "tsc -p tsconfig.json" },
      }),
      "packages/lib/tsconfig.json":
        '{"compilerOptions":{"outDir":"dist","rootDir":"src","declaration":true,"module":"NodeNext"},"files":["src/entry.ts"]}',
      "packages/lib/src/entry.ts": "export function open() {}",
      "use.ts":
        'import { open as declared } from "fixture-library"; import { open as runtime } from "fixture-library/runtime"; declared(); runtime();',
    },
    async (graph, report) => {
      clean(report);
      const declared = graph.link("use.ts", "declared", "calls");
      assert.equal(declared.resolution, "unresolved");
      assert.equal(declared.data.reason, "workspace-build-output-missing");
      assert.equal(
        graph.target(graph.link("use.ts", "runtime", "calls")),
        "packages/lib/src/entry.ts#open",
      );
    },
  );
});

test("a declaration build that strips a re-exported input cannot lend its hidden source exports", async () => {
  await project(
    {
      "package.json": '{"workspaces":["packages/*"]}',
      "packages/lib/package.json":
        '{"name":"fixture-library","types":"./dist/index.d.ts","scripts":{"build":"tsc -p tsconfig.build.json"}}',
      "packages/lib/tsconfig.build.json":
        '{"compilerOptions":{"outDir":"dist","rootDir":"src","composite":true,"stripInternal":true},"files":["src/index.ts","src/other.ts"]}',
      "packages/lib/src/index.ts":
        'export { secret, publicHelper } from "./other";',
      "packages/lib/src/other.ts":
        "/** @internal */ export function secret() {}\nexport function publicHelper() {}",
      "use.ts": 'import { secret } from "fixture-library"; secret();',
      "app/tsconfig.json":
        '{"references":[{"path":"../packages/lib/tsconfig.build.json"}]}',
      "app/use.ts":
        'import { secret, publicHelper } from "fixture-library"; secret(); publicHelper();',
      "app/relative.ts":
        'import { secret } from "../packages/lib/dist/index"; secret();',
      "app/source.ts":
        'import { secret } from "../packages/lib/src/other"; secret();',
    },
    async (graph, report) => {
      clean(report);
      const call = graph.link("use.ts", "secret", "calls");
      assert.equal(call.resolution, "unresolved");
      assert.equal(call.data.reason, "workspace-build-output-missing");
      for (const file of ["app/use.ts", "app/relative.ts"])
        assert.equal(
          graph.link(file, "secret", "calls").resolution,
          "unresolved",
        );
      assert.equal(
        graph.target(graph.link("app/use.ts", "publicHelper", "calls")),
        "packages/lib/src/other.ts#publicHelper",
      );
      assert.equal(
        graph.target(graph.link("app/source.ts", "secret", "calls")),
        "packages/lib/src/other.ts#secret",
      );
    },
  );
});

test("workspace and relative imports retain the same declaration targets for calls", async () => {
  const calls = [
    "declared();",
    "plugin.run();",
    "const alias = plugin; alias.run();",
    "const made = make(); made.run();",
    "made.callback();",
  ];
  await project(
    {
      "package.json": JSON.stringify({
        type: "module",
        workspaces: ["packages/*"],
      }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: { module: "NodeNext" },
      }),
      "packages/api/package.json": JSON.stringify({
        name: "demo-api",
        type: "module",
        exports: { types: "./api.d.ts", default: "./runtime.js" },
      }),
      "packages/api/api.d.ts": [
        "export interface Plugin { run(): void; get callback(): () => void; }",
        "export declare function declared(): void;",
        "export declare const plugin: Plugin;",
        "export declare function make(): Plugin;",
      ].join("\n"),
      "packages/api/runtime.js": "export function declared() {}",
      "use.ts": [
        'import { declared, plugin, make } from "demo-api";',
        ...calls,
      ].join("\n"),
      "relative.ts": [
        'import { declared, plugin, make } from "./packages/api/api.js";',
        ...calls,
      ].join("\n"),
    },
    async (graph, report) => {
      clean(report);
      assert.equal(
        graph.target(graph.link("use.ts", "declared", "imports")),
        "packages/api/api.d.ts#declared",
      );
      for (const file of ["use.ts", "relative.ts"]) {
        for (const [name, identity] of [
          ["declared", "declared"],
          ["run", "Plugin.run"],
          ["make", "make"],
          ["callback", "Plugin.callback"],
        ]) {
          const found = graph.links(file, name, "calls");
          assert.equal(found.length, name === "run" ? 3 : 1);
          for (const call of found)
            assert.equal(
              graph.target(call),
              `packages/api/api.d.ts#${identity}`,
            );
        }
      }
    },
  );
});

test("only configured output directories establish that a workspace entry needs building", async () => {
  await project(
    {
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "packages/pkg/package.json": JSON.stringify({
        name: "demo",
        exports: {
          "./manual": "./lib/false-build.js",
          "./built": "./generated/output.js",
        },
      }),
      "packages/pkg/tsconfig.json": JSON.stringify({
        compilerOptions: { outDir: "generated" },
      }),
      "packages/pkg/lib/source.ts": "export const source = 1;",
      "use.ts": 'import "demo/manual"; import "demo/built";',
    },
    async (graph, report) => {
      clean(report);
      assert.equal(
        graph.link("use.ts", '"demo/manual"', "imports").data.reason,
        "workspace-entry-unavailable",
      );
      assert.equal(
        graph.link("use.ts", '"demo/built"', "imports").data.reason,
        "workspace-build-output-missing",
      );
    },
  );
});

test("extension lookup preserves a relative module edge and augmentation leaves the selected entry intact", async () => {
  await project(
    {
      "package.json": JSON.stringify({
        type: "module",
        workspaces: ["packages/*"],
        scripts: { test: "vitest run" },
      }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: { module: "Node16" },
      }),
      "packages/pkg/package.json": JSON.stringify({
        name: "demo",
        type: "module",
        exports: "./index.ts",
      }),
      "packages/pkg/index.ts": "export function selected() {}",
      "augment.ts":
        'import "demo"; declare module "demo" { interface Added {} }',
      "diagram-viewer.ts": "export const open = 1;",
      "explorer.spec.ts":
        'import "demo"; import { open } from "./diagram-viewer"; void open;',
    },
    async (graph, report) => {
      clean(report);
      assert.equal(
        graph.target(graph.link("explorer.spec.ts", '"demo"', "imports")),
        "packages/pkg/index.ts#packages/pkg/index.ts",
      );
      const relative = graph.link(
        "explorer.spec.ts",
        '"./diagram-viewer"',
        "imports",
      );
      assert.equal(
        graph.target(relative),
        "diagram-viewer.ts#diagram-viewer.ts",
      );
      assert.equal(relative.data.extensionFallback, true);
    },
  );
});

for (const [module, moduleResolution, extension, type, bindsDirectory] of [
  ["CommonJS", "Node10", "ts", "commonjs", true],
  ["Node16", "Node16", "cts", "module", true],
  ["Node16", "Node16", "ts", "module", false],
  ["NodeNext", "NodeNext", "ts", "commonjs", true],
  ["NodeNext", "NodeNext", "mts", "commonjs", false],
  ["ESNext", "Bundler", "ts", "module", true],
]) {
  test(`directory imports follow ${moduleResolution} in a ${extension} file in a ${type} package`, async () => {
    // tRPC's client tests reach the public entry with ".."; its
    // unstable-handles tests also use "." to reach their own entry.
    const source = `src/__tests__/resource.${extension}`;
    const imports = [
      [".", "here", "src/__tests__/index.ts"],
      ["..", "parent", "src/index.ts"],
      ["./", "here", "src/__tests__/index.ts"],
      ["../", "parent", "src/index.ts"],
      ["../jsx/", "component", "src/jsx/index.tsx"],
      ["../decl", "declared", "src/decl/index.d.ts"],
      ["../typed/", "typed", "src/typed/public.d.ts"],
      ["../routed", "routed", "src/routed-entry.d.ts"],
      ["./overlay", "overlaid", "src/__tests__/overlay/overlay.ts"],
    ];
    await project(
      {
        "package.json": JSON.stringify({ type }),
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            module,
            moduleResolution,
            jsx: "preserve",
            rootDirs: ["src/__tests__", "src/__tests__/overlay"],
          },
        }),
        [source]: imports
          .flatMap(([specifier, name], index) => [
            `import { ${name} as use${index} } from "${specifier}";`,
            `use${index}();`,
          ])
          .concat('import "../empty/";')
          .join("\n"),
        "src/index.ts": "export function parent() {}",
        "src/__tests__/index.ts": "export function here() {}",
        "src/jsx/index.tsx": "export function component() { return <div />; }",
        "src/decl/index.d.ts": "export declare function declared(): void;",
        "src/typed/package.json": JSON.stringify({ types: "./public.d.ts" }),
        "src/typed/public.d.ts": "export declare function typed(): void;",
        "src/routed/package.json": JSON.stringify({
          types: "../routed-entry.d.ts",
        }),
        "src/routed-entry.d.ts": "export declare function routed(): void;",
        "src/__tests__/overlay/package.json": JSON.stringify({
          types: "./overlay.ts",
        }),
        "src/__tests__/overlay/overlay.ts": "export function overlaid() {}",
        "src/empty/package.json": "{}",
      },
      async (graph, report) => {
        clean(report);
        for (const [index, [specifier, name, target]] of imports.entries()) {
          const entry = graph.link(
            source,
            JSON.stringify(specifier),
            "imports",
          );
          const call = graph.link(source, `use${index}`, "calls");
          if (bindsDirectory) {
            assert.equal(graph.target(entry), `${target}#${target}`);
            assert.equal(graph.target(call), `${target}#${name}`);
          } else {
            assert.equal(entry.resolution, "unresolved");
            assert.equal(
              entry.data.reason,
              "directory-import-not-allowed-in-esm",
            );
            assert.equal(call.resolution, "unresolved");
          }
        }
        assert.equal(
          graph.link(source, '"../empty/"', "imports").data.reason,
          "missing-module",
        );
      },
    );
  });
}

test("Turborepo-style workspaces with identical package IDs keep their own imports", async () => {
  const files = {};
  for (const [workspace, declaration] of [
    ["basic", "export function basicOnly() { return 'longer package body'; }"],
    ["with-yarn", "export const own = 1;"],
  ]) {
    const root = `examples/${workspace}`;
    files[`${root}/package.json`] = JSON.stringify({
      workspaces: ["apps/*", "packages/*"],
    });
    files[`${root}/apps/web/package.json`] = JSON.stringify({
      dependencies: { "@repo/eslint-config": "workspace:*" },
    });
    files[`${root}/packages/eslint-config/package.json`] = JSON.stringify({
      name: "@repo/eslint-config",
      version: "0.0.0",
      exports: { "./next": "./next.js" },
    });
    files[`${root}/packages/eslint-config/next.js`] = declaration;
    const name = workspace === "basic" ? "basicOnly" : "own";
    files[`${root}/apps/web/eslint.config.js`] =
      `import { ${name} } from "@repo/eslint-config/next"; export default ${name};`;
  }
  files["examples/with-yarn/packages/other/package.json"] = JSON.stringify({
    name: "@repo/eslint-config",
    version: "0.0.0",
    exports: { "./next": "./next.js" },
  });
  files["examples/with-yarn/packages/other/next.js"] = "export const own = 2;";
  files["examples/with-yarn/apps/web/eslint.config.js"] = [
    'import { own as unselected } from "@repo/eslint-config/next";',
    'import { own } from "../../packages/eslint-config/next.js";',
    "export default [own, unselected];",
  ].join("\n");
  // A separate importer has an explicit route to the short copy, while the
  // ordinary name is shared by two members of the same workspace.
  files["examples/with-yarn/apps/explicit/package.json"] = JSON.stringify({
    dependencies: {
      "@repo/eslint-config": "workspace:../../packages/eslint-config",
    },
  });
  files["examples/with-yarn/apps/explicit/eslint.config.js"] =
    'import { own } from "@repo/eslint-config/next"; export default own;';
  await project(files, async (graph, report) => {
    clean(report);
    assert.deepEqual(report.failed, []);
    for (const [workspace, app, name] of [
      ["basic", "web", "basicOnly"],
      ["with-yarn", "explicit", "own"],
    ]) {
      const root = `examples/${workspace}`;
      const source = `${root}/apps/${app}/eslint.config.js`;
      const entry = `${root}/packages/eslint-config/next.js`;
      assert.equal(
        graph.target(
          graph.link(source, '"@repo/eslint-config/next"', "imports"),
        ),
        `${entry}#${entry}`,
      );
      assert.equal(
        graph.target(graph.link(source, name, "imports")),
        `${entry}#${name}`,
      );
    }
    assert.equal(
      graph.link(
        "examples/with-yarn/apps/web/eslint.config.js",
        '"@repo/eslint-config/next"',
        "imports",
      ).resolution,
      "unresolved",
    );
  });
});

test("extends and implements resolve to checkout definitions and named outside imports", async () => {
  await project(
    {
      "types.ts":
        "export interface Shape { area(): number }\nexport class Base {}\nexport interface Named { name: string }\nexport interface Both extends Named, Shape {}\n",
      "impl.ts": [
        'import { Shape, Base } from "./types";',
        'import { EventEmitter as Emitter } from "events";',
        "export class Sq extends Base implements Shape { area() { return 1; } }",
        "export class Ev extends Emitter {}",
        "",
      ].join("\n"),
    },
    async (graph) => {
      assert.equal(
        graph.target(graph.link("impl.ts", "Base", "extends")),
        "types.ts#Base",
      );
      assert.equal(
        graph.target(graph.link("impl.ts", "Shape", "implements")),
        "types.ts#Shape",
      );
      const external = graph.link("impl.ts", "Emitter", "extends");
      assert.deepEqual(libraryTarget(external), {
        ecosystem: "node",
        unit: "events",
        symbol: "EventEmitter",
        evidence: "import-binding",
      });
      assert.equal(external.targetName, "Emitter");
      assert.equal(
        graph.target(graph.link("types.ts", "Named", "extends")),
        "types.ts#Named",
      );
    },
  );
});

test("symbols cover the declaration kinds with scoped identities and exact UTF-16 ranges", async () => {
  const text = [
    "/* 𝒳 non-BMP before declarations */",
    "export enum Color { Red, Green }",
    "export type Id = string;",
    "export namespace Outer.Inner { export function deep() {} }",
    "declare module 'ambient' { export function amb(): void }",
    "declare global { interface Window { extra: number } }",
    "export const { left, right: renamed } = { left: 1, right: 2 };",
    "export let counter = 0;",
    "export const api = { run() {}, data: 1, go: () => 1 };",
    "export default { anonymous: true };",
    "export abstract class Shape {",
    "  static count = 0;",
    "  count = 1;",
    "  #secret = 2;",
    "  get size() { return 1; }",
    "  set size(v: number) {}",
    "  handler = () => this.size;",
    "  abstract area(): number;",
    "}",
    "export const Klass = class { method() {} };",
    "function local() { function nested() {} }",
    "",
  ].join("\n");
  await project({ "kinds.ts": text }, async (graph, report) => {
    clean(report);
    const facts = graph.store
      .findSymbols({ file: "kinds.ts" })
      .map((s) => `${s.kind} ${s.identity}`)
      .sort();
    assert.deepEqual(
      facts,
      [
        "class Klass",
        "class Shape",
        "constant api",
        "variable counter",
        "constant default",
        "constant left",
        "constant renamed",
        "enum Color",
        "enum-member Color.Green",
        "enum-member Color.Red",
        "function Outer.Inner.deep",
        'function "ambient".amb',
        "function local",
        "function local.[local].nested",
        "getter Shape.size",
        "interface global.Window",
        "method Klass.method",
        "method Shape.area",
        "method api.go",
        "method api.run",
        "module kinds.ts",
        'namespace "ambient"',
        "namespace Outer",
        "namespace Outer.Inner",
        "namespace global",
        "property Shape.#secret",
        "property Shape.count",
        "property Shape.handler",
        "property Shape.static count",
        "property api.[object].data",
        "property default.[object].anonymous",
        "property global.Window.extra",
        "setter Shape.size",
        "type Id",
      ].sort(),
    );
    const color = graph.symbol("kinds.ts", "Color", "enum");
    assert.equal(color.range.start, text.indexOf("export enum Color"));
    // UTF-16 offsets: the non-BMP character counts as two code units.
    assert.equal(
      color.range.start,
      Buffer.byteLength(text.slice(0, color.range.start), "utf16le") / 2,
    );
    assert.notEqual(
      color.range.start,
      Buffer.byteLength(text.slice(0, color.range.start), "utf8"),
    );
  });
});

test("an unchanged index reopens with links resolved and no file re-parsed or program rebuilt", async () => {
  await project(
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@x": ["x.ts"] } },
      }),
      "x.ts": "export function x() {}\n",
      "y.ts": "export function x() {}\n",
      "main.ts": 'import { x } from "@x";\nx();\n',
    },
    async (graph) => {
      const xId = graph.symbol("x.ts", "x").id;
      assert.equal(graph.link("main.ts", "x", "calls").targetId, xId);
      graph.reopen();
      const bytes = await readFile(graph.database);
      const before = { ...statistics };
      const report = await graph.reindex();
      clean(report);
      assert.equal(report.indexed, 0);
      assert.equal(report.unchanged, 3);
      assert.equal(
        statistics.programs,
        before.programs,
        "no compiler program built",
      );
      assert.equal(
        statistics.extracted,
        before.extracted,
        "no file re-extracted",
      );
      assert.equal(statistics.reused, before.reused + 1);
      assert.equal(graph.link("main.ts", "x", "calls").targetId, xId);
      // Every byte but SQLite's change counter (24-27, 92-95) and, while
      // the reopened writer holds the write-ahead log, the journal format
      // (18-19): an index run chooses the journal before it reads (C-22).
      const masked = (value) => {
        const copy = Buffer.from(value);
        copy.fill(0, 18, 20);
        copy.fill(0, 24, 28);
        copy.fill(0, 92, 96);
        return copy;
      };
      assert.deepEqual(
        masked(await readFile(graph.database)),
        masked(bytes),
        "unchanged database bytes",
      );

      // Changing only tsconfig.json re-resolves the affected link.
      await graph.write(
        "tsconfig.json",
        JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "@x": ["y.ts"] } },
        }),
      );
      const changed = await graph.reindex();
      clean(changed);
      assert.equal(changed.indexed, 0);
      assert.ok(statistics.programs > before.programs);
      assert.equal(graph.target(graph.link("main.ts", "x", "calls")), "y.ts#x");
      assert.equal(graph.symbol("x.ts", "x").id, xId, "symbol IDs survive");
    },
  );
});

test("a broken config fails only the files it governs and is never silently ignored", async () => {
  await project(
    {
      "tsconfig.json": JSON.stringify({
        extends: "./tsconfig.base.json",
        compilerOptions: {},
      }),
      "a.ts": "export const a = 1;\n",
    },
    async (graph, report) => {
      assert.deepEqual(report.analysisErrors, []);
      assert.deepEqual(report.failed, ["a.ts"]);
      assert.match(
        graph.store.getFile("a.ts").result.diagnostics[0].message,
        /extends "\.\/tsconfig\.base\.json".*missing/,
      );
      // Adding the base repairs the analysis.
      await graph.write("tsconfig.base.json", "{}");
      await graph.write(
        "tsconfig.json",
        JSON.stringify({ extends: "./tsconfig.base.json" }),
      );
      const repaired = await graph.reindex();
      clean(repaired);
      assert.deepEqual(repaired.failed, []);
      // A malformed config.
      await graph.write("tsconfig.json", "{ broken");
      const malformed = await graph.reindex();
      assert.deepEqual(malformed.failed, ["a.ts"]);
      assert.match(
        graph.store.getFile("a.ts").result.diagnostics[0].message,
        /Unreadable TypeScript config tsconfig\.json/,
      );
      // A malformed base config fails the config that extends it.
      await graph.write(
        "tsconfig.json",
        JSON.stringify({ extends: "./tsconfig.base.json" }),
      );
      await graph.write("tsconfig.base.json", "{ nope");
      const badBase = await graph.reindex();
      assert.deepEqual(badBase.failed, ["a.ts"]);
      assert.match(
        graph.store.getFile("a.ts").result.diagnostics[0].message,
        /extends tsconfig\.base\.json, which is unreadable/,
      );
      // A config that is not valid UTF-8 fails capture (core-reported, module-wide).
      await graph.write("tsconfig.json", Buffer.from([0x7b, 0xff, 0x7d]));
      const unreadable = await graph.reindex();
      assert.equal(unreadable.analysisErrors.length, 1);
      assert.ok(unreadable.failed.includes("tsconfig.json"));
      // A missing project reference is only a note: references are not used for resolution.
      await graph.write(
        "tsconfig.json",
        JSON.stringify({ references: [{ path: "./pkg" }] }),
      );
      const reference = await graph.reindex();
      clean(reference);
      assert.deepEqual(reference.failed, []);
      assert.equal(graph.store.getFile("a.ts").result.status, "clean");
      assert.match(
        graph.store.getFile("a.ts").result.data.configNotes[0],
        /references "\.\/pkg", which is missing/,
      );
    },
  );
});

// Workspace with two packages; each case breaks only packages/a.
const twoPackages = (overrides) => ({
  "package.json": JSON.stringify({ private: true, workspaces: ["packages/*"] }),
  "packages/a/package.json": JSON.stringify({
    name: "@w/a",
    main: "./src/index.ts",
  }),
  "packages/a/tsconfig.json": JSON.stringify({ include: ["src"] }),
  "packages/a/src/index.ts": "export function fromA() {}\n",
  "packages/b/package.json": JSON.stringify({
    name: "@w/b",
    main: "./src/index.ts",
  }),
  "packages/b/tsconfig.json": JSON.stringify({ include: ["src"] }),
  "packages/b/src/index.ts": "export function local() {}\n",
  "packages/b/src/use.ts":
    'import { local } from "./index";\nimport { fromA } from "@w/a";\nlocal();\nfromA();\n',
  ...overrides,
});
for (const [name, overrides, cause] of [
  [
    "a missing extends",
    {
      "packages/a/tsconfig.json": JSON.stringify({
        extends: "./tsconfig.missing.json",
        include: ["src"],
      }),
    },
    /extends "\.\/tsconfig\.missing\.json", which is missing/,
  ],
  [
    "an unparsable package manifest",
    { "packages/a/package.json": "{ not json" },
    /Unreadable package manifest packages\/a\/package\.json/,
  ],
  [
    "an invalid extends value",
    {
      "packages/a/tsconfig.json": JSON.stringify({
        extends: 7,
        include: ["src"],
      }),
    },
    /invalid extends value/,
  ],
])
  test(`${name} in one package fails only that package's files`, async () => {
    await project(twoPackages(overrides), async (graph, report) => {
      assert.deepEqual(report.analysisErrors, []);
      assert.deepEqual(report.resolutionErrors, []);
      assert.deepEqual(report.failed, ["packages/a/src/index.ts"]);
      assert.match(
        graph.store.getFile("packages/a/src/index.ts").result.diagnostics[0]
          .message,
        cause,
      );
      assert.equal(
        graph.store.getFile("packages/b/src/use.ts").result.status,
        "clean",
      );
      assert.equal(
        graph.target(graph.link("packages/b/src/use.ts", "local", "calls")),
        "packages/b/src/index.ts#local",
      );
      // A link into the failed package keeps its name and stays unresolved.
      const into = graph.link("packages/b/src/use.ts", "fromA", "calls");
      assert.equal(into.resolution, "unresolved");
      assert.equal(into.targetName, "fromA");
    });
  });

test("a missing project reference fails nothing", async () => {
  await project(
    twoPackages({
      "packages/a/tsconfig.json": JSON.stringify({
        include: ["src"],
        references: [{ path: "../c" }],
      }),
    }),
    async (graph, report) => {
      clean(report);
      assert.deepEqual(report.failed, []);
      assert.equal(
        graph.target(graph.link("packages/b/src/use.ts", "fromA", "calls")),
        "packages/a/src/index.ts#fromA",
      );
    },
  );
});

test("a broken config fails its subtree but not files owned by a deeper valid config", async () => {
  await project(
    {
      "tsconfig.json": "{ broken",
      "top.ts": "export const top = 1;\n",
      "inner/tsconfig.json": "{}",
      "inner/ok.ts": "export const ok = 1;\n",
    },
    async (graph, report) => {
      assert.deepEqual(report.analysisErrors, []);
      assert.deepEqual(report.failed, ["top.ts"]);
      assert.equal(graph.store.getFile("inner/ok.ts").result.status, "clean");
    },
  );
});

test("a config extending an external package is reported as a limitation on its files", async () => {
  await project(
    {
      "tsconfig.json": JSON.stringify({
        extends: "@tsconfig/node20/tsconfig.json",
        include: ["src"],
      }),
      "src/a.ts": "export const a = 1;\n",
      "other.ts": "export const b = 1;\n",
    },
    async (graph, report) => {
      assert.deepEqual(report.analysisErrors, []);
      assert.deepEqual(report.partial, ["src/a.ts"]);
      assert.match(
        graph.store.getFile("src/a.ts").result.diagnostics[0].message,
        /external package; node_modules is never captured/,
      );
      // other.ts is not included by any config: inferred project, clean.
      assert.equal(graph.store.getFile("other.ts").result.data.project, null);
    },
  );
});

test("several tsconfig projects in one repository each resolve by their own settings", async () => {
  await project(
    {
      "tsconfig.json": JSON.stringify({
        files: [],
        references: [{ path: "./packages/a" }, { path: "./packages/b" }],
      }),
      "packages/a/tsconfig.json": JSON.stringify({
        compilerOptions: {
          composite: true,
          baseUrl: ".",
          paths: { "#dep": ["src/dep.ts"] },
        },
        include: ["src"],
      }),
      "packages/b/tsconfig.json": JSON.stringify({
        compilerOptions: {
          composite: true,
          baseUrl: ".",
          paths: { "#dep": ["lib/dep.ts"] },
        },
        include: ["src", "lib"],
      }),
      "packages/a/src/dep.ts": "export function dep() {}\n",
      "packages/a/src/main.ts": 'import { dep } from "#dep";\ndep();\n',
      "packages/b/lib/dep.ts": "export function dep() {}\n",
      "packages/b/src/main.ts": 'import { dep } from "#dep";\ndep();\n',
    },
    async (graph, report) => {
      clean(report);
      assert.equal(
        graph.target(graph.link("packages/a/src/main.ts", "dep", "calls")),
        "packages/a/src/dep.ts#dep",
      );
      assert.equal(
        graph.target(graph.link("packages/b/src/main.ts", "dep", "calls")),
        "packages/b/lib/dep.ts#dep",
      );
      assert.equal(
        graph.store.getFile("packages/a/src/main.ts").result.data.project,
        "packages/a/tsconfig.json",
      );
      assert.equal(
        graph.store.getFile("packages/b/src/main.ts").result.data.project,
        "packages/b/tsconfig.json",
      );
    },
  );
});

test("unreadable sources are reported failed and never cleaned by analysis", async () => {
  await project(
    {
      "ok.ts": "export const ok = 1;\n",
      "bad.ts": Buffer.from([0x65, 0xff, 0x0a]),
    },
    async (graph, report) => {
      assert.deepEqual(report.analysisErrors, []);
      assert.deepEqual(report.failed, ["bad.ts"]);
      assert.equal(graph.store.getFile("ok.ts").result.status, "clean");
    },
  );
});

test("a relative extends into node_modules is a limitation like a package specifier", async () => {
  await project(
    {
      "tsconfig.json": JSON.stringify({
        extends: "./node_modules/@tsconfig/node20/tsconfig.json",
        include: ["src"],
      }),
      "src/a.ts": "export const a = 1;\n",
    },
    async (graph, report) => {
      assert.deepEqual(report.analysisErrors, []);
      assert.deepEqual(report.failed, []);
      assert.deepEqual(report.partial, ["src/a.ts"]);
      assert.match(
        graph.store.getFile("src/a.ts").result.diagnostics[0].message,
        /inside node_modules; node_modules is never captured/,
      );
    },
  );
});

test("a locally bound require, module or exports is not CommonJS", async () => {
  await project(
    {
      "dep.ts": "export const real = 1;\n",
      "fn.js": [
        "export {};",
        "function require(name) { return 42; }",
        'require("./dep");',
        'const x = require("./dep");',
        "",
      ].join("\n"),
      "param.js": [
        "export function load(require) {",
        '  const { real } = require("./dep");',
        "  return real;",
        "}",
        "",
      ].join("\n"),
      "imported.js": [
        'import { require } from "./loader";',
        'require("./dep");',
        "",
      ].join("\n"),
      "loader.js": "export function require(name) { return name; }\n",
      "shadow.js": [
        "const exports = {};",
        "exports.notExported = function () {};",
        "",
      ].join("\n"),
      "real.js": 'const { real } = require("./dep");\nexports.ok = real;\n',
    },
    async (graph, report) => {
      clean(report);
      for (const file of ["fn.js", "param.js", "imported.js"])
        assert.equal(
          graph.links(file, '"./dep"', "imports").length,
          0,
          `no import edge in ${file}`,
        );
      const calls = graph
        .links("fn.js", "require", "calls")
        .sort((a, b) => a.range.start - b.range.start);
      assert.equal(calls.length, 2);
      for (const call of calls)
        assert.equal(graph.target(call), "fn.js#require");
      // The variable is an ordinary constant, not an import binding.
      graph.symbol("fn.js", "x", "constant");
      assert.equal(graph.links("fn.js", "x", "imports").length, 0);
      assert.equal(
        graph.link("param.js", "require", "calls").data.reason,
        "local",
      );
      assert.equal(graph.links("param.js", "real", "imports").length, 0);
      assert.equal(
        graph.target(graph.link("imported.js", "require", "calls")),
        "loader.js#require",
      );
      // A file-level `exports` binding shadows the CommonJS object.
      assert.equal(
        graph.store.findSymbols({ file: "shadow.js", name: "notExported" })
          .length,
        0,
      );
      // Control: the unshadowed forms are still CommonJS.
      assert.equal(
        graph.target(graph.link("real.js", '"./dep"')),
        "dep.ts#dep.ts",
      );
      assert.equal(
        graph.target(graph.link("real.js", "real", "imports")),
        "dep.ts#real",
      );
      graph.symbol("real.js", "ok", "constant");
    },
  );
});

test("constructor parameter properties are class properties", async () => {
  await project(
    {
      "a.ts": [
        "class Base { constructor(public base: number) {} }",
        "export class A extends Base {",
        "  constructor(public cb: () => void, private readonly id: string, protected override base: number, plain: number) {",
        "    super(base);",
        "  }",
        "}",
        "export function f(a: A) { a.cb(); return a.base; }",
        "",
      ].join("\n"),
    },
    async (graph, report) => {
      clean(report);
      for (const identity of ["A.cb", "A.id", "A.base", "Base.base"])
        graph.symbol("a.ts", identity, "property");
      assert.deepEqual(
        graph.store.findSymbols({ file: "a.ts", name: "plain" }),
        [],
      );
      assert.equal(
        graph.target(graph.link("a.ts", "cb", "calls")),
        "a.ts#A.cb",
      );
      const contains = graph
        .links("a.ts", "public cb: () => void", "contains")
        .map(
          (link) =>
            graph.store.findSymbols().find((s) => s.id === link.sourceId)
              .identity,
        );
      assert.deepEqual(contains, ["A"]);
    },
  );
});

test("a target set combines the known outside declaration with the checkout candidate", async () => {
  await project(
    {
      "foo.ts": [
        "export class Foo { toString() { return 'foo'; } }",
        "export function f(x: Foo | number) { return x.toString(); }",
        "",
      ].join("\n"),
    },
    async (graph) => {
      const call = graph.link("foo.ts", "toString", "calls");
      assert.equal(call.resolution, "ambiguous");
      assert.deepEqual(graph.candidates(call), ["foo.ts#Foo.toString"]);
      assert.equal(call.libraries[0].symbol, "Number.prototype.toString");
    },
  );
  // A target whose file failed (its package config is broken) is lost: the
  // surviving project candidate is not promoted to a definite target.
  await project(twoPackagesUnion(), async (graph, report) => {
    assert.deepEqual(report.failed, ["packages/a/src/shape.ts"]);
    const call = graph.link("packages/b/src/use.ts", "go", "calls");
    assert.equal(call.resolution, "unresolved");
    assert.equal(call.data.targets.length, 2);
  });
});
function twoPackagesUnion() {
  return {
    "packages/a/tsconfig.json": JSON.stringify({
      extends: "./tsconfig.gone.json",
      include: ["src"],
    }),
    "packages/a/src/shape.ts": "export class A { go() {} }\n",
    "packages/b/tsconfig.json": JSON.stringify({ include: ["src"] }),
    "packages/b/src/b.ts": "export class B { go() {} }\n",
    "packages/b/src/use.ts": [
      'import { A } from "../../a/src/shape";',
      'import { B } from "./b";',
      "export function run(x: A | B) { x.go(); }",
      "",
    ].join("\n"),
  };
}

test("usage meaning selects declarations: calls, types and values", async () => {
  await project(
    {
      "merged.ts": [
        "export function fn() {}",
        "export namespace fn { export const extra = 1; }",
        "export const Thing = 1;",
        "export type Thing = string;",
        "export class Box {}",
        "export interface Box { size: number }",
        "",
      ].join("\n"),
      "eq.ts":
        "function eq() {}\nnamespace eq { export const x = 1; }\nexport = eq;\n",
      "use.ts": [
        'import { fn, Thing, Box } from "./merged";',
        'import type { Thing as T } from "./merged";',
        'import eq = require("./eq");',
        "fn();",
        "eq();",
        "new Box();",
        "export const v = Thing;",
        "export const t: T = '';",
        "",
      ].join("\n"),
    },
    async (graph, report) => {
      clean(report);
      assert.equal(
        graph.target(graph.link("use.ts", "fn", "calls")),
        "merged.ts#fn",
      );
      assert.equal(
        graph.store
          .findSymbols()
          .find((s) => s.id === graph.link("use.ts", "fn", "calls").targetId)
          .kind,
        "function",
      );
      assert.equal(
        graph.target(graph.link("use.ts", "eq", "calls")),
        "eq.ts#eq",
      );
      assert.equal(
        graph.store
          .findSymbols()
          .find((s) => s.id === graph.link("use.ts", "eq", "calls").targetId)
          .kind,
        "function",
      );
      const box = graph.link("use.ts", "Box", "calls");
      assert.equal(
        graph.store.findSymbols().find((s) => s.id === box.targetId).kind,
        "class",
      );
      // `import type` selects the type alias, not the constant.
      const typeImport = graph.link("use.ts", "Thing as T", "imports");
      assert.equal(
        graph.store.findSymbols().find((s) => s.id === typeImport.targetId)
          .kind,
        "type",
      );
      // A value import keeps both meanings as candidates.
      assert.equal(
        graph.link("use.ts", "Thing", "imports").resolution,
        "ambiguous",
      );
      // A value read is not a link; a type position picks the type.
      const typeRef = graph.link("use.ts", "T", "references");
      assert.equal(
        graph.store.findSymbols().find((s) => s.id === typeRef.targetId).kind,
        "type",
      );
    },
  );
});

test("unresolved reasons say why", async () => {
  await project(
    {
      "package.json": '{"dependencies":{"left-pad":"^1"}}',
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@app/*": ["src/*"] } },
      }),
      "src/use.ts": [
        'import { gone } from "./missing";',
        'import { nope } from "@app/absent";',
        'import pkg from "left-pad";',
        'import { sub } from "#internal";',
        "gone(); nope(); pkg(); sub();",
        "",
      ].join("\n"),
    },
    async (graph) => {
      const reason = (at, kind) =>
        graph.link("src/use.ts", at, kind).data.reason;
      assert.equal(reason('"./missing"'), "missing-module");
      assert.equal(reason("gone", "imports"), "missing-module");
      assert.equal(reason('"@app/absent"'), "unresolved-alias");
      assert.equal(reason("nope", "imports"), "unresolved-alias");
      assert.deepEqual(libraryTarget(graph.link("src/use.ts", '"left-pad"')), {
        ecosystem: "npm",
        unit: "left-pad",
        evidence: "import-path",
      });
      assert.equal(
        libraryTarget(graph.link("src/use.ts", "pkg", "imports")).symbol,
        "default",
      );
      assert.equal(
        libraryTarget(graph.link("src/use.ts", "pkg", "calls")).symbol,
        "default",
      );
      assert.equal(reason('"#internal"'), "unresolved-alias");
      for (const name of ["gone", "nope", "sub"]) {
        const call = graph.link("src/use.ts", name, "calls");
        assert.equal(call.resolution, "unresolved");
        assert.equal(call.targetName, name);
      }
    },
  );
});

test("triple-slash references are import links", async () => {
  await project(
    {
      "globals.d.ts": "declare const shared: number;\n",
      "main.ts": [
        '/// <reference path="./globals.d.ts" />',
        '/// <reference path="./absent.d.ts" />',
        '/// <reference types="node" />',
        '/// <reference lib="es2020" />',
        "export const x = shared;",
        "",
      ].join("\n"),
    },
    async (graph) => {
      const path = graph.link("main.ts", "./globals.d.ts", "imports");
      assert.equal(graph.target(path), "globals.d.ts#globals.d.ts");
      assert.equal(path.data.reference, "path");
      assert.equal(
        graph.link("main.ts", "./absent.d.ts").data.reason,
        "missing-module",
      );
      const types = graph.link("main.ts", "node");
      assert.equal(types.resolution, "unresolved");
      assert.equal(types.data.reason, "external-package");
      assert.deepEqual(libraryTarget(graph.link("main.ts", "es2020")), {
        ecosystem: "typescript-lib",
        unit: "es",
        evidence: "reference-directive",
      });
    },
  );
});

test("a broken workspace root fails only root-package files; members stay analysed without guessed links", async () => {
  await project(
    twoPackages({
      "package.json": "{ broken",
      "root.ts": "export const r = 1;\n",
    }),
    async (graph, report) => {
      assert.deepEqual(report.analysisErrors, []);
      assert.deepEqual(report.failed, ["root.ts"]);
      assert.equal(
        graph.target(graph.link("packages/b/src/use.ts", "local", "calls")),
        "packages/b/src/index.ts#local",
      );
      // The workspace list is unknown, so @w/a is not linked rather than guessed.
      const cross = graph.link("packages/b/src/use.ts", '"@w/a"');
      assert.equal(cross.resolution, "unresolved");
      assert.equal(cross.data.reason, "workspace-manifest-unreadable");
    },
  );
});

test("the nearest containing config owns a file: root depth is zero", async () => {
  await project(
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@api": ["root.ts"] } },
      }),
      "root.ts": "export function api() {}\n",
      "z/tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@api": ["local.ts"] } },
      }),
      "z/local.ts": "export function api() {}\n",
      "z/use.ts": 'import { api } from "@api";\napi();\n',
    },
    async (graph, report) => {
      clean(report);
      assert.equal(
        graph.store.getFile("z/use.ts").result.data.project,
        "z/tsconfig.json",
      );
      assert.equal(
        graph.target(graph.link("z/use.ts", "api", "calls")),
        "z/local.ts#api",
      );
    },
  );
});

const sharedLayout = (app) => ({
  [`packages/${app}/tsconfig.json`]: JSON.stringify({
    include: ["src", "../shared/src"],
    compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["lib/*"] } },
  }),
  [`packages/${app}/lib/util.ts`]: "export function helper() {}\n",
  [`packages/${app}/src/a.ts`]: "export const a = 1;\n",
  "packages/shared/tsconfig.json": JSON.stringify({
    include: ["src", "lib"],
    compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["lib/*"] } },
  }),
  "packages/shared/lib/util.ts": "export function helper() {}\n",
  "packages/shared/src/s.ts":
    "import { helper } from '@lib/util';\nhelper();\n",
});
for (const app of ["app", "zapp"])
  test(`a config whose directory contains the file outranks one that includes it from elsewhere (${app})`, async () => {
    await project(sharedLayout(app), async (graph, report) => {
      clean(report);
      assert.equal(
        graph.store.getFile("packages/shared/src/s.ts").result.data.project,
        "packages/shared/tsconfig.json",
      );
      assert.equal(
        graph.target(graph.link("packages/shared/src/s.ts", "helper", "calls")),
        "packages/shared/lib/util.ts#helper",
      );
    });
  });

test("equally ranked configs with different settings give candidates or unresolved, never a pick", async () => {
  await project(
    {
      "pkg/tsconfig.a.json": JSON.stringify({
        include: ["src"],
        compilerOptions: {
          baseUrl: ".",
          paths: { "@x": ["one.ts"], "@y": ["one.ts"] },
        },
      }),
      "pkg/tsconfig.b.json": JSON.stringify({
        include: ["src"],
        compilerOptions: { baseUrl: ".", paths: { "@x": ["two.ts"] } },
      }),
      "pkg/one.ts": "export function x() {}\nexport function y() {}\n",
      "pkg/two.ts": "export function x() {}\n",
      "pkg/src/use.ts": [
        'import { x } from "@x";',
        'import { y } from "@y";',
        'import { same } from "./same";',
        "x(); y(); same();",
        "",
      ].join("\n"),
      "pkg/src/same.ts": "export function same() {}\n",
    },
    async (graph, report) => {
      assert.deepEqual(report.analysisErrors, []);
      const file = graph.store.getFile("pkg/src/use.ts").result;
      assert.deepEqual(file.data.projects, [
        "pkg/tsconfig.a.json",
        "pkg/tsconfig.b.json",
      ]);
      // Differs between the configs and both are complete: candidates.
      const x = graph.link("pkg/src/use.ts", "x", "calls");
      assert.deepEqual(graph.candidates(x), ["pkg/one.ts#x", "pkg/two.ts#x"]);
      // Resolves under one config only: unresolved, targets kept.
      const y = graph.link("pkg/src/use.ts", "y", "calls");
      assert.equal(y.resolution, "unresolved");
      assert.equal(y.data.reason, "ambiguous-project");
      assert.deepEqual(
        y.data.targets.map((t) => t.file),
        ["pkg/one.ts"],
      );
      // The same under both: definite.
      assert.equal(
        graph.target(graph.link("pkg/src/use.ts", "same", "calls")),
        "pkg/src/same.ts#same",
      );
    },
  );
});

test("the nearest package manifest governs a file", async () => {
  await project(
    {
      "package.json": "{ broken",
      "root.ts": "export const r = 1;\n",
      "z/package.json": JSON.stringify({ name: "z" }),
      "z/a.ts": "export const a = 1;\n",
    },
    async (graph, report) => {
      assert.deepEqual(report.failed, ["root.ts"]);
      assert.equal(graph.store.getFile("z/a.ts").result.status, "clean");
    },
  );
});

for (const [label, text] of [
  ["an array", "[1, 2]"],
  ["an empty array", "[]"],
  ["null", "null"],
  ["a number", "7"],
  ["a string", '"x"'],
])
  test(`a config extending a base whose root is ${label} fails its files`, async () => {
    await project(
      {
        "tsconfig.json": JSON.stringify({ extends: "./tsconfig.mid.json" }),
        "tsconfig.mid.json": JSON.stringify({
          extends: "./tsconfig.base.json",
        }),
        "tsconfig.base.json": text,
        "a.ts": "export const a = 1;\n",
      },
      async (graph, report) => {
        assert.deepEqual(report.failed, ["a.ts"]);
        assert.match(
          graph.store.getFile("a.ts").result.diagnostics[0].message,
          /extends tsconfig\.base\.json, which is unreadable: not an object/,
        );
      },
    );
  });

test("a candidate set never omits a possible target outside the project", async () => {
  await project(
    {
      "u.ts": [
        "export class Foo { toString() { return 'f'; } }",
        "export class Bar { toString() { return 'b'; } }",
        "export function f(x: Foo | Bar | Date) { return x.toString(); }",
        "export function g(x: Foo | Bar) { return x.toString(); }",
        "",
      ].join("\n"),
    },
    async (graph) => {
      const [withDate, inside] = graph
        .links("u.ts", "toString", "calls")
        .sort((a, b) => a.range.start - b.range.start);
      assert.equal(withDate.resolution, "ambiguous");
      assert.deepEqual(graph.candidates(withDate), [
        "u.ts#Bar.toString",
        "u.ts#Foo.toString",
      ]);
      assert.equal(withDate.libraries[0].symbol, "Date.prototype.toString");
      assert.deepEqual(graph.candidates(inside), [
        "u.ts#Bar.toString",
        "u.ts#Foo.toString",
      ]);
    },
  );
});

for (const base of ["./base.json", "./config/ts.json"])
  test(`a relative extends outside the context patterns (${base}) is a partial limitation`, async () => {
    await project(
      {
        "tsconfig.json": JSON.stringify({ extends: base, include: ["src"] }),
        [base.slice(2)]: JSON.stringify({ compilerOptions: { strict: true } }),
        "src/a.ts": "export const a = 1;\n",
      },
      async (graph, report) => {
        assert.deepEqual(report.analysisErrors, []);
        assert.deepEqual(report.failed, []);
        assert.deepEqual(report.partial, ["src/a.ts"]);
        assert.match(
          graph.store.getFile("src/a.ts").result.diagnostics[0].message,
          /not captured as project context .*its settings are missing/,
        );
      },
    );
  });

// Round 4: an uncaptured base config never yields a confident link.
const incomplete = (graph, file, at, kind) => {
  const found = graph.link(file, at, kind);
  assert.equal(found.resolution, "unresolved", `${at} ${kind}`);
  assert.equal(found.data.reason, "incomplete-config", `${at} ${kind}`);
  return found;
};
test("settings from an uncaptured base config: paths alias", async () => {
  await project(
    {
      "tsconfig.json": JSON.stringify({
        extends: "./base.json",
        compilerOptions: { baseUrl: "." },
      }),
      "base.json": JSON.stringify({
        compilerOptions: { paths: { service: ["right.ts"] } },
      }),
      "service.ts": "export function run() {}\n",
      "right.ts": "export function run() {}\n",
      "use.ts":
        'import { run } from "service";\nrun();\nfunction own() {}\nown();\n',
    },
    async (graph, report) => {
      assert.ok(report.partial.includes("use.ts"));
      const call = incomplete(graph, "use.ts", "run", "calls");
      assert.deepEqual(
        call.data.targets.map((t) => t.file),
        ["service.ts"],
      );
      incomplete(graph, "use.ts", "run", "imports");
      incomplete(graph, "use.ts", '"service"', "imports");
      // A same-file call reached without any import stays definite.
      assert.equal(
        graph.target(graph.link("use.ts", "own", "calls")),
        "use.ts#own",
      );
    },
  );
});

test("settings from an uncaptured base config: workspace packages shadowed by paths", async () => {
  await project(
    {
      "package.json": JSON.stringify({
        private: true,
        workspaces: ["packages/*"],
      }),
      "base.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@core/*": ["./app/src/core/*"] },
        },
      }),
      "app/tsconfig.json": JSON.stringify({
        extends: "../base.json",
        include: ["src"],
      }),
      "app/src/config.ts": "export function load() {}\n",
      "app/src/core/util.ts": "export function util() {}\n",
      "app/src/use.ts":
        'import { load } from "config";\nload();\nimport { util } from "@core/util";\nutil();\n',
      "packages/config/package.json": JSON.stringify({
        name: "config",
        main: "./index.ts",
      }),
      "packages/config/index.ts": "export function load() {}\n",
      "packages/util/package.json": JSON.stringify({
        name: "@core/util",
        main: "./index.ts",
      }),
      "packages/util/index.ts": "export function util() {}\n",
    },
    async (graph) => {
      for (const at of ["load", "util"]) {
        incomplete(graph, "app/src/use.ts", at, "calls");
        incomplete(graph, "app/src/use.ts", at, "imports");
      }
      incomplete(graph, "app/src/use.ts", '"config"', "imports");
      incomplete(graph, "app/src/use.ts", '"@core/util"', "imports");
    },
  );
});

test("settings from an uncaptured base config: a package base", async () => {
  await project(
    {
      "tsconfig.json": JSON.stringify({
        extends: "@company/tsconfig/base.json",
        compilerOptions: { baseUrl: "." },
      }),
      "service.ts": "export function run() {}\n",
      "use.ts": 'import { run } from "service";\nrun();\n',
    },
    async (graph) => {
      incomplete(graph, "use.ts", "run", "calls");
      incomplete(graph, "use.ts", '"service"', "imports");
    },
  );
});

test("settings from an uncaptured base config: moduleResolution", async () => {
  await project(
    {
      "package.json": JSON.stringify({
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/pkg/package.json": JSON.stringify({
        name: "pkg",
        main: "./legacy.ts",
        exports: { ".": "./modern.ts" },
      }),
      "packages/pkg/legacy.ts": "export function go() {}\n",
      "packages/pkg/modern.ts": "export function go() {}\n",
      "app/tsconfig.json": JSON.stringify({
        extends: "./base.json",
        include: ["*.ts"],
      }),
      "app/base.json": JSON.stringify({
        compilerOptions: { moduleResolution: "bundler", module: "esnext" },
      }),
      "app/use.ts": 'import { go } from "pkg";\ngo();\n',
    },
    async (graph) => {
      const call = incomplete(graph, "app/use.ts", "go", "calls");
      assert.equal(call.data.targets.length, 1);
      incomplete(graph, "app/use.ts", '"pkg"', "imports");
    },
  );
});

test("a broken config with a readable selection fails only what it selects (Vite layout)", async () => {
  const layout = {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [
        { path: "./tsconfig.app.json" },
        { path: "./tsconfig.node.json" },
      ],
    }),
    "tsconfig.app.json": JSON.stringify({ include: ["src"] }),
    "tsconfig.node.json": JSON.stringify({
      extends: "./tsconfig.missing.json",
      include: ["vite.config.ts"],
    }),
    "vite.config.ts": "export default {};\n",
    "src/App.tsx": "export function App() { return <div />; }\n",
    "src/main.tsx": 'import { App } from "./App";\nApp();\n',
    "src/helper.ts": "export const helper = 1;\n",
  };
  await project(layout, async (graph, report) => {
    assert.deepEqual(report.failed, ["vite.config.ts"]);
    assert.equal(
      graph.target(graph.link("src/main.tsx", "App", "calls")),
      "src/App.tsx#App",
    );
  });
  // An unreadable selection falls back to the subtree, but not onto files a
  // healthy config in the same directory explicitly selects.
  await project(
    { ...layout, "tsconfig.node.json": "{ broken" },
    async (graph, report) => {
      assert.deepEqual(report.failed, ["vite.config.ts"]);
      assert.equal(graph.store.getFile("src/helper.ts").result.status, "clean");
    },
  );
});

test("calls, new, types and heritage through a binding from a missing module say missing-module", async () => {
  await project(
    {
      "use.ts": [
        'import { Foo } from "./missing";',
        'import * as ns from "./missing";',
        "new Foo();",
        "Foo.make();",
        "ns.go();",
        "export let x: Foo;",
        "export class C extends Foo {}",
        "",
      ].join("\n"),
    },
    async (graph) => {
      const reasons = graph.store
        .links()
        .filter((l) => l.file === "use.ts" && l.kind !== "contains")
        .map((l) => `${l.kind} ${l.targetName} ${l.data.reason}`)
        .sort();
      assert.deepEqual(reasons, [
        "calls Foo missing-module",
        "calls Foo.make missing-module",
        "calls ns.go missing-module",
        "extends Foo missing-module",
        "imports * missing-module",
        "imports ./missing missing-module",
        "imports ./missing missing-module",
        "imports Foo missing-module",
        "references Foo missing-module",
      ]);
    },
  );
});

test("a tied file records its tied configs and no single project", async () => {
  await project(
    {
      "tsconfig.a.json": JSON.stringify({ include: ["src"] }),
      "tsconfig.b.json": JSON.stringify({ include: ["src"] }),
      "src/a.ts": "export const a = 1;\n",
    },
    async (graph) => {
      const data = graph.store.getFile("src/a.ts").result.data;
      assert.deepEqual(data.projects, ["tsconfig.a.json", "tsconfig.b.json"]);
      assert.equal("project" in data, false);
    },
  );
});

// Locally bound require: the compiler sees a same-length rename (rename.ts),
// so every route a value can take is typed correctly with no tracking.
const shadowDep = "export function real() {}\nexport class K { run() {} }\n";
const shadowHeader = [
  "export {};",
  "function require(n) { return { real() { return 17; } }; }",
  'const m = require("./dep");',
];
const routes = {
  getter: ["const z = { get value() { return m; } };", "z.value.real();"],
  arrayIndex: ["const z = [];", "z[0] = m;", "z[0].real();"],
  destructuringAssignment: ["let z;", "({ x: z } = { x: m });", "z.real();"],
  arrowReturn: ["const get = () => m;", "get().real();"],
  functionExpressionReturn: [
    "const get2 = function () { return m; };",
    "get2().real();",
  ],
  cycle: [
    "let x; let y;",
    "function h() { x = y; }",
    "x = m;",
    "x.real();",
    "y = x;",
    "y.real();",
  ],
  logicalOr: ["let z;", "z ||= m;", "z.real();"],
  nullish: ["let q = null;", "q ??= m;", "q.real();"],
  arrayLiteral: ["const arr = [m];", "arr[0].real();"],
  arrayPattern: ["const [first] = [m];", "first.real();"],
  spread: ["const s = { ...m };", "s.real();"],
  defaultParameter: ["function use(p = m) { p.real(); }"],
  classFields: [
    "class C { f = m; static s = m; }",
    "new C().f.real();",
    "C.s.real();",
  ],
  // Earlier rounds' routes.
  direct: ["m.real();", "new m.K();", "const read = m.real;"],
  reassigned: [
    "const n = m;",
    "n.real();",
    "let later;",
    "later = n;",
    "later.real();",
  ],
  objectProperty: ["const holder = { m };", "holder.m.real();"],
  functionReturn: ["function give() { return m; }", "give().real();"],
  passedOn: ["function pass(x) { x.real(); }", "pass(m);"],
  destructured: ["const { real } = m;", "real();"],
  longChain: [
    "let v0 = m;",
    ...Array.from({ length: 1000 }, (_, i) => `let v${i + 1} = v${i};`),
    "v1000.real();",
  ],
};
test("a locally bound require never links into the module it names, by any route", async () => {
  const files = { "dep.ts": shadowDep };
  for (const [name, lines] of Object.entries(routes))
    files[`${name}.js`] = [...shadowHeader, ...lines, ""].join("\n");
  files["param.js"] = [
    "export function load(require) {",
    '  const m = require("./dep");',
    "  m.real();",
    "  new m.K();",
    "}",
    "",
  ].join("\n");
  files["fake.js"] = [
    "export {};",
    "function fake() {}",
    "function require(n) { return { real: fake }; }",
    'const m = require("./dep");',
    "m.real();",
    "",
  ].join("\n");
  // Across files: an exported getter, named/default re-exports, a default
  // export of a member, module.exports and exports.x.
  files["ex.js"] = [...shadowHeader, "export const get = () => m;", ""].join(
    "\n",
  );
  files["useEx.ts"] = 'import { get } from "./ex.js";\nget().real();\n';
  files["e.js"] = [
    "export function require(n) { return {}; }",
    'const m = require("./dep");',
    "export { m };",
    "export default m;",
    "",
  ].join("\n");
  files["f.ts"] = [
    'import { m } from "./e.js";',
    'import d from "./e.js";',
    "m.real();",
    "new m.K();",
    "d.real();",
    "",
  ].join("\n");
  files["a.js"] = [
    ...shadowHeader,
    "export default m.real;",
    'import * as legit from "./dep";',
    "legit.real();",
    "",
  ].join("\n");
  files["b.js"] = 'import run from "./a";\nrun();\n';
  files["x.js"] = [
    "function require(n) { return { real() { return 0; } }; }",
    'const m = require("./dep");',
    "module.exports = m;",
    "exports.mm = m;",
    "",
  ].join("\n");
  files["y.js"] = [
    'const x = require("./x");',
    "x.real();",
    "new x.K();",
    'const { mm } = require("./x");',
    "mm.real();",
    "",
  ].join("\n");
  // Controls: the real CommonJS require and createRequire still link.
  files["real.js"] = 'const m = require("./dep");\nm.real();\nnew m.K();\n';
  files["created.mjs"] = [
    'import { createRequire } from "node:module";',
    "const require = createRequire(import.meta.url);",
    'const m = require("./dep");',
    "m.real();",
    "",
  ].join("\n");
  await project(files, async (graph, report) => {
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.analysisErrors, []);
    assert.deepEqual(report.failed, []);
    const intoDep = (link) =>
      [link.targetId, ...link.candidates.map((c) => c.id)].some(
        (id) =>
          graph.store.findSymbols().find((s) => s.id === id)?.file === "dep.ts",
      );
    const shadowedFiles = Object.keys(files).filter(
      (file) =>
        !["dep.ts", "real.js", "created.mjs"].includes(file) && file !== "a.js",
    );
    const wrong = graph.store
      .links()
      .filter((link) => shadowedFiles.includes(link.file) && intoDep(link));
    assert.deepEqual(
      wrong.map((l) => `${l.file} ${l.kind} ${l.targetName}`),
      [],
    );
    // In a.js only the genuine ES namespace import links into dep.ts.
    assert.deepEqual(
      graph.store
        .links()
        .filter((l) => l.file === "a.js" && intoDep(l))
        .map((l) => `${l.kind} ${l.targetName}`)
        .sort(),
      ["calls legit.real", "imports *", "imports ./dep"],
    );
    // Every route's member call was actually extracted (not silently dropped).
    for (const name of Object.keys(routes).filter((r) => r !== "passedOn"))
      assert.ok(
        graph.store
          .links()
          .some(
            (l) =>
              l.file === `${name}.js` &&
              l.kind === "calls" &&
              /real$/.test(l.targetName),
          ),
        name,
      );
    // Names are reported as written, not as the compiler's renamed text.
    assert.equal(
      graph.symbol("direct.js", "require", "function").name,
      "require",
    );
    const call = graph.links("direct.js", "require", "calls")[0];
    assert.equal(call.targetName, "require");
    assert.equal(graph.target(call), "direct.js#require");
    // A named re-export of the local value links to that local constant.
    assert.equal(graph.target(graph.link("f.ts", "m", "imports")), "e.js#m");
    // Controls.
    assert.equal(
      graph.target(
        graph
          .links("real.js", "real", "calls")
          .find((l) => l.targetName === "m.real"),
      ),
      "dep.ts#real",
    );
    assert.equal(graph.target(graph.link("real.js", "K", "calls")), "dep.ts#K");
    assert.equal(
      graph.target(graph.link("created.mjs", '"./dep"', "imports")),
      "dep.ts#dep.ts",
    );
    assert.equal(
      graph.target(
        graph
          .links("created.mjs", "real", "calls")
          .find((l) => l.targetName === "m.real"),
      ),
      "dep.ts#real",
    );
  });
});

test("a require shadowed only inside one function is renamed only there", async () => {
  await project(
    {
      "dep.ts": shadowDep,
      "mixed.js": [
        'const outer = require("./dep");',
        "outer.real();",
        "function inner(require) {",
        '  const m = require("./dep");',
        "  m.real();",
        "}",
        "",
      ].join("\n"),
    },
    async (graph) => {
      const calls = graph.store
        .links()
        .filter(
          (l) =>
            l.file === "mixed.js" &&
            l.kind === "calls" &&
            /real$/.test(l.targetName),
        );
      const byName = Object.fromEntries(calls.map((l) => [l.targetName, l]));
      assert.equal(graph.target(byName["outer.real"]), "dep.ts#real");
      assert.equal(byName["m.real"].resolution, "unresolved");
      assert.equal(graph.links("mixed.js", '"./dep"', "imports").length, 1);
    },
  );
});

test("a locally declared module or exports is not read as CommonJS exports", async () => {
  await project(
    {
      "a.js":
        "const module = { exports: {} };\nmodule.exports = { fake() {} };\n",
      "b.js": "const exports = {};\nexports.fake2 = function () {};\n",
      "c.js":
        'const x = require("./a");\nx.fake();\nconst y = require("./b");\ny.fake2();\n',
    },
    async (graph) => {
      assert.equal(
        graph.store.findSymbols({ file: "b.js", name: "fake2" }).length,
        0,
      );
      assert.equal(
        graph.store.findSymbols({ file: "a.js", name: "module.exports" })
          .length,
        0,
      );
      graph.symbol("a.js", "module", "constant");
      for (const name of ["x.fake", "y.fake2"])
        assert.equal(
          graph.store
            .links()
            .find((l) => l.file === "c.js" && l.targetName === name).resolution,
          "unresolved",
          name,
        );
    },
  );
});

test("a type through a namespace import of a missing module says missing-module", async () => {
  await project(
    { "use.ts": 'import * as ns from "./missing";\nexport let b: ns.T;\n' },
    async (graph) => {
      assert.equal(
        graph.link("use.ts", "ns.T", "references").data.reason,
        "missing-module",
      );
    },
  );
});

for (const [label, text] of [
  ["an array", "[1, 2]"],
  ["null", "null"],
  ["unparsable", "{ broken"],
])
  test(`a sibling config whose root is ${label} never fails a healthy config's files`, async () => {
    await project(
      {
        "tsconfig.json": JSON.stringify({
          files: [],
          references: [
            { path: "./tsconfig.web.json" },
            { path: "./tsconfig.tools.json" },
          ],
        }),
        "tsconfig.web.json": JSON.stringify({ include: ["web/**/*.ts"] }),
        "tsconfig.tools.json": text,
        "web/a.ts": "export function a() {}\n",
        "web/b.ts": 'import { a } from "./a";\na();\n',
        "tools/build.ts": "export const build = 1;\n",
      },
      async (graph, report) => {
        // Only files no healthy config selects fall back to the broken config.
        assert.deepEqual(report.failed, ["tools/build.ts"]);
        assert.equal(
          graph.store.getFile("web/a.ts").result.data.project,
          "tsconfig.web.json",
        );
        assert.equal(
          graph.target(graph.link("web/b.ts", "a", "calls")),
          "web/a.ts#a",
        );
      },
    );
  });

// Round 6: exact scope, dynamic scope, createRequire origin, spelling,
// cross-file names, containment and labels.
const freshFor = async (files) => {
  const { freshNames } = await import(
    "../dist/graph/languages/typescript/rename.js"
  );
  return freshNames(Object.values(files).map(String));
};
/** No compiler-only name may appear in any stored fact, identity or diagnostic. */
async function assertNoFreshNames(graph, files) {
  const fresh = await freshFor(files);
  const names = [
    ...Object.values(fresh.local),
    ...Object.values(fresh.uncertain),
  ];
  const stored =
    JSON.stringify(graph.store.files().map((file) => file.result)) +
    JSON.stringify(graph.store.findSymbols()) +
    JSON.stringify(graph.store.links());
  for (const name of names)
    assert.ok(!stored.includes(name), `fresh name ${name} leaked`);
}
const dep6 = "export function real() {}\nexport class K { run() {} }\n";
const linksInto = (graph, file, target = "dep.ts") =>
  graph.store
    .links()
    .filter(
      (l) =>
        l.file === file &&
        [l.targetId, ...l.candidates.map((c) => c.id)].some(
          (id) =>
            graph.store.findSymbols().find((s) => s.id === id)?.file === target,
        ),
    )
    .map((l) => `${l.kind} ${l.targetName}`)
    .sort();

test("exact scope: Annex B, catch clauses, static blocks and the CommonJS wrapper", async () => {
  const files = {
    "dep.ts": dep6,
    // Sloppy function code: the block function is hoisted into g (Annex B).
    "annexb.js": [
      "function g(c) {",
      "  if (c) { function require(n) { return { real() {} }; } }",
      '  const m = require("./dep");',
      "  return m.real();",
      "}",
      "",
    ].join("\n"),
    // CommonJS top level: Annex B never hoists a wrapper parameter name, so
    // after the block `require` is Node's loader (checked against Node).
    "cjstop.js": [
      "if (true) { function require(n) { return {}; } }",
      'const m = require("./dep");',
      "m.real();",
      "",
    ].join("\n"),
    // A catch binding is scoped to its block only.
    "catch.js": [
      "export {};",
      "try {} catch (require) {}",
      'const d = require("./dep");',
      "d.real();",
      "",
    ].join("\n"),
    "other.js": "function require(n) { return 1; }\n",
    // A class static block is its own var scope.
    "static.js": [
      "class S { static { var require = 1; } }",
      'const m = require("./dep");',
      "m.real();",
      "",
    ].join("\n"),
  };
  await project(files, async (graph, report) => {
    clean(report);
    assert.deepEqual(linksInto(graph, "annexb.js"), []);
    for (const file of ["cjstop.js", "catch.js", "static.js"]) {
      const out = linksInto(graph, file);
      assert.ok(out.includes("imports ./dep"), `${file}: ${out}`);
      assert.ok(
        out.some((l) => /real$/.test(l)),
        `${file}: ${out}`,
      );
    }
    assert.deepEqual(linksInto(graph, "catch.js", "other.js"), []);
    await assertNoFreshNames(graph, files);
  });
});

test("direct eval and with make require uncertain; indirect eval does not", async () => {
  const files = {
    "dep.ts": dep6,
    "direct.js": [
      "function run() {",
      '  eval("var require = () => ({})");',
      '  const m = require("./dep");',
      "  m.real();",
      "}",
      "",
    ].join("\n"),
    "within.js": [
      "with ({ require: () => ({}) }) {",
      '  const w = require("./dep");',
      "  w.real();",
      "}",
      "",
    ].join("\n"),
    "indirect.js": [
      '(0, eval)("var require = () => ({})");',
      'globalThis.eval("var require = 1");',
      'new Function("var require = 1")();',
      'const m = require("./dep");',
      "m.real();",
      "",
    ].join("\n"),
  };
  await project(files, async (graph, report) => {
    assert.deepEqual(report.failed, []);
    for (const file of ["direct.js", "within.js"]) {
      assert.deepEqual(linksInto(graph, file), [], file);
      const result = graph.store.getFile(file).result;
      assert.equal(result.status, "partial", file);
      assert.match(
        result.diagnostics.map((d) => d.message).join("\n"),
        /cannot be decided statically/,
      );
      const imported = graph.link(file, '"./dep"', "imports");
      assert.equal(imported.resolution, "unresolved");
      assert.equal(imported.data.reason, "dynamic-scope");
      assert.deepEqual(imported.data.targets, [
        { file: "dep.ts", key: "module@0" },
      ]);
      const member = graph.store
        .links()
        .find(
          (l) =>
            l.file === file && l.kind === "calls" && /real$/.test(l.targetName),
        );
      assert.equal(member.data.reason, "dynamic-scope", file);
      assert.equal(
        graph.link(file, "require", "calls").data.reason,
        "dynamic-scope",
      );
    }
    assert.equal(graph.store.getFile("indirect.js").result.status, "clean");
    assert.ok(linksInto(graph, "indirect.js").includes("imports ./dep"));
    await assertNoFreshNames(graph, files);
  });
});

test("createRequire is recognised by origin, not spelling", async () => {
  const files = {
    "dep.ts": dep6,
    "spoof.js": [
      "export {};",
      "function createRequire() { return (n) => ({ real() {} }); }",
      "const require = createRequire();",
      'const m = require("./dep");',
      "m.real();",
      "",
    ].join("\n"),
    "renamed.mjs": [
      'import { createRequire as cr } from "node:module";',
      "const createRequire = () => () => ({});",
      "const require = createRequire();",
      'require("./dep").real();',
      "",
    ].join("\n"),
    "namespace.mjs": [
      'import * as nodeModule from "node:module";',
      "const require = nodeModule.createRequire(import.meta.url);",
      'const m = require("./dep");',
      "m.real();",
      "",
    ].join("\n"),
    "commonjs.js": [
      'const { createRequire } = require("module");',
      "function load() {",
      "  const require = createRequire(__filename);",
      '  const m = require("./dep");',
      "  return m.real();",
      "}",
      "",
    ].join("\n"),
  };
  await project(files, async (graph) => {
    assert.deepEqual(linksInto(graph, "spoof.js"), []);
    assert.deepEqual(linksInto(graph, "renamed.mjs"), []);
    for (const file of ["namespace.mjs", "commonjs.js"]) {
      const out = linksInto(graph, file);
      assert.ok(
        out.includes("imports ./dep") && out.includes("calls m.real"),
        `${file}: ${out}`,
      );
    }
    await assertNoFreshNames(graph, files);
  });
});

test("identifier spelling: decoded names, escapes fail the file, existing look-alikes do not collide", async () => {
  const files = {
    "plain.js":
      'export {};\nfunction require(n) { return {}; }\nrequire("x");\n',
    "escaped.js":
      'export {};\nfunction require(n) { return {}; }\n\\u{0072}equire("x");\n',
    "realEscape.js": '\\u{0072}equire("./plain");\n',
    "lookalike.js":
      'export {};\nconst requirf = 1;\nconst requirg = 2;\nfunction require(n) { return requirf + requirg; }\nrequire("x");\n',
  };
  await project(files, async (graph, report) => {
    assert.equal(
      graph.symbol("plain.js", "require", "function").name,
      "require",
    );
    assert.equal(
      graph.target(graph.link("plain.js", "require", "calls")),
      "plain.js#require",
    );
    assert.deepEqual(report.failed, ["escaped.js"]);
    assert.match(
      graph.store.getFile("escaped.js").result.diagnostics[0].message,
      /escape sequence/,
    );
    // An escaped *real* require needs no renaming: the file is fine.
    assert.equal(graph.store.getFile("realEscape.js").result.status, "clean");
    // The existing requirf/requirg are ordinary constants; the call still binds locally.
    graph.symbol("lookalike.js", "requirf", "constant");
    graph.symbol("lookalike.js", "requirg", "constant");
    assert.equal(
      graph.target(graph.link("lookalike.js", "require", "calls")),
      "lookalike.js#require",
    );
    await assertNoFreshNames(graph, files);
  });
});

test("renamed names agree across files and never bind to a look-alike export", async () => {
  const files = {
    "e.js":
      "export function require(n) { return 1; }\nexport const requirf = 2;\n",
    "imp.js": 'import { require } from "./e.js";\nrequire("x");\n',
    "alias.js": 'import { require as r } from "./e.js";\nr("x");\n',
    "loader.js":
      "function require(n) { return 1; }\nexport { require as loader };\n",
    "useLoader.js": 'import { loader } from "./loader.js";\nloader("x");\n',
  };
  await project(files, async (graph, report) => {
    clean(report);
    assert.equal(
      graph.target(graph.link("imp.js", "require", "imports")),
      "e.js#require",
    );
    assert.equal(
      graph.target(graph.link("imp.js", "require", "calls")),
      "e.js#require",
    );
    assert.equal(
      graph.target(graph.link("alias.js", "require as r", "imports")),
      "e.js#require",
    );
    assert.equal(
      graph.target(graph.link("alias.js", "r", "calls")),
      "e.js#require",
    );
    assert.equal(
      graph.target(graph.link("useLoader.js", "loader", "calls")),
      "loader.js#require",
    );
    await assertNoFreshNames(graph, files);
  });
});

test("checker stack limits: warm-up makes a deep chain clean; an overflow stays contained", async (t) => {
  // Return-type chains: f(i+1) returns f(i)(). Declared in this order, the
  // source-order warm-up computes each return type on top of the previous one.
  const forward = [
    "export class Box { go() { return 1; } }",
    "export function f0() { return new Box(); }",
    ...Array.from(
      { length: 1000 },
      (_, i) => `export function f${i + 1}() { return f${i}(); }`,
    ),
    "f1000().go();",
    "",
  ].join("\n");
  // Reversed, the first warm-up step already recurses through the whole chain.
  const reversed = [
    "export class Crate { go() { return 1; } }",
    "export function ok() {}",
    "ok();",
    "g0().go();",
    ...Array.from(
      { length: 10000 },
      (_, i) => `function g${i}() { return g${i + 1}(); }`,
    ),
    "function g10000() { return new Crate(); }",
    "",
  ].join("\n");
  await project(
    {
      "forward.ts": forward,
      "deep.ts": reversed,
      "other.ts": "export function x() {}\nx();\n",
    },
    async (graph, report) => {
      assert.deepEqual(report.failed, []);
      // Holds at any stack size: each warm-up step builds on a computed one.
      assert.equal(graph.store.getFile("forward.ts").result.status, "clean");
      assert.equal(
        graph.target(graph.link("forward.ts", "go", "calls")),
        "forward.ts#Box.go",
      );
      assert.equal(
        graph.target(graph.link("other.ts", "x", "calls")),
        "other.ts#x",
      );
      // The containment part needs the 10,000-step chain to overflow, which
      // depends on the stack size: if it does not, that part is unresolved.
      const deep = graph.store.getFile("deep.ts").result;
      if (
        graph.link("deep.ts", "go", "calls").data.reason !== "compiler-limit"
      ) {
        t.skip(
          "the 10,000-step chain did not overflow at this stack size; containment not exercised",
        );
        return;
      }
      assert.equal(deep.status, "partial");
      assert.match(
        deep.diagnostics.map((d) => d.message).join("\n"),
        /exhausted its stack/,
      );
      const go = graph.link("deep.ts", "go", "calls");
      assert.equal(go.resolution, "unresolved");
      assert.equal(go.data.reason, "compiler-limit");
      // Every compiler-limit link lies in the one deep expression `g0().go()`
      // (the lookups of `g0` and of `.go` both recurse through the chain).
      const text = graph.store.getFile("deep.ts").text;
      const deepStart = text.indexOf("g0().go()");
      const limited = graph.store
        .links()
        .filter(
          (l) => l.file === "deep.ts" && l.data?.reason === "compiler-limit",
        );
      assert.ok(limited.length >= 1 && limited.length <= 2);
      for (const l of limited)
        assert.ok(
          l.range.start >= deepStart &&
            l.range.end <= deepStart + "g0().go()".length,
        );
      assert.equal(
        graph.target(graph.link("deep.ts", "ok", "calls")),
        "deep.ts#ok",
      );
      assert.equal(
        graph.target(graph.link("other.ts", "x", "calls")),
        "other.ts#x",
      );
    },
  );
});

test("a parser stack overflow fails only that file, as a transient resource limit", async (t) => {
  // A nesting depth at which the parser overflows in THIS process (it
  // depends on the stack size), found by search rather than assumed.
  let depth = 10000;
  const nestedAt = (n) =>
    `export const x = ${"(".repeat(n)}1${")".repeat(n)};\n`;
  const overflows = (n) => {
    try {
      tsCompiler.createSourceFile(
        "probe.ts",
        nestedAt(n),
        tsCompiler.ScriptTarget.Latest,
        true,
      );
      return false;
    } catch (error) {
      if (error instanceof RangeError) return true;
      throw error;
    }
  };
  while (depth <= 1_280_000 && !overflows(depth)) depth *= 2;
  if (depth > 1_280_000) {
    t.skip("the parser never overflowed up to 1,280,000 nested parentheses");
    return;
  }
  await project(
    {
      "nested.ts": nestedAt(depth),
      "fine.ts": "export function f() {}\nf();\n",
    },
    async (graph, report) => {
      assert.deepEqual(report.analysisErrors, []);
      assert.deepEqual(report.failed, ["nested.ts"]);
      const result = graph.store.getFile("nested.ts").result;
      // An environment limit, not invalid code and not a defect.
      assert.equal(result.failureKind, "transient");
      assert.match(
        result.diagnostics[0].message,
        /^The TypeScript parser exhausted its stack on this file \(a resource limit of the TypeScript compiler in this environment, not a defect in the file; it is retried on the next index\)$/,
      );
      assert.equal(
        graph.target(graph.link("fine.ts", "f", "calls")),
        "fine.ts#f",
      );
    },
  );
});

test("requiring an existing script file links to it and labels its bindings not-a-module", async () => {
  await project(
    {
      "script.js": "var counter = 0;\ncounter++;\n",
      "use.js": 'const s = require("./script");\nrequire("./missing");\n',
    },
    async (graph) => {
      const edge = graph.link("use.js", '"./script"', "imports");
      assert.equal(graph.target(edge), "script.js#script.js");
      assert.equal(edge.data.notAModule, true);
      assert.equal(
        graph.link("use.js", "s", "imports").data.reason,
        "not-a-module",
      );
      assert.equal(
        graph.link("use.js", '"./missing"', "imports").data.reason,
        "missing-module",
      );
    },
  );
});

for (const [key, value] of [
  ["include", 42],
  ["files", "a.ts"],
  ["exclude", { x: 1 }],
])
  test(`a config with a non-array "${key}" is an unreadable selection`, async () => {
    await project(
      {
        "tsconfig.json": JSON.stringify({ [key]: value }),
        "a.ts": "export const a = 1;\n",
      },
      async (graph, report) => {
        assert.deepEqual(report.failed, ["a.ts"]);
        assert.match(
          graph.store.getFile("a.ts").result.diagnostics[0].message,
          new RegExp(`invalid "${key}"`),
        );
      },
    );
  });

test("a binder stack overflow fails only that file", async (t) => {
  // The depth at which the binder (but not the parser) overflows depends on
  // the stack size and on how warm the JIT is. So a fresh Node process
  // searches for it: it grows the nesting until indexing gives anything
  // other than a clean file. If that is a binder failure, the containment
  // is asserted at that depth; if the parser fails first, there is no such
  // depth on this machine and the test reports that as unresolved (a skip).
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-binder-"));
  try {
    const script = join(scratch, "run.mjs");
    const dist = new URL("../dist/graph/", import.meta.url).href;
    await writeFile(
      script,
      [
        `import { mkdir, writeFile, rm } from "node:fs/promises";`,
        `import { join } from "node:path";`,
        `import { indexProject, LanguageRegistry, SqliteGraphStore } from ${JSON.stringify(dist + "index.js")};`,
        `import ts from ${JSON.stringify(dist + "languages/typescript/index.js")};`,
        `const scratch = ${JSON.stringify(scratch)};`,
        "let result = { found: false };",
        "for (let depth = 200; depth <= 8000; depth += 50) {",
        "  const root = join(scratch, `p${depth}`);",
        "  await mkdir(root, { recursive: true });",
        '  await writeFile(join(root, "blocks.js"), "{".repeat(depth) + "}".repeat(depth) + "\\n");',
        '  await writeFile(join(root, "fine.ts"), "export function f() {}\\nf();\\n");',
        '  const store = new SqliteGraphStore(join(scratch, `g${depth}.sqlite`), "binder");',
        "  const report = await indexProject(root, new LanguageRegistry([ts]), store);",
        '  const message = store.getFile("blocks.js").result.diagnostics[0]?.message ?? null;',
        '  const fine = store.links().find((l) => l.file === "fine.ts" && l.kind === "calls")?.resolution ?? null;',
        "  store.close();",
        "  await rm(root, { recursive: true, force: true });",
        "  if (!report.failed.length && !report.analysisErrors.length) continue;",
        '  result = { found: /binder exhausted its stack/.test(message ?? ""), depth, analysisErrors: report.analysisErrors, failed: report.failed, message, fine };',
        "  break;",
        "}",
        "console.log(JSON.stringify(result));",
      ].join("\n"),
    );
    const { execFileSync } = await import("node:child_process");
    const out = JSON.parse(
      // Inherit a --stack-size given to this process, so the search runs
      // under the same stack as the test.
      execFileSync(
        process.execPath,
        [
          ...process.execArgv.filter((flag) => flag.startsWith("--stack-size")),
          script,
        ],
        { encoding: "utf8" },
      ),
    );
    if (!out.found) {
      t.skip(
        `no nesting depth at which parsing succeeds and the binder overflows on this machine (first failure: ${out.message ?? "none up to 8,000"}); binder containment not exercised`,
      );
      return;
    }
    assert.deepEqual(out.analysisErrors, []);
    assert.deepEqual(out.failed, ["blocks.js"]);
    assert.match(out.message, /binder exhausted its stack/);
    assert.equal(out.fine, "resolved");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("one file's checker overflow does not change another file's facts", async (t) => {
  // b.ts depends on a 1,000-step return-type chain in a.ts (needs warm-up).
  const a = [
    "export class Box { go() { return 1; } }",
    "export function f0() { return new Box(); }",
    ...Array.from(
      { length: 1000 },
      (_, i) => `export function f${i + 1}() { return f${i}(); }`,
    ),
    "",
  ].join("\n");
  const b = 'import { f1000 } from "./a";\nf1000().go();\n';
  const deep = [
    "export class Crate { go() { return 1; } }",
    "g0().go();",
    ...Array.from(
      { length: 10000 },
      (_, i) => `function g${i}() { return g${i + 1}(); }`,
    ),
    "function g10000() { return new Crate(); }",
    "",
  ].join("\n");
  const facts = (graph) => {
    const link = graph.link("b.ts", "go", "calls");
    return {
      target: graph.target(link),
      resolution: link.resolution,
      reason: link.data.reason ?? null,
    };
  };
  let alone;
  await project({ "a.ts": a, "b.ts": b }, async (graph) => {
    alone = facts(graph);
  });
  assert.deepEqual(alone, {
    target: "a.ts#Box.go",
    resolution: "resolved",
    reason: null,
  });
  // The overflowing file sorts between a.ts and b.ts in extraction order.
  await project({ "a.ts": a, "aa-deep.ts": deep, "b.ts": b }, async (graph) => {
    // The other file's facts must match whether or not anything overflowed.
    assert.deepEqual(facts(graph), alone);
    if (graph.store.getFile("aa-deep.ts").result.status !== "partial")
      t.skip(
        "the 10,000-step chain did not overflow at this stack size; independence after a rebuild not exercised",
      );
  });
});

test("a free require in an ES module is linked but flagged as a bundler assumption", async () => {
  await project(
    {
      "dep.ts": dep6,
      "esm.js":
        'export {};\nconst d = require("./dep");\nd.real();\nconst { real } = require("./dep");\nreal();\n',
      "cjs.js": 'const d = require("./dep");\nd.real();\n',
    },
    async (graph) => {
      for (const link of graph.links("esm.js", '"./dep"', "imports"))
        assert.deepEqual(link.data.assumes, ["bundler-require"]);
      assert.deepEqual(graph.link("esm.js", "d", "imports").data.assumes, [
        "bundler-require",
      ]);
      const member = graph.store
        .links()
        .find((l) => l.file === "esm.js" && l.targetName === "d.real");
      assert.equal(graph.target(member), "dep.ts#real");
      assert.deepEqual(member.data.assumes, ["bundler-require"]);
      const destructured = graph.store
        .links()
        .find(
          (l) =>
            l.file === "esm.js" &&
            l.kind === "calls" &&
            l.targetName === "real",
        );
      assert.deepEqual(destructured.data.assumes, ["bundler-require"]);
      // An ordinary CommonJS file carries no assumption.
      assert.equal(
        graph.link("cjs.js", '"./dep"', "imports").data.assumes,
        undefined,
      );
    },
  );
});

test("createRequire with a base other than this file is unresolved with its own reason", async () => {
  await project(
    {
      "dep.ts": dep6,
      "sub/dep.ts": dep6,
      "base.mjs": [
        'import { createRequire } from "node:module";',
        'const require = createRequire(new URL("./sub/", import.meta.url));',
        'const m = require("./dep");',
        "m.real();",
        "",
      ].join("\n"),
      "own.mjs": [
        'import { createRequire } from "node:module";',
        "const require = createRequire(import.meta.url);",
        'const m = require("./dep");',
        "m.real();",
        "",
      ].join("\n"),
    },
    async (graph) => {
      const edge = graph.link("base.mjs", '"./dep"', "imports");
      assert.equal(edge.resolution, "unresolved");
      assert.equal(edge.data.reason, "createrequire-base");
      assert.equal(edge.data.targets, undefined);
      assert.deepEqual(linksInto(graph, "base.mjs"), []);
      assert.deepEqual(linksInto(graph, "base.mjs", "sub/dep.ts"), []);
      assert.ok(linksInto(graph, "own.mjs").includes("imports ./dep"));
    },
  );
});

test("not-a-module means only that the target file has no exports", async () => {
  await project(
    {
      "script.js": "var counter = 0;\ncounter++;\n",
      "dep.ts": dep6,
      "use.js": [
        'const s = require("./script");',
        'const d = (0, require)("./dep");',
        'const e = \\u{0072}equire("./dep");',
        "",
      ].join("\n"),
    },
    async (graph) => {
      const script = graph.link("use.js", '"./script"', "imports");
      assert.equal(graph.target(script), "script.js#script.js");
      assert.equal(script.data.notAModule, true);
      for (const edge of graph.links("use.js", '"./dep"', "imports")) {
        assert.equal(graph.target(edge), "dep.ts#dep.ts");
        assert.equal(edge.data.notAModule, undefined);
      }
      for (const binding of graph.store
        .links()
        .filter(
          (l) => l.file === "use.js" && l.kind === "imports" && l.data.reason,
        ))
        assert.notEqual(
          binding.data.reason === "not-a-module" && binding.targetName !== "*",
          true,
        );
      assert.equal(
        graph.link("use.js", "s", "imports").data.reason,
        "not-a-module",
      );
    },
  );
});

test("parenthesised, comma and module.require forms keep the import", async () => {
  await project(
    {
      "dep.ts": dep6,
      "forms.js": [
        'const a = (require)("./dep");',
        'const b = (0, require)("./dep");',
        'const c = module.require("./dep");',
        "",
      ].join("\n"),
    },
    async (graph) => {
      const edges = graph.links("forms.js", '"./dep"', "imports");
      assert.equal(edges.length, 3);
      assert.deepEqual(edges.map((edge) => edge.data.calleeForm).sort(), [
        "(0, require)",
        "(require)",
        "module.require",
      ]);
      for (const edge of edges)
        assert.equal(graph.target(edge), "dep.ts#dep.ts");
    },
  );
});

test("reviewers' round 7 reproductions: no link into the module where Node uses a local", async () => {
  const files = {
    "dep.ts": dep6,
    "ifbranch.js": [
      "function g() {",
      "  if (true) function require(n) { return { real() {} }; }",
      '  const m = require("./dep");',
      "  return m.real();",
      "}",
      "",
    ].join("\n"),
    "arrowargs.js": [
      '(() => { arguments[1] = () => ({ marker: "LOCAL" }); })();',
      'const a = require("./dep");',
      "a.real();",
      "",
    ].join("\n"),
    "patch.js": [
      "const patch = () => { arguments[1] = (n) => ({ real() {} }); };",
      "patch();",
      'const b = require("./dep");',
      "b.real();",
      "",
    ].join("\n"),
    "returned.js": [
      "const f = () => arguments;",
      "f()[1] = () => ({});",
      'const c = require("./dep");',
      "c.real();",
      "",
    ].join("\n"),
    "replaced.mjs": [
      'import m from "node:module";',
      'm.createRequire = () => () => ({ marker: "LOCAL" });',
      "const require = m.createRequire(import.meta.url);",
      'const d = require("./dep");',
      "d.real();",
      "",
    ].join("\n"),
    "aliased.mjs": [
      'import { createRequire as cr } from "node:module";',
      "const require = cr(import.meta.url);",
      'const e = require("./dep");',
      "e.real();",
      "",
    ].join("\n"),
    "strictargs.js": [
      '"use strict";',
      "(() => { arguments[1] = () => ({}); })();",
      'const s = require("./dep");',
      "s.real();",
      "",
    ].join("\n"),
  };
  await project(files, async (graph) => {
    for (const file of [
      "ifbranch.js",
      "arrowargs.js",
      "patch.js",
      "returned.js",
      "replaced.mjs",
    ])
      assert.deepEqual(linksInto(graph, file), [], file);
    // Aliased createRequire from node:module is the real loader.
    assert.ok(linksInto(graph, "aliased.mjs").includes("calls e.real"));
    // Strict code: `arguments` is not mapped to the parameters.
    assert.ok(linksInto(graph, "strictargs.js").includes("calls s.real"));
    await assertNoFreshNames(graph, files);
  });
});

test("the bundler assumption travels through aliases, destructuring, re-exports and barrels", async () => {
  const depCjs = "module.exports = { real() {} };\n";
  await project(
    {
      "dep.cjs": depCjs,
      "a.mjs": [
        'export const d = require("./dep.cjs");',
        "const alias = d;",
        "alias.real();",
        'const { real } = require("./dep.cjs");',
        "export { real };",
        "export default d;",
        "",
      ].join("\n"),
      "barrel.mjs": 'export * from "./a.mjs";\n',
      "consumer.ts": [
        'import { d, real } from "./a.mjs";',
        'import dflt from "./a.mjs";',
        'import { d as viaBarrel } from "./barrel.mjs";',
        "d.real();",
        "real();",
        "dflt.real();",
        "viaBarrel.real();",
        "",
      ].join("\n"),
      "c.js": 'import * as ns from "./a.mjs";\nns.d.real();\n',
    },
    async (graph) => {
      const dep = new Set(
        graph.store.findSymbols({ file: "dep.cjs" }).map((s) => s.id),
      );
      const intoDep = (l) =>
        dep.has(l.targetId) || l.candidates.some((c) => dep.has(c.id));
      for (const file of ["a.mjs", "consumer.ts", "c.js"]) {
        const reached = graph.store
          .links()
          .filter(
            (l) => l.file === file && intoDep(l) && l.kind !== "contains",
          );
        assert.ok(reached.length > 0, file);
        for (const link of reached)
          assert.deepEqual(
            link.data.assumes,
            ["bundler-require"],
            `${file} ${link.kind} ${link.targetName}`,
          );
      }
      // The consumer's bindings and calls are among them.
      for (const name of ["d.real", "real", "dflt.real", "viaBarrel.real"])
        assert.ok(
          graph.store
            .links()
            .some(
              (l) =>
                l.file === "consumer.ts" && l.targetName === name && intoDep(l),
            ),
          name,
        );
    },
  );
});

test("indirect loader forms emit untyped-require bindings and members", async () => {
  await project(
    {
      "dep.ts": dep6,
      "p.js":
        'const p = (0, require)("./dep");\np.real();\nconst { real } = (require)("./dep");\n',
    },
    async (graph) => {
      const whole = graph.link("p.js", "p", "imports");
      assert.equal(whole.data.reason, "untyped-require");
      assert.equal(
        graph.link("p.js", "real", "imports").data.reason,
        "untyped-require",
      );
      const member = graph.store
        .links()
        .find((l) => l.file === "p.js" && l.targetName === "p.real");
      assert.equal(member.data.reason, "untyped-require");
    },
  );
});

test("failed and invalid targets get their own reasons, never not-a-module", async () => {
  await project(
    {
      "failed.js":
        'export {};\nfunction require(n) { return {}; }\n\\u{0072}equire("x");\n',
      "partial.js": "var x = ;\n",
      "use.js":
        'const f = require("./failed");\nconst q = require("./partial");\n',
    },
    async (graph, report) => {
      assert.ok(report.failed.includes("failed.js"));
      const failedEdge = graph.link("use.js", '"./failed"', "imports");
      assert.equal(failedEdge.data.notAModule, undefined);
      assert.equal(failedEdge.data.reason, "target-unavailable");
      assert.equal(
        graph.link("use.js", "f", "imports").data.reason,
        "target-unavailable",
      );
      // A syntax error: the file failed, the edge and binding fail with it.
      assert.ok(report.failed.includes("partial.js"));
      const invalidEdge = graph.link("use.js", '"./partial"', "imports");
      assert.equal(invalidEdge.data.notAModule, undefined);
      assert.equal(invalidEdge.data.reason, "invalid-code");
      assert.equal(invalidEdge.data.cause.file, "partial.js");
      assert.equal(
        graph.link("use.js", "q", "imports").data.reason,
        "invalid-code",
      );
    },
  );
});

// ----- Round 9: the differential analysis (untrusted.ts) -----

/**
 * The last `calls` link to `method` on each line marked `// D` (depends on
 * untrusted input) or `// C` (control), as [mark, line, link].
 */
function markedCalls(graph, file, method) {
  const text = graph.store.getFile(file).text;
  const links = graph.store
    .links()
    .filter((l) => l.file === file && l.kind === "calls");
  const found = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const mark = / \/\/ ([DC])$/.exec(line)?.[1];
    const end = offset + line.length;
    if (mark) {
      const onLine = links
        .filter(
          (l) =>
            l.range.start >= offset &&
            l.range.end <= end &&
            text.slice(l.range.start, l.range.end) === method,
        )
        .sort((a, b) => b.range.start - a.range.start);
      assert.ok(onLine.length, `a ${method} call on: ${line}`);
      found.push([mark, line, onLine[0]]);
    }
    offset = end + 1;
  }
  return found;
}

const DEP_CJS = "module.exports = { real() {} };\n";
const ROUTES = [
  "export const holder = { d };",
  "export const boxed = { value: d };",
  "export function ret() { return d; }",
  "export const arr = [d];",
  "export const spread = { ...holder };",
  "export class K { field = d; }",
  "/** @template T @param {T} v @returns {T} */",
  "export function id(v) { return v; }",
  "const a0 = d;",
  ...Array.from({ length: 29 }, (_, i) => `const a${i + 1} = a${i};`),
  "export const a30 = a29;",
  "export const own = { real() {} };",
];

test("the bundler label follows every route the checker follows; independent links stay unflagged", async () => {
  await project(
    {
      "dep.cjs": DEP_CJS,
      "a.mjs": [
        'export const d = require("./dep.cjs");',
        ...ROUTES,
        "holder.d.real(); // D",
        "boxed.value.real(); // D",
        "ret().real(); // D",
        "arr[0].real(); // D",
        "const { d: destructured } = holder;",
        "destructured.real(); // D",
        "spread.d.real(); // D",
        "new K().field.real(); // D",
        "id(d).real(); // D",
        "a30.real(); // D",
        "own.real(); // C",
        "id(own).real(); // C",
        "",
      ].join("\n"),
      "barrel.mjs": 'export * from "./a.mjs";\n',
      "use.ts": [
        'import { holder, boxed, ret, arr, spread, K, id, a30, own } from "./a.mjs";',
        'import { holder as viaBarrel, own as ownViaBarrel } from "./barrel.mjs";',
        "holder.d.real(); // D",
        "boxed.value.real(); // D",
        "ret().real(); // D",
        "arr[0].real(); // D",
        "const [first] = arr;",
        "first.real(); // D",
        "spread.d.real(); // D",
        "new K().field.real(); // D",
        "id(holder.d).real(); // D",
        "a30.real(); // D",
        "viaBarrel.d.real(); // D",
        "own.real(); // C",
        "ownViaBarrel.real(); // C",
        "id(own).real(); // C",
        "",
      ].join("\n"),
    },
    async (graph) => {
      for (const file of ["a.mjs", "use.ts"])
        for (const [mark, line, link] of markedCalls(graph, file, "real")) {
          if (mark === "D") {
            assert.equal(link.resolution, "resolved", `${file}: ${line}`);
            assert.equal(
              graph.target(link),
              "dep.cjs#module.exports.real",
              `${file}: ${line}`,
            );
            assert.deepEqual(
              link.data.assumes,
              ["bundler-require"],
              `${file}: ${line}`,
            );
          } else {
            assert.equal(link.resolution, "resolved", `${file}: ${line}`);
            assert.equal(
              graph.target(link),
              "a.mjs#own.real",
              `${file}: ${line}`,
            );
            assert.equal(link.data.assumes, undefined, `${file}: ${line}`);
          }
        }
      // An import of a name declared in a.mjs targets that declaration in
      // both programs: it does not rest on the loader, whatever its value.
      for (const name of ["own", "holder"]) {
        const binding = graph.link("use.ts", name, "imports");
        assert.equal(graph.target(binding), `a.mjs#${name}`);
        assert.equal(binding.data.assumes, undefined, name);
      }
    },
  );
});

test("any call that receives the wrapper's arguments makes require uncertain; only an array spread does not", async () => {
  const dep = "exports.real = function real() {};\n";
  const tail = 'const d = require("./dep.cjs");\nd.real();\n';
  const fake = "function (a) { a[1] = () => ({ real() {} }); return []; }";
  const uncertain = {
    "from.cjs": "Array.from(arguments);\n",
    "slice.cjs": "Array.prototype.slice.call(arguments);\n",
    "empty-slice.cjs": "[].slice.call(arguments);\n",
    "call-spread.cjs": "function f() {}\nf(...arguments);\n",
    "local.cjs": `const Array = { from: ${fake} };\nArray.from(arguments);\n`,
    "other-file.cjs": 'require("./patch.cjs");\nArray.from(arguments);\n',
    "constructor-key.cjs": `const k = "fr" + "om";\n[].constructor[k] = ${fake};\nArray.from(arguments);\n`,
    "function-call.cjs": `Function.prototype.call = ${fake};\nArray.prototype.slice.call(arguments);\n`,
    "proto-key.cjs":
      'const k = "sli" + "ce";\nObject.getPrototypeOf([])[k] = function () { this[1] = () => ({ real() {} }); return []; };\n[].slice.call(arguments);\n',
    "assign.cjs": `Object.assign([].constructor, { ["fr" + "om"]: ${fake} });\nArray.from(arguments);\n`,
    "global-name.cjs": `const w = globalThis, n = "Arr" + "ay";\nw[n] = { from: ${fake} };\nArray.from(arguments);\n`,
  };
  const files = { "dep.cjs": dep, "patch.cjs": `Array.from = ${fake};\n` };
  for (const [name, head] of Object.entries(uncertain))
    files[name] = head + tail;
  files["array-spread.cjs"] = "const copy = [...arguments];\n" + tail;
  files["array-spread-local.cjs"] =
    "const Array = 1;\nconst copy = [...arguments];\n" + tail;
  await project(files, async (graph) => {
    for (const file of Object.keys(uncertain)) {
      const edge = graph.link(file, '"./dep.cjs"', "imports");
      assert.equal(edge.resolution, "unresolved", file);
      assert.equal(edge.data.reason, "dynamic-scope", file);
      assert.equal(
        graph.link(file, "real", "calls").resolution,
        "unresolved",
        file,
      );
    }
    for (const file of ["array-spread.cjs", "array-spread-local.cjs"]) {
      assert.equal(
        graph.target(graph.link(file, '"./dep.cjs"', "imports")),
        "dep.cjs#dep.cjs",
        file,
      );
      assert.equal(
        graph.target(graph.link(file, "real", "calls")),
        "dep.cjs#real",
        file,
      );
    }
  });
});

// ----- Round 11: a file that cannot be read is not valid code -----

/** The single `calls` link whose text is `name` on the line containing `marker`. */
function callOn(graph, file, marker, name) {
  const text = graph.store.getFile(file).text;
  const lineStart = text.lastIndexOf("\n", text.indexOf(marker)) + 1;
  const lineEnd = text.indexOf("\n", lineStart);
  const found = graph.store
    .links()
    .filter(
      (l) =>
        l.file === file &&
        l.kind === "calls" &&
        l.range.start >= lineStart &&
        l.range.end <= lineEnd &&
        text.slice(l.range.start, l.range.end) === name,
    );
  assert.equal(found.length, 1, `one ${name} call on the ${marker} line`);
  return found[0];
}
/** Failed: unresolved, invalid-code, nothing that names a likely answer. */
const failedLink = (link, cause, what) => {
  assert.equal(link.resolution, "unresolved", what);
  assert.equal(link.data.reason, "invalid-code", what);
  assert.equal(link.data.targets, undefined, `${what}: no targets`);
  assert.equal(link.targetId ?? null, null, `${what}: no target`);
  assert.deepEqual(link.candidates ?? [], [], `${what}: no candidates`);
  const { via, ...files } = link.data.cause ?? {};
  assert.deepEqual(files, cause, `${what}: cause`);
  assert.ok(typeof via === "string" && via.length, `${what}: via`);
};
const FLAG = "no-unseen-declarations";
const flagged = (graph, link, target, what) => {
  assert.equal(link.resolution, "resolved", what);
  assert.equal(graph.target(link), target, what);
  assert.ok(link.data.assumes?.includes(FLAG), `${what}: flagged`);
};

const BROKEN_FILES = {
  "tsconfig.json": '{ "compilerOptions": { "allowJs": true } }\n',
  // One syntax error in one function body: the whole file has failed.
  "maths.ts": [
    "export const pi = 3.14;",
    "export const phi = 1.618;",
    "export function absolute(x: number) {",
    "  return x < 0 ? -x : x +;",
    "}",
    "export class Shape { area() { return 0; } }",
    "",
  ].join("\n"),
  "other.ts": "export const other = () => 1;\n",
  "barrel.ts": 'export * from "./maths";\nexport * from "./other";\n',
  "globals.js": "function scriptHelper() {}\nvar broken = (;\n",
  "use.ts": [
    'import { pi, phi, absolute } from "./maths";',
    'import { other } from "./barrel";',
    'import { Shape as ViaBarrel } from "./barrel";',
    'import { Shape } from "./maths";',
    'import { gone } from "./nowhere";',
    "absolute(phi); // absolute",
    "other(); // other",
    "class Square extends Shape {}",
    "new Square().area(); // inherited",
    "new ViaBarrel(); // via-barrel",
    "scriptHelper(); // global",
    "export const area = pi;",
    "",
  ].join("\n"),
};

test("a syntax error fails the whole file; every link into it fails and names the file", async () => {
  await project(BROKEN_FILES, async (graph, report) => {
    assert.ok(report.failed.includes("maths.ts"));
    assert.ok(report.failed.includes("globals.js"));
    assert.deepEqual(graph.store.findSymbols({ file: "maths.ts" }), []);
    const maths = { file: "maths.ts" };
    for (const edge of graph.links("use.ts", '"./maths"', "imports"))
      failedLink(edge, maths, "import");
    for (const name of ["pi", "phi", "absolute"])
      failedLink(
        graph.links("use.ts", name, "imports")[0],
        maths,
        `binding ${name}`,
      );
    failedLink(
      callOn(graph, "use.ts", "// absolute", "absolute"),
      maths,
      "call",
    );
    // Through `export *` from the failed file, and through a base in it.
    failedLink(
      callOn(graph, "use.ts", "// via-barrel", "ViaBarrel"),
      maths,
      "through export *",
    );
    failedLink(
      callOn(graph, "use.ts", "// inherited", "area"),
      maths,
      "inherited from a class in the failed file",
    );
    // A global the failed script might have declared.
    failedLink(
      callOn(graph, "use.ts", "// global", "scriptHelper"),
      { file: "globals.js" },
      "script global",
    );
    // Missing is not broken: an ordinary unresolved import.
    const missing = graph.link("use.ts", '"./nowhere"', "imports");
    assert.equal(missing.data.reason, "missing-module");
    assert.equal(missing.data.cause, undefined);
    // Unrelated links of the same program: resolved, flagged.
    flagged(
      graph,
      callOn(graph, "use.ts", "// other", "other"),
      "other.ts#other",
      "unrelated",
    );
    // Where and why, like a compiler error.
    const failure = graph.store.getFile("maths.ts");
    assert.equal(failure.result?.status ?? failure.status, "failed");
  });
});

test("a failed file reports its first syntax error with line, column, message and text", async () => {
  await project(
    { "bad.ts": "export const a = 1;\nexport const b = (;\n" },
    async (graph, report) => {
      assert.ok(report.failed.includes("bad.ts"));
      const result = graph.store.getFile("bad.ts");
      const diagnostics =
        result.result?.diagnostics ?? result.diagnostics ?? [];
      assert.ok(diagnostics.length > 0, "diagnostics");
      assert.equal(
        diagnostics[0].message,
        'Syntax error at line 2, column 19: Expression expected. Found: ";".',
      );
      const starts = diagnostics.map((d) => d.range.start);
      assert.deepEqual(
        starts,
        [...starts].sort((a, b) => a - b),
      );
    },
  );
});

test("a name through export * from two failed files names both; fixing them restores everything with no flags", async () => {
  const files = {
    "a.ts": "export function fromA() {}\nconst x = (;\n",
    "b.ts": "export function fromB() {}\nconst y = (;\n",
    "barrel.ts": 'export * from "./a";\nexport * from "./b";\n',
    "use.ts": 'import { fromA } from "./barrel";\nfromA(); // call\n',
  };
  await project(files, async (graph) => {
    failedLink(
      callOn(graph, "use.ts", "// call", "fromA"),
      { files: ["a.ts", "b.ts"] },
      "two causes",
    );
    // Unchanged re-index re-parses nothing.
    const reused = statistics.reused;
    const built = statistics.programs;
    await graph.reindex();
    assert.equal(statistics.reused, reused + 1);
    assert.equal(statistics.programs, built);
    // Fixed: resolved, and no assumption left anywhere.
    await graph.write("a.ts", "export function fromA() {}\n");
    await graph.write("b.ts", "export function fromB() {}\n");
    const report = await graph.reindex();
    assert.deepEqual(report.failed ?? [], []);
    const call = callOn(graph, "use.ts", "// call", "fromA");
    assert.equal(graph.target(call), "a.ts#fromA");
    for (const link of graph.store.links()) {
      assert.equal(link.data?.assumes, undefined, link.targetName);
      assert.equal(link.data?.cause, undefined, link.targetName);
    }
  });
});

test("only programs that would include a failed file are flagged", async () => {
  await project(
    {
      "one/tsconfig.json": '{ "include": ["*.ts"] }\n',
      "one/broken.ts": "export const lost = (;\n",
      "one/a.ts": "export function f() {}\nf(); // one\n",
      "two/tsconfig.json": '{ "include": ["*.ts"] }\n',
      // Includes the failed file through an import: flagged too.
      "two/b.ts":
        'import { lost } from "../one/broken";\nexport function g() {}\ng(); // two\n',
      "three/tsconfig.json": '{ "include": ["*.ts"] }\n',
      "three/c.ts": "export function h() {}\nh(); // three\n",
    },
    async (graph) => {
      flagged(
        graph,
        callOn(graph, "one/a.ts", "// one", "f"),
        "one/a.ts#f",
        "one",
      );
      flagged(
        graph,
        callOn(graph, "two/b.ts", "// two", "g"),
        "two/b.ts#g",
        "two",
      );
      failedLink(
        graph.link("two/b.ts", "lost", "imports"),
        { file: "one/broken.ts" },
        "shared failed file",
      );
      const clean = callOn(graph, "three/c.ts", "// three", "h");
      assert.equal(graph.target(clean), "three/c.ts#h");
      assert.equal(clean.data.assumes, undefined);
    },
  );
});

test("the program flag and the bundler assumption together", async () => {
  await project(
    {
      "package.json": '{ "type": "module" }\n',
      "dep.cjs": "module.exports = { real() {} };\n",
      "broken.js": "const lost = (;\n",
      "a.js": 'export const d = require("./dep.cjs");\nd.real(); // real\n',
    },
    async (graph) => {
      const link = callOn(graph, "a.js", "// real", "real");
      assert.equal(link.resolution, "resolved");
      assert.deepEqual(link.data.assumes, ["bundler-require", FLAG]);
    },
  );
});

test("tied configs: six orders of three variants merge to identical output", async () => {
  const { mergeTied } = await import(
    "../dist/graph/languages/typescript/index.js"
  );
  const variant = (config, extra) => ({
    status: "clean",
    diagnostics: [],
    symbols: [],
    links: [
      {
        sourceKey: "module@0",
        kind: "calls",
        targetName: "f",
        range: { start: 0, end: 1 },
        data: { targets: [{ file: "x.ts", key: "function@0" }], ...extra },
      },
    ],
    data: {
      analyzer: "a",
      project: config,
      ...(config === "tsconfig.b.json" ? { configNotes: ["missing ref"] } : {}),
    },
  });
  const all = [
    ["tsconfig.a.json", variant("tsconfig.a.json", {})],
    [
      "tsconfig.b.json",
      variant("tsconfig.b.json", { assumes: ["bundler-require"] }),
    ],
    ["tsconfig.c.json", variant("tsconfig.c.json", { reason: "external" })],
  ];
  const orders = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  const outputs = orders.map((order) =>
    JSON.stringify(
      mergeTied(
        order.map((i) => all[i][1]),
        order.map((i) => all[i][0]),
      ),
    ),
  );
  for (const output of outputs) assert.equal(output, outputs[0]);
  const merged = JSON.parse(outputs[0]);
  assert.deepEqual(merged.data.byProject["tsconfig.b.json"], {
    configNotes: ["missing ref"],
  });
  assert.deepEqual(merged.links[0].data.assumes, ["bundler-require"]);
  assert.equal(merged.links[0].data.reason, "ambiguous-project");
});

test("tied configs merge the same way whichever config comes first", async () => {
  const files = (first, second) => ({
    "dep.cjs": 'exports.real = function real() { return "DEP"; };\n',
    "real.js":
      'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\nexport const value = require("./dep.cjs");\n',
    "assumed.js": 'export const value = require("./dep.cjs");\n',
    "other.ts": "export function other() {}\n",
    "use.ts":
      'import { value } from "@provider";\nimport { other } from "@second";\nvalue.real();\nother();\n',
    "tsconfig.a.json": `{ "files": ["use.ts"], "compilerOptions": { "allowJs": true, "baseUrl": ".", "paths": { "@provider": ["./${first}"], "@second": ["./${first === "real.js" ? "other.ts" : "missing.ts"}"] }, "module": "ESNext", "moduleResolution": "Bundler" } }\n`,
    "tsconfig.b.json": `{ "files": ["use.ts"], "compilerOptions": { "allowJs": true, "baseUrl": ".", "paths": { "@provider": ["./${second}"], "@second": ["./${second === "real.js" ? "other.ts" : "missing.ts"}"] }, "module": "ESNext", "moduleResolution": "Bundler" } }\n`,
  });
  const outcomes = [];
  for (const order of [
    ["real.js", "assumed.js"],
    ["assumed.js", "real.js"],
  ])
    await project(files(...order), async (graph) => {
      const member = graph.store
        .links()
        .find((l) => l.file === "use.ts" && l.targetName === "value.real");
      assert.ok(member, "value.real");
      assert.deepEqual(member.data.assumes, ["bundler-require"], order.join());
      // Every link of use.ts, independent of which config maps what.
      outcomes.push(
        graph.store
          .links()
          .filter((l) => l.file === "use.ts")
          .map((l) => {
            const { byProject, ...rest } = l.data ?? {};
            return JSON.stringify({
              kind: l.kind,
              range: l.range,
              resolution: l.resolution,
              ...rest,
              byProject: Object.values(byProject ?? {})
                .map((v) => JSON.stringify(v))
                .sort(),
            });
          })
          .sort(),
      );
      const call = graph.store
        .links()
        .find((l) => l.file === "use.ts" && l.targetName === "other");
      assert.equal(call.data.reason, "ambiguous-project", order.join());
    });
  assert.deepEqual(outcomes[0], outcomes[1]);
});

test("meaningless heritage grammar is a syntax error: the file fails", async () => {
  await project(
    {
      "bases.ts": "export class A {}\nexport class B {}\n",
      "c.ts":
        'import { A, B } from "./bases";\nexport class C extends A, B {}\n',
      "use.ts": 'import { C } from "./c";\nnew C(); // c\n',
    },
    async (graph, report) => {
      assert.ok(report.failed.includes("c.ts"));
      const diagnostics = graph.store.getFile("c.ts").result.diagnostics;
      assert.match(
        diagnostics[0].message,
        /^Syntax error at line 2, column 27: Classes can only extend a single class\. Found: "B"\.$/,
      );
      failedLink(callOn(graph, "use.ts", "// c", "C"), { file: "c.ts" }, "C");
    },
  );
});

test("a failed file edited but still failing is analysed again when it changes what others see", async () => {
  await project(
    {
      "tsconfig.json": '{ "compilerOptions": { "allowJs": true } }\n',
      // A broken script: its globals are unseen.
      "a.js": "function g() {}\nvar x = (;\n",
      "use.js": "g(); // g\n",
    },
    async (graph) => {
      failedLink(callOn(graph, "use.js", "// g", "g"), { file: "a.js" }, "g");
      // Still broken, but now a module that does not mention `g`: it can
      // declare no global, and no unseen declaration could be named `g`.
      await graph.write("a.js", "export function h() {}\nvar x = (;\n");
      await graph.reindex();
      const call = callOn(graph, "use.js", "// g", "g");
      assert.equal(call.data.reason, "no-symbol");
      assert.equal(call.data.cause, undefined);
    },
  );
});

// ----- Round 12: a failure passes through every lookup that depends on it -----

/** Indexes files in a scratch project: links keyed by site, targets by identity. */
async function indexFiles(files) {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-graph-ts-diff-"));
  const root = join(scratch, "project");
  const store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "diff");
  try {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    const report = await indexProject(root, registry(), store);
    const symbols = new Map(
      store.findSymbols().map((s) => [s.id, `${s.file}#${s.identity}`]),
    );
    const texts = new Map(store.files().map((f) => [f.path, f.text]));
    const links = new Map();
    for (const l of store.links()) {
      let key = `${l.file}\0${l.kind}\0${l.range.start}\0${l.range.end}`;
      while (links.has(key)) key += "+";
      const text = texts.get(l.file);
      const lineStart = text.lastIndexOf("\n", l.range.start - 1) + 1;
      const lineEnd = text.indexOf("\n", l.range.start);
      links.set(key, {
        file: l.file,
        kind: l.kind,
        line: text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd),
        text: text.slice(l.range.start, l.range.end),
        resolution: l.resolution,
        reason: l.data?.reason,
        cause: l.data?.cause,
        assumes: l.data?.assumes,
        libraries: l.libraries,
        targets:
          l.resolution === "resolved"
            ? [symbols.get(l.targetId)]
            : l.resolution === "ambiguous"
              ? l.candidates.map((c) => symbols.get(c.id)).sort()
              : (l.data?.targets ?? []).map((t) => `${t.file}#${t.key}`),
        targetFiles:
          l.resolution === "resolved"
            ? [symbols.get(l.targetId).split("#")[0]]
            : l.resolution === "ambiguous"
              ? l.candidates.map((c) => symbols.get(c.id).split("#")[0])
              : (l.data?.targets ?? []).map((t) => t.file),
      });
    }
    return { report, links };
  } finally {
    store.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Indexes `files` clean and with `broken` replacing some of them, for
 * fixtures that exercise the attribution rules. It checks, for every link of
 * a valid file: identical to the clean index (maybe plus the flag), or
 * `invalid-code` naming a broken file with a `via`. Checker-dependent
 * library links are flagged and unresolved. Source-proved library bindings
 * retain the exact identity. A link whose clean
 * target is in a broken file fails, naming it. That is STRICTER than the
 * contract (W2-D.md), which requires equality only of unflagged links: a
 * flagged link may differ from the clean index, and the known-limit
 * fixtures, whose flagged links do differ, do not use this helper.
 */
async function differential(files, broken, unflaggedFiles = []) {
  const clean = await indexFiles(files);
  const bad = await indexFiles({ ...files, ...broken });
  const brokenPaths = new Set(Object.keys(broken));
  for (const path of brokenPaths)
    assert.ok(bad.report.failed.includes(path), `${path} fails`);
  const counts = {
    failed: 0,
    flagged: 0,
    unflagged: 0,
    changedTarget: 0,
    changedReason: 0,
  };
  const problems = [];
  const causeFiles = (cause) =>
    cause?.file ? [cause.file] : (cause?.files ?? []);
  for (const [key, c] of clean.links) {
    if (brokenPaths.has(c.file)) continue;
    const b = bad.links.get(key);
    assert.ok(b, `link ${key} exists in both`);
    const intoBroken = c.targetFiles.filter((f) => brokenPaths.has(f));
    if (b.reason === "invalid-code") {
      counts.failed++;
      const causes = causeFiles(b.cause);
      if (!causes.length || causes.some((f) => !brokenPaths.has(f)))
        problems.push(`${key}: failed with cause ${JSON.stringify(b.cause)}`);
      if (b.targets.length) problems.push(`${key}: failed but names targets`);
      if (!b.cause?.via)
        problems.push(`${key}: failed without a justification`);
      for (const f of intoBroken)
        if (!causes.includes(f)) problems.push(`${key}: cause lacks ${f}`);
      continue;
    }
    if (intoBroken.length)
      problems.push(
        `${key} (${c.text} in ${c.line.trim()}): clean target in ${intoBroken} but broken is ${b.resolution} ${b.reason}`,
      );
    if (c.resolution === "library" && b.resolution === "library") {
      assert.deepEqual(
        b.libraries,
        c.libraries,
        `${key}: unchanged library identity`,
      );
      assert.ok(
        b.libraries.every((target) =>
          ["import-path", "import-binding"].includes(target.evidence),
        ),
        `${key}: independent source proof`,
      );
      counts.unflagged++;
      continue;
    }
    if (
      c.resolution === "library" &&
      b.assumes?.includes("no-unseen-declarations")
    ) {
      assert.equal(
        b.resolution,
        "unresolved",
        `${key}: unverified library link`,
      );
      assert.deepEqual(
        b.targets,
        [],
        `${key}: unverified library link has no target`,
      );
      counts.flagged++;
      continue;
    }
    if (JSON.stringify(c.targets) !== JSON.stringify(b.targets)) {
      counts.changedTarget++;
      problems.push(
        `${key} (${c.text} in ${c.line.trim()}): target ${c.targets} -> ${b.targets}`,
      );
    } else if (c.reason !== b.reason) {
      counts.changedReason++;
      problems.push(
        `${key} (${c.text} in ${c.line.trim()}): reason ${c.reason} -> ${b.reason}`,
      );
    }
    // K3: the remaining answers depend on the potentially unseen declarations.
    if (b.assumes?.includes("no-unseen-declarations")) counts.flagged++;
    else {
      counts.unflagged++;
      if (!unflaggedFiles.includes(c.file))
        problems.push(
          `${key} (${c.text} in ${c.line.trim()}): ${b.resolution} ${b.reason ?? ""} is not flagged`,
        );
    }
  }
  return { counts, problems, clean, bad };
}

/** The single link with text `at` on the line containing `marker` in `file`. */
function linkAt(result, file, marker, at, kind = "calls") {
  const found = [...result.links.values()].filter(
    (l) =>
      l.file === file &&
      l.kind === kind &&
      l.text === at &&
      l.line.includes(marker),
  );
  assert.equal(found.length, 1, `one ${kind} ${at} on ${marker} in ${file}`);
  return found[0];
}
const isFailed = (link, cause, what) => {
  assert.equal(
    link.reason,
    "invalid-code",
    `${what}: ${link.resolution} ${link.reason}`,
  );
  assert.deepEqual(link.targets, [], `${what}: no targets`);
  const { via, ...files } = link.cause ?? {};
  assert.deepEqual(files, cause, `${what}: cause`);
  assert.ok(typeof via === "string" && via.length, `${what}: via`);
};
const isResolved = (link, target, what) => {
  assert.equal(link.resolution, "resolved", `${what}: ${link.reason}`);
  assert.deepEqual(link.targets, [target], what);
};

const TAINT_FILES = {
  "tsconfig.json":
    '{ "compilerOptions": { "allowJs": true, "jsx": "preserve", "strict": true } }\n',
  "bad.ts": [
    "export class Base { m() {} static s() {} }",
    "export interface BaseI { m(): void }",
    "export const holder = { inner() {} };",
    "export function Widget() { return null; }",
    "",
  ].join("\n"),
  "oo.ts":
    "export interface OtherI { m(): void; n(): void }\nexport class OtherC { m() {} }\n",
  "bad2.ts": "export interface X { m(): void; }\n",
  "bad.cts": "function x() {}\nexport = x;\n",
  "barrel.cts": 'import x = require("./bad.cjs");\nexport = x;\n',
  "use.cts": 'import x = require("./barrel.cjs");\nx(); // 2b\n',
  "badc.cjs": "exports.x = function () {};\n",
  "barrelc.cjs": 'module.exports = require("./badc.cjs");\n',
  "usec.cjs": 'const b = require("./barrelc.cjs");\nb.x(); // 2c\n',
  "bad3.ts": "export function x3() {}\nexport type T3 = number;\n",
  "barrel3.ts":
    'export { x3 } from "./bad3"; // 3\nexport type { T3 } from "./bad3"; // 3t\n',
  "job.ts":
    "export class Job { getState() {} other() {} }\nexport function helper() {}\n",
  "queue.ts":
    'import { Job } from "./job";\nexport class Queue { add(): Job { return null as any; } }\n',
  "broken.js": "exports.x = function () {};\n",
  "eqmid.ts": 'import b = require("./broken.js");\nexport = b;\n',
  "useeq.ts": 'import m = require("./eqmid.js");\nm.x(); // eq\n',
  "gns.ts": "namespace N { export function a() {} }\n",
  "dg.ts": "export {};\ndeclare global { function globalThing(): void; }\n",
  "a2.ts": 'import { Base } from "./bad";\nexport class A2 extends Base {}\n',
  "b2.ts": 'import { A2 } from "./a2";\nexport class B2 extends A2 {}\n',
  "d.ts": 'import { Base } from "./bad";\nexport default new Base();\n',
  "comp.tsx":
    'import { Widget } from "./bad";\nexport const el = <Widget />; // jsx\n',
  "use2.ts": [
    'import type { X } from "./bad2";',
    "type Y = X;",
    "declare let x: Y;",
    "x.m(); // 2a",
    "",
  ].join("\n"),
  "usej.ts": [
    'import { Queue } from "./queue";',
    "export async function run() {",
    "  const j = new Queue().add();",
    "  j.getState(); // job-state",
    '  const m = await import("./job");',
    "  m.helper(); // dynamic",
    "}",
    "",
  ].join("\n"),
  "use.ts": [
    'import { Base, BaseI } from "./bad";',
    'import * as ns from "./bad";',
    'import { OtherI, OtherC } from "./oo";',
    'import { B2 } from "./b2";',
    'import dflt from "./d";',
    "class Other { m() {} }",
    "interface Derived extends Other {}",
    "class Derived extends Base {}",
    "new Derived().m(); // derived",
    "interface I extends BaseI, OtherI {}",
    "declare const i: I;",
    "i.m(); // merged-interface",
    "class K extends Base {}",
    "interface K extends OtherC {}",
    "new K().m(); // k-merge",
    "declare const t: BaseI & OtherI;",
    "t.m(); // intersection",
    'interface J extends Pick<BaseI, "m">, OtherI {}',
    "declare const jj: J;",
    "jj.m(); // pick",
    "const b = new Base();",
    "b.m(); // variable",
    "function make(): Base { return null as any; }",
    "make().m(); // return-type",
    "function make2() { return new Base(); }",
    "make2().m(); // inferred-return",
    "class Box<T> { value!: T; }",
    "declare const box: Box<Base>;",
    "box.value.m(); // generic",
    "class Impl implements BaseI { m() {} own2() {} }",
    "new Impl().own2(); // impl-own",
    "declare const viaI: BaseI;",
    "viaI.m(); // via-interface",
    "new B2().m(); // chain",
    "dflt.m(); // default",
    "ns.holder.inner(); // namespace",
    "class Own extends Base { own() {} }",
    "new Own().own(); // own",
    "N.a(); // global-namespace",
    "globalThing(); // declare-global",
    "class Clean { c() {} }",
    "new Clean().c(); // control",
    "",
  ].join("\n"),
};
const TAINT_BROKEN = {
  "bad.ts": TAINT_FILES["bad.ts"] + "const bad = (;\n",
  "bad2.ts": TAINT_FILES["bad2.ts"] + "const bad = (;\n",
  "bad.cts": TAINT_FILES["bad.cts"] + "const bad = (;\n",
  "badc.cjs": TAINT_FILES["badc.cjs"] + "var bad = (;\n",
  "bad3.ts": TAINT_FILES["bad3.ts"] + "const bad = (;\n",
  "job.ts":
    "export class Job { getState() {} bad(x: , y) {} }\nexport function helper() {}\n",
  "broken.js": TAINT_FILES["broken.js"] + "var bad = (;\n",
  "gns.ts": TAINT_FILES["gns.ts"] + "const bad = (;\n",
  "dg.ts": TAINT_FILES["dg.ts"] + "const bad = (;\n",
};

test("a failure passes through every lookup that depends on it (clean vs broken)", async () => {
  const { counts, problems, clean, bad } = await differential(
    TAINT_FILES,
    TAINT_BROKEN,
  );
  assert.deepEqual(problems, []);
  assert.equal(counts.changedTarget, 0);
  assert.equal(counts.changedReason, 0);
  const pick = (result) =>
    linkAt(result, "use.ts", "interface J extends Pick", "Pick", "extends");
  assert.equal(pick(clean).resolution, "library");
  assert.equal(pick(bad).resolution, "unresolved");
  assert.deepEqual(pick(bad).assumes, ["no-unseen-declarations"]);
  const one = (file) => ({ file });
  const failedAt = (file, marker, at, cause, kind) =>
    isFailed(linkAt(bad, file, marker, at, kind), one(cause), marker);
  // Reviewer 1 and the Opus heritage/merge cases.
  for (const [marker, at] of [
    ["// derived", "m"],
    ["// merged-interface", "m"],
    ["// k-merge", "m"],
    ["// intersection", "m"],
    ["// pick", "m"],
    ["// variable", "m"],
    ["// return-type", "m"],
    ["// inferred-return", "m"],
    ["// generic", "m"],
    ["// via-interface", "m"],
    ["// chain", "m"],
    ["// default", "m"],
    ["// namespace", "inner"],
  ])
    failedAt("use.ts", marker, at, "bad.ts");
  failedAt("use2.ts", "// 2a", "m", "bad2.ts");
  failedAt("use.cts", "// 2b", "x", "bad.cts");
  failedAt("usec.cjs", "// 2c", "x", "badc.cjs");
  failedAt("barrel3.ts", "// 3", "x3", "bad3.ts", "exports");
  failedAt("barrel3.ts", "// 3t", "T3", "bad3.ts", "exports");
  failedAt("usej.ts", "// job-state", "getState", "job.ts");
  failedAt("usej.ts", "// dynamic", "helper", "job.ts");
  failedAt("useeq.ts", "// eq", "x", "broken.js");
  failedAt("use.ts", "// global-namespace", "a", "gns.ts");
  failedAt("use.ts", "// declare-global", "globalThing", "dg.ts");
  failedAt("comp.tsx", "// jsx", "Widget", "bad.ts");
  // Own members of a tainted class stay resolved, flagged; so does a control.
  isResolved(linkAt(bad, "use.ts", "// own", "own"), "use.ts#Own.own", "own");
  isResolved(
    linkAt(bad, "use.ts", "// impl-own", "own2"),
    "use.ts#Impl.own2",
    "impl-own",
  );
  // A binding of a valid declaration whose value depends on a failed file
  // names that declaration correctly: resolved, flagged.
  isResolved(
    linkAt(bad, "use.ts", 'import dflt from "./d"', "dflt", "imports"),
    "d.ts#default",
    "default-export binding",
  );
  const control = linkAt(bad, "use.ts", "// control", "c");
  isResolved(control, "use.ts#Clean.c", "control");
  assert.ok(control.assumes.includes("no-unseen-declarations"));
});

test("TypeScript-only syntax in a JS file is a syntax error: the file fails", async () => {
  await project(
    {
      "tsonly.js":
        "export enum E { A = 1 }\nexport interface I { m(): void }\nexport function f(x: number) { return x as number; }\n",
      "use.js": 'import { f } from "./tsonly.js";\nf(1); // f\n',
    },
    async (graph, report) => {
      assert.ok(report.failed.includes("tsonly.js"));
      assert.deepEqual(graph.store.findSymbols({ file: "tsonly.js" }), []);
      failedLink(
        callOn(graph, "use.js", "// f", "f"),
        { file: "tsonly.js" },
        "f",
      );
    },
  );
});

test("the first syntax error's position is tsc's: a byte-order mark is not a column", async () => {
  await project({ "bom.ts": "﻿let a = ;\n" }, async (graph, report) => {
    assert.ok(report.failed.includes("bom.ts"));
    assert.match(
      graph.store.getFile("bom.ts").result.diagnostics[0].message,
      /^Syntax error at line 1, column 9: Expression expected\./,
    );
  });
});

test("tied configs: a variant that failed makes the merged link failed with the union of causes", async () => {
  const config = (target) =>
    `{ "files": ["use.ts"], "compilerOptions": { "baseUrl": ".", "paths": { "@provider": ["./${target}"] } } }\n`;
  for (const [a, b] of [
    ["ok.ts", "broken.ts"],
    ["broken.ts", "ok.ts"],
  ])
    await project(
      {
        "ok.ts": "export function value() {}\n",
        "broken.ts": "export function value() {}\nconst x = (;\n",
        "use.ts": 'import { value } from "@provider";\nvalue(); // v\n',
        "tsconfig.a.json": config(a),
        "tsconfig.b.json": config(b),
      },
      async (graph) => {
        failedLink(
          callOn(graph, "use.ts", "// v", "value"),
          { file: "broken.ts" },
          `${a}, ${b}`,
        );
      },
    );
});

test("a failed file is served to programs as absent, not as empty text", async () => {
  const ts = (await import("typescript")).default;
  const { projectModel } = await import(
    "../dist/graph/languages/typescript/project.js"
  );
  const files = [
    { path: "bad.ts", text: "export const a = (;\n" },
    { path: "use.ts", text: 'import { a } from "./bad";\n' },
  ];
  const model = projectModel(files, []);
  const group = model.groups.find((g) => g.roots.length);
  const host = model.host(group);
  const program = ts.createProgram({
    rootNames: group.roots,
    options: group.options,
    host,
  });
  assert.ok(model.syntaxFailures.has("bad.ts"));
  assert.equal(
    host.getSourceFile("/bad.ts", ts.ScriptTarget.Latest),
    undefined,
  );
  assert.equal(program.getSourceFile("/bad.ts"), undefined);
  assert.ok(model.requested(host).has("bad.ts"));
  // The file still exists for module resolution: an import of it is an
  // import of a broken file, not of a missing one.
  assert.ok(host.fileExists("/bad.ts"));
});

test("each dependency kind carries the failure (the member's name is not in the failed file)", async () => {
  const files = {
    "local.ts":
      "export interface Local { q(): void }\nexport class LocalC { q() {} }\n",
    "fx.ts": [
      'import { Local, LocalC } from "./local";',
      "export interface X extends Local {}",
      "export class C extends LocalC {}",
      "",
    ].join("\n"),
    "dflt.ts": 'import { C } from "./fx";\nexport default new C();\n',
    "eqv.ts": 'import { C } from "./fx";\nconst v = new C();\nexport = v;\n',
    "eqx.ts": 'import { C } from "./fx";\nexport = new C();\n',
    "usek.ts": [
      'import { X, C } from "./fx";',
      'import d from "./dflt";',
      'import eqv = require("./eqv");',
      'import eqx = require("./eqx");',
      "declare const a: X;",
      "a.q(); // annotation",
      "type AY = X;",
      "declare const ay: AY;",
      "ay.q(); // alias-body",
      "interface H extends X {}",
      "declare const h: H;",
      "h.q(); // heritage",
      "const ini = new C();",
      "ini.q(); // initializer",
      "function rt(): C { return null as any; }",
      "rt().q(); // return-type",
      "function ir() { return new C(); }",
      "ir().q(); // inferred-return",
      "eqv.q(); // export-equals",
      "eqx.q(); // expression-export",
      "d.q(); // default-export",
      "function first<T extends C>(v: T): T { return v; }",
      "first(null as any).q(); // constraint",
      "",
    ].join("\n"),
  };
  const { problems, bad } = await differential(files, {
    "fx.ts": files["fx.ts"] + "const bad = (;\n",
  });
  assert.deepEqual(problems, []);
  for (const marker of [
    "annotation",
    "alias-body",
    "heritage",
    "initializer",
    "return-type",
    "inferred-return",
    "export-equals",
    "expression-export",
    "default-export",
    "constraint",
  ])
    isFailed(
      linkAt(bad, "usek.ts", `// ${marker}`, "q"),
      { file: "fx.ts" },
      marker,
    );
});

test("a call's result carries the failure of its arguments' types", async () => {
  const gen = "export class Job<A, B, C> { a!: A; }\n";
  const files = {
    "gen.ts": gen,
    "use.ts": [
      'import { Job } from "./gen";',
      "declare const arr: Promise<Job<any, any, string>>[];",
      "export async function all() {",
      "  const [last] = (await Promise.all(arr)).splice(-1); // args",
      "}",
      "",
    ].join("\n"),
  };
  const { problems, bad } = await differential(files, {
    "gen.ts": gen + "const bad = (;\n",
  });
  assert.deepEqual(problems, []);
  isFailed(
    linkAt(bad, "use.ts", "// args", "splice"),
    { file: "gen.ts" },
    "splice",
  );
});

test("arguments decide only overloads and generic results: a correct link is not thrown away", async () => {
  const bad = "export class Base { m() {} }\n";
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Base } from "./bad";',
      "class Local { lm() {} }",
      "class Q { add(x: Base): number { return 1; } }",
      "declare const q: Q;",
      "declare const b: Base;",
      "q.add(b); // single-signature",
      "interface O { f(x: Base): void; }",
      "interface O { f(x: string): void; }",
      "declare const o: O;",
      "o.f(b); // overloaded",
      "function gen<T>(v: T): T { return v; }",
      "gen(b).toString(); // generic-result",
      "function plain(x: Base): Local { return new Local(); }",
      "plain(b).lm(); // plain-result",
      "",
    ].join("\n"),
  };
  const { problems, bad: broken } = await differential(files, {
    "bad.ts": bad + "const x = (;\n",
  });
  assert.deepEqual(problems, []);
  // Rule 1: one declaration decides the call whatever its arguments.
  const single = linkAt(broken, "use.ts", "// single-signature", "add");
  isResolved(single, "use.ts#Q.add", "single signature");
  assert.ok(single.assumes.includes("no-unseen-declarations"));
  // Rule 1: distinct overload targets are picked by the arguments.
  const overloaded = linkAt(broken, "use.ts", "// overloaded", "f");
  isFailed(overloaded, { file: "bad.ts" }, "overloaded");
  assert.match(overloaded.cause.via, /^argument b of overloaded o\.f$/);
  // Rule 2: a generic callee's result carries its argument's failure.
  isFailed(
    linkAt(broken, "use.ts", "// generic-result", "toString"),
    { file: "bad.ts" },
    "generic result",
  );
  // Rule 2: a non-generic single signature's result does not.
  isResolved(
    linkAt(broken, "use.ts", "// plain-result", "lm"),
    "use.ts#Local.lm",
    "plain result",
  );
});

test("type arguments of a class or interface keep its members; a type alias's arguments decide them", async () => {
  const bad =
    "export class Base { m() {} }\nexport interface BaseI { m(): void }\n";
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Base, BaseI } from "./bad";',
      "class Holder<T> { x() {} item!: T; }",
      "declare const h: Holder<Base>;",
      "h.x(); // class-argument",
      "h.item.m(); // member-typed-by-argument",
      "declare const list: Base[];",
      "list[0].m(); // element",
      'declare const p: Pick<BaseI, "m">;',
      "p.m(); // alias-argument",
      "declare const v: unknown;",
      "(v as Base).m(); // assertion",
      "class Local { lm() {} }",
      "declare const q: Holder<Base>;",
      "(q as any as Local).lm(); // assertion-any",
      "",
    ].join("\n"),
  };
  const { problems, bad: broken } = await differential(files, {
    "bad.ts": bad + "const x = (;\n",
  });
  assert.deepEqual(problems, []);
  // Members of a class do not depend on its type arguments.
  isResolved(
    linkAt(broken, "use.ts", "// class-argument", "x"),
    "use.ts#Holder.x",
    "class argument",
  );
  // A member typed by the argument, an element, a type alias's argument
  // and an asserted type do.
  for (const [marker, at] of [
    ["// member-typed-by-argument", "m"],
    ["// element", "m"],
    ["// alias-argument", "m"],
    ["// assertion", "m"],
  ])
    isFailed(linkAt(broken, "use.ts", marker, at), { file: "bad.ts" }, marker);
  // An assertion replaces the expression's type: no dependence remains.
  isResolved(
    linkAt(broken, "use.ts", "// assertion-any", "lm"),
    "use.ts#Local.lm",
    "asserted type",
  );
});

test("each route the failure travels, and each that keeps a correct answer", async () => {
  const job = [
    "export class Job { getState() {} }",
    "export function makeJob(): Job { return new Job(); }",
    "",
  ].join("\n");
  const files = {
    "job.ts": job,
    "use.ts": [
      'import { Job } from "./job";',
      'import type { Missing } from "uncaptured-package";',
      "class LocalBase { lm() {} }",
      "class Sub extends LocalBase {}",
      // Routes that carry the failure.
      "declare const jobs: Job[];",
      "jobs.map((j) => j.getState()); // contextual-receiver",
      "interface Events { done: (job: Job) => void }",
      "declare function on<K extends keyof Events>(k: K, l: Events[K]): void;",
      'on("done", (job) => job.getState()); // contextual-type',
      "for (const j of jobs) j.getState(); // for-of",
      "interface Tree { job: Job }",
      "declare const tree: Tree;",
      "const { job } = tree;",
      "job.getState(); // destructured",
      "class Maker<T> { make(): Job { return null as any; } t!: T; }",
      "declare const maker: Maker<number>;",
      "const made = maker.make();",
      "made.getState(); // instantiated",
      // Routes that keep a correct answer (inherited members: strong taint
      // would fail them).
      "class Holder<T> extends LocalBase { item!: T; }",
      "declare const holder: Holder<Job>;",
      "holder.lm(); // class-type-argument",
      "declare const factory: { new (p: (j: Job) => void): Sub };",
      "const built = new factory(() => {});",
      "built.lm(); // signature-parameter",
      "function plain(x: Job): Sub { return new Sub(); }",
      "declare const aJob: Job;",
      "plain(aJob).lm(); // plain-result",
      "const stored = plain(aJob);",
      "stored.lm(); // stored-plain",
      "const asserted = aJob as unknown as Sub;",
      "asserted.lm(); // assertion-stored",
      "class Q2<T> { client!: Missing; t!: T; }",
      "declare const q2: Q2<Job>;",
      "const client = q2.client;",
      "client.scard(); // member-object",
      "q2.client.scard(); // direct-member-object",
      "function plainMissing(x: Job): Missing { return null as any; }",
      "const fromPlain = plainMissing(aJob);",
      "fromPlain.scard(); // plain-missing",
      "",
    ].join("\n"),
  };
  const { problems, bad } = await differential(files, {
    "job.ts": job + "const x = (;\n",
  });
  assert.deepEqual(problems, []);
  for (const marker of [
    "contextual-receiver",
    "contextual-type",
    "for-of",
    "destructured",
    "instantiated",
  ])
    isFailed(
      linkAt(bad, "use.ts", `// ${marker}`, "getState"),
      { file: "job.ts" },
      marker,
    );
  for (const marker of [
    "class-type-argument",
    "signature-parameter",
    "plain-result",
    "stored-plain",
    "assertion-stored",
  ])
    isResolved(
      linkAt(bad, "use.ts", `// ${marker}`, "lm"),
      "use.ts#LocalBase.lm",
      marker,
    );
  // Unresolved for a reason that has nothing to do with job.ts (an
  // uncaptured package): no cause.
  for (const marker of [
    "member-object",
    "direct-member-object",
    "plain-missing",
  ]) {
    const link = linkAt(bad, "use.ts", `// ${marker}`, "scard");
    assert.notEqual(link.reason, "invalid-code", marker);
    assert.equal(link.cause, undefined, marker);
  }
});

// ----- Round 14: the structural rule -----

const keeps = (link, what) => {
  assert.notEqual(
    link.reason,
    "invalid-code",
    `${what}: kept (failed via ${link.cause?.via})`,
  );
  assert.equal(link.cause, undefined, `${what}: no cause`);
};

test("the structural rule: the receiver's type decides, in both directions", async () => {
  const bad = [
    "export class Failed { m() {} kind!: string; }",
    'export interface FailedI { m(): void; kind: "failed" }',
    "export function failedFn(): Failed { return new Failed(); }",
    "",
  ].join("\n");
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Failed, FailedI, failedFn } from "./bad";',
      "class A { m() {} }",
      "class B { m() {} }",
      "class LocalBase { lm() {} }",
      // Sol 1: a type-level computation over a tainted argument.
      'class Box<T> { value!: keyof T extends "kind" ? A : B; plain!: T; many!: T[]; count!: number; }',
      "declare let bx: Box<FailedI>;",
      "bx.value.m(); // computed",
      "bx.plain.m(); // member-T",
      "bx.many.map((x) => x); // member-array",
      "bx.many[0].m(); // member-array-element",
      "bx.count.toFixed(); // member-number",
      "declare const map: Map<string, Failed>;",
      'map.get("k")!.m(); // map-get',
      'map.has("k"); // map-has',
      "declare const promise: Promise<Failed>;",
      "promise.then((v) => v.m()); // promise-then",
      "function make(): (j: Failed) => void { return () => {}; }",
      "make().call(null, null as any); // returned-function",
      'declare const pk: Pick<FailedI, "m">;',
      "pk.m(); // pick",
      "declare const rt: ReturnType<typeof failedFn>;",
      "rt.m(); // return-type-of",
      "declare const un: A | Failed;",
      "un.m(); // union",
      // Sol 4: library members keep their answers.
      "function factory<T>(x: T): T[] { return [x]; }",
      "declare let fb: Failed;",
      "factory(fb).map((x) => x); // factory-map",
      "function sandbox() { return function process(job: Failed): void {}; }",
      "sandbox().bind(null); // sandbox-bind",
      "export async function all() {",
      "  (await Promise.all([new Failed()])).map((x) => x); // promise-all",
      "}",
      // Opus 6: a returned closure's body is not its type.
      "export const make2 = () => () => { new Failed(); return 1; };",
      "make2().call(null); // closure-body",
      // Opus 1: overloads and computing generics with a weakly tainted argument.
      "interface PA { method(): number }",
      "interface PB { method(): string }",
      "declare const cb: (j: Failed) => void;",
      "declare function pick2(x: (j: number) => void): PB;",
      "declare function pick2(x: (j: Failed) => void): PA;",
      "pick2(cb).method(); // overload",
      "type Sel<T> = T extends (j: number) => void ? PB : PA;",
      "declare function sel<T>(x: T): Sel<T>;",
      "sel(cb).method(); // generic-computation",
      // Overloads that all give one untainted class: its member set decides,
      // until the result is awaited or read from (its type arguments then
      // depend on the overload chosen).
      "class Wk {",
      "  constructor(n: string, p: (j: Failed) => void);",
      "  constructor(n: string);",
      "  constructor(n: string, p?: (j: Failed) => void) {}",
      "  on() {}",
      "  getF(): Failed { return null as any; }",
      "}",
      'const wk = new Wk("q", (j) => {});',
      "wk.on(); // ctor-overload",
      "declare function boxed(x: (j: number) => void): Promise<A>;",
      "declare function boxed(x: (j: Failed) => void): Promise<B>;",
      "boxed(cb).then(() => {}); // same-class-overload",
      "export async function awaited() {",
      "  (await boxed(cb)).m(); // awaited-overload",
      "}",
      // A computation's inputs decide, not the receiver's route.
      "declare const itc: InstanceType<typeof Wk>;",
      "itc.on(); // instance-type-clean",
      "itc.getF().m(); // instance-type-member",
      "declare const itf: InstanceType<typeof Failed>;",
      "itf.m(); // instance-type-failed",
      "declare const cw: Required<{ k(): void }> & { p: Promise<Failed> };",
      "cw.k(); // computation-clean-input",
      "declare const mw: Map<Partial<A>, Failed>;",
      "mw.forEach(() => {}); // computation-beside-taint",
      // An own member stands even when the failed file has that name.
      "class D2 extends Failed { m() {} }",
      "new D2().m(); // own-member-named-in-failed",
      // A function type with a failed parameter is a tainted input of a
      // computation over it (iii): accepted over-fail.
      "type Proc = (j: Failed) => string;",
      "declare const pr: ReturnType<Proc>;",
      "pr.trim(); // return-of-function-type",
      "declare const pp: Parameters<Proc>;",
      "pp[0].m(); // parameter-of-function-type",
      // A closure's body is not its type: it returns `any`, untainted.
      'const mk = () => { new Failed(); return JSON.parse("1"); };',
      "mk().foo(); // closure-any",
      // Sol 3: a long chain reaches its fixpoint.
      ...Array.from(
        { length: 90 },
        (_, i) => `const x${89 - i} = ${i === 89 ? "Failed" : `x${88 - i}`};`,
      ),
      "new x89().m(); // long-chain",
      "",
    ].join("\n"),
  };
  const { problems, bad: broken } = await differential(files, {
    "bad.ts": bad + "const x = (;\n",
  });
  assert.deepEqual(problems, []);
  const failedOn = [
    ["computed", "m"],
    ["member-T", "m"],
    ["member-array-element", "m"],
    ["map-get", "m"],
    ["promise-then", "m"],
    ["pick", "m"],
    ["return-type-of", "m"],
    ["union", "m"],
    ["promise-all", "map"],
    ["overload", "method"],
    ["generic-computation", "method"],
    ["awaited-overload", "m"],
    ["instance-type-failed", "m"],
    ["parameter-of-function-type", "m"],
    ["instance-type-member", "m"],
    ["return-of-function-type", "trim"],
    ["long-chain", "m"],
  ];
  for (const [marker, at] of failedOn)
    isFailed(
      linkAt(broken, "use.ts", `// ${marker}`, at),
      { file: "bad.ts" },
      marker,
    );
  for (const [marker, at] of [
    ["member-array", "map"],
    ["member-number", "toFixed"],
    ["map-has", "has"],
    ["promise-then", "then"],
    ["returned-function", "call"],
    ["factory-map", "map"],
    ["sandbox-bind", "bind"],
    ["closure-body", "call"],
    ["ctor-overload", "on"],
    ["same-class-overload", "then"],
    ["instance-type-clean", "on"],
    ["computation-clean-input", "k"],
    ["computation-beside-taint", "forEach"],
    ["own-member-named-in-failed", "m"],
    ["closure-any", "foo"],
  ])
    keeps(linkAt(broken, "use.ts", `// ${marker}`, at), marker);
});

test("failed scripts, declare global, import types and reference paths carry the failure", async () => {
  const script =
    "namespace N { export class C { m() {} } export function a() {} }\n";
  const global =
    "export {};\ndeclare global { interface Thing { m(): void } interface Window { fromBad(): void } }\n";
  const helper = "export function helper() {}\nexport function helperX() {}\n";
  const files = {
    "tsconfig.json": '{ "compilerOptions": { "lib": ["es2020", "dom"] } }\n',
    "ns.ts": script,
    "dg.ts": global,
    "mod.ts": helper,
    "ref.ts": "declare function refd(): void;\n",
    "use.ts": [
      "declare let n: N.C;",
      "n.m(); // ns-member",
      "N.a(); // ns-function",
      "declare const th: Thing;",
      "th.m(); // global-interface",
      'import "./dg";',
      "window.fromBad(); // global-merge",
      'type TI = typeof import("./mod");',
      "declare const ti: TI;",
      "ti.helper(); // import-type",
      "",
    ].join("\n"),
    "use-module.ts":
      "export {};\ndeclare let n3: N.C;\nn3.m(); // module-consumer\n",
    "use-bare.ts": 'import "./mod";\nhelperX(); // module-name\n',
    "use-ref.ts": '/// <reference path="./ref.ts" />\nrefd(); // ref-call\n',
  };
  const broken = {
    "ns.ts": script + "const x = (;\n",
    "dg.ts": global + "const x = (;\n",
    "mod.ts": helper + "const x = (;\n",
    "ref.ts": "declare function refd(): void;\nconst x = (;\n",
  };
  const { problems, bad } = await differential(files, broken);
  assert.deepEqual(problems, []);
  isFailed(
    linkAt(bad, "use.ts", "// ns-member", "m"),
    { file: "ns.ts" },
    "ns member",
  );
  isFailed(
    linkAt(bad, "use.ts", "// ns-function", "a"),
    { file: "ns.ts" },
    "ns function",
  );
  isFailed(
    linkAt(bad, "use-module.ts", "// module-consumer", "m"),
    { file: "ns.ts" },
    "module consumer",
  );
  isFailed(
    linkAt(bad, "use.ts", "// global-interface", "m"),
    { file: "dg.ts" },
    "declare global",
  );
  isFailed(
    linkAt(bad, "use.ts", "// global-merge", "fromBad"),
    { file: "dg.ts" },
    "global merge",
  );
  isFailed(
    linkAt(bad, "use.ts", "// import-type", "helper"),
    { file: "mod.ts" },
    "import type",
  );
  // A failed module's own top-level names are not globals: no cause.
  keeps(linkAt(bad, "use-bare.ts", "// module-name", "helperX"), "module name");
  // A reference path to a failed file is broken, not missing.
  const reference = [...bad.links.values()].find(
    (l) => l.file === "use-ref.ts" && l.kind === "imports",
  );
  assert.equal(reference.reason, "invalid-code");
  assert.equal(reference.cause.file, "ref.ts");
});

test("through a member set that reaches a failed file, only members declared in the receiver's own declarations stand (O1)", async () => {
  const bad =
    "export class Base { m() {} }\nexport interface BaseI { m(): void }\n";
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Base, BaseI } from "./bad";',
      "class A { m() {} }",
      "class Other { own() {} m() {} child(): A { return new A(); } }",
      "interface Derived extends Other {}",
      "class Derived extends Base { mine() {} }",
      "new Derived().own(); // derived-own",
      "new Derived().m(); // derived-m",
      "new Derived().mine(); // derived-mine",
      "new Derived().child().m(); // through-inherited",
      "interface Merged { merged(): void }",
      "class Merged extends Base {}",
      "declare const mg: Merged;",
      "mg.merged(); // merged-own",
      "interface I extends BaseI, Other { declared(): void }",
      "declare const i: I;",
      "i.own(); // interface-own",
      "i.m(); // interface-m",
      "i.declared(); // interface-declared",
      "",
    ].join("\n"),
  };
  const { problems, bad: broken } = await differential(files, {
    "bad.ts": bad + "const x = (;\n",
  });
  assert.deepEqual(problems, []);
  // Inherited through any base, failed or valid: fails (accepted over-fail
  // for `own`, which only the valid `Other` declares).
  for (const [marker, at] of [
    ["derived-own", "own"],
    ["interface-own", "own"],
    ["derived-m", "m"],
    ["interface-m", "m"],
    // The chain continues past an inherited member: it fails too.
    ["through-inherited", "m"],
  ])
    isFailed(
      linkAt(broken, "use.ts", `// ${marker}`, at),
      { file: "bad.ts" },
      marker,
    );
  // Declared directly in the class body or a merged declaration's body.
  isResolved(
    linkAt(broken, "use.ts", "// derived-mine", "mine"),
    "use.ts#Derived.mine",
    "derived-mine",
  );
  isResolved(
    linkAt(broken, "use.ts", "// merged-own", "merged"),
    "use.ts#Merged.merged",
    "merged-own",
  );
  isResolved(
    linkAt(broken, "use.ts", "// interface-declared", "declared"),
    "use.ts#I.declared",
    "interface-declared",
  );
});

test("a failed base also has the members it inherits and computes: no token test (O1)", async () => {
  const bad = [
    'import { Root, Src } from "./root";',
    "export class Base extends Root {}",
    "export interface BaseI extends Readonly<Src> {}",
    "",
  ].join("\n");
  const files = {
    "root.ts":
      "export class Root { m() {} }\nexport interface Src { r(): void }\n",
    "bad.ts": bad,
    "use.ts": [
      'import { Base, BaseI } from "./bad";',
      "export class Other { m() {} r() {} }",
      "class Derived extends Base {}",
      "interface Derived extends Other {}",
      "new Derived().m(); // root-member",
      "interface DI extends BaseI, Other {}",
      "declare const di: DI;",
      "di.r(); // computed-member",
      "",
    ].join("\n"),
  };
  const { problems, bad: broken } = await differential(files, {
    "bad.ts": bad + "const x = (;\n",
  });
  assert.deepEqual(problems, []);
  isFailed(
    linkAt(broken, "use.ts", "// root-member", "m"),
    { file: "bad.ts" },
    "root-member",
  );
  isFailed(
    linkAt(broken, "use.ts", "// computed-member", "r"),
    { file: "bad.ts" },
    "computed-member",
  );
});

test("JSDoc import types in JS files carry the failure", async () => {
  const bad = "export class Failed { m() {} }\n";
  const files = {
    "tsconfig.json":
      '{ "compilerOptions": { "allowJs": true, "checkJs": false } }\n',
    "bad.ts": bad,
    "use.js": [
      '/** @type {import("./bad").Failed} */',
      "let jf;",
      "jf.m(); // jsdoc-at-type",
      '/** @typedef {import("./bad").Failed} F */',
      "/** @type {F} */",
      "let jt;",
      "jt.m(); // jsdoc-typedef",
      '/** @returns {import("./bad").Failed} */',
      "function mk() { return undefined; }",
      "mk().m(); // jsdoc-returns",
      "",
    ].join("\n"),
  };
  const { problems, bad: broken } = await differential(files, {
    "bad.ts": bad + "const x = (;\n",
  });
  assert.deepEqual(problems, []);
  for (const marker of ["jsdoc-at-type", "jsdoc-typedef", "jsdoc-returns"])
    isFailed(
      linkAt(broken, "use.js", `// ${marker}`, "m"),
      { file: "bad.ts" },
      marker,
    );
});

/** Indexes clean and broken, checks the differential, and returns the broken index. */
async function brokenOf(files, broken) {
  const { problems, bad } = await differential(files, broken);
  assert.deepEqual(problems, []);
  return bad;
}
const failsWith = (link, cause, via, what) => {
  isFailed(link, cause, what);
  if (via)
    assert.ok(link.cause.via.includes(via), `${what}: via ${link.cause.via}`);
};

test("default-deny: the four reproductions of round 13 (Sol)", async () => {
  const bad = 'export interface Failed { kind: "yes" }\n';
  const aliases = Array.from(
    { length: 12 },
    (_, i) => `type C${i + 1}<T> = C${i}<T>;`,
  );
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Failed } from "./bad";',
      "class A { m() {} }",
      "class B { m() {} }",
      // 1. Element access with a literal key, and an index signature.
      'class Box<T> { value!: keyof T extends "kind" ? A : B; self(): this { return this; } }',
      "declare let b: Box<Failed>;",
      'b["value"].m(); // element-literal',
      'class IBox<T> { [key: string]: keyof T extends "kind" ? A : B; }',
      "declare let ib: IBox<Failed>;",
      'ib["anything"].m(); // index-signature',
      // 2. A method returning `this` keeps the receiver's type arguments.
      "b.self().value.m(); // this-method",
      // 3. No depth limit on alias expansion.
      'type C0<T> = keyof T extends "kind" ? A : B;',
      ...aliases,
      "class Deep<T> { value!: C12<T>; }",
      "declare let deep: Deep<Failed>;",
      "deep.value.m(); // alias-chain",
      // 4. A type parameter is tainted only if its argument is.
      "class Two<T, U> { value!: T extends string ? A : B; u!: U; }",
      "declare let two: Two<string, Failed>;",
      "two.value.m(); // untainted-parameter",
      "",
    ].join("\n"),
  };
  const broken = await brokenOf(files, {
    "bad.ts": bad + "const broken = (;\n",
  });
  for (const marker of [
    "element-literal",
    "index-signature",
    "this-method",
    "alias-chain",
  ])
    isFailed(
      linkAt(broken, "use.ts", `// ${marker}`, "m"),
      { file: "bad.ts" },
      marker,
    );
  isResolved(
    linkAt(broken, "use.ts", "// untainted-parameter", "m"),
    "use.ts#A.m",
    "untainted-parameter",
  );
});

test("O2: an overload whose parameter type depends on a failed file is not chosen, whatever the arguments", async () => {
  const bad = "export class Job { x() {} }\n";
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Job } from "./bad";',
      "export class A { m() {} }",
      "export class B { m() {} }",
      "declare function k(x: Job): A;",
      "declare function k(x: number): B;",
      "declare let n: number;",
      "k(n).m(); // direct",
      "const r = k(n);",
      "r.m(); // variable",
      "class W<T> { val!: T; }",
      "declare function f(x: Job): W<A>;",
      "declare function f(x: number): W<B>;",
      "f(n).val.m(); // member-of-result",
      "class S { pick(x: Job): A; pick(x: number): B; pick(x: unknown): A | B { return null as any; } }",
      "new S().pick(n).m(); // method",
      // Routes: destructuring, assignment, conditional, comma, ??, ||,
      // a wrapper, element access, a callback parameter.
      "const { val: dv } = f(n);",
      "dv.m(); // destructuring",
      "let as2: A | B = new A();",
      "(as2 = k(n)).m(); // assignment",
      "declare const flag: boolean;",
      "(flag ? k(n) : k(n)).m(); // conditional",
      "(0, k(n)).m(); // comma",
      "(k(n) ?? k(n)).m(); // nullish",
      "(k(n) || k(n)).m(); // or",
      "function wrap() { return k(n); }",
      "wrap().m(); // wrapper",
      "[k(n)][0].m(); // element",
      "[k(n)].forEach((x) => x.m()); // callback",
      // One signature: nothing to choose.
      "declare function one(x: Job): A;",
      "one(n).m(); // single-signature",
      // R-1: every overload returns the same class: its member set decides.
      "declare function same(x: Job): A;",
      "declare function same(x: number): A;",
      "same(n).m(); // same-class",
      "",
    ].join("\n"),
  };
  const broken = await brokenOf(files, {
    "bad.ts": bad + "const broken = (;\n",
  });
  for (const marker of [
    "direct",
    "variable",
    "member-of-result",
    "method",
    "destructuring",
    "assignment",
    "conditional",
    "comma",
    "nullish",
    "or",
    "wrapper",
    "element",
    "callback",
  ])
    failsWith(
      linkAt(broken, "use.ts", `// ${marker}`, "m"),
      { file: "bad.ts" },
      "parameter types depend on the failed file",
      marker,
    );
  isResolved(
    linkAt(broken, "use.ts", "// single-signature", "m"),
    "use.ts#A.m",
    "single-signature",
  );
  isResolved(
    linkAt(broken, "use.ts", "// same-class", "m"),
    "use.ts#A.m",
    "same-class",
  );
});

test("R-1 does not need the shared class to be untainted: its member set rule decides (M6)", async () => {
  const bad = "export class Job { x() {} inherited() {} }\n";
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Job } from "./bad";',
      "export class TD extends Job { own() {} }",
      "declare function same(x: Job): TD;",
      "declare function same(x: number): TD;",
      "declare let n: number;",
      "same(n).own(); // own-member",
      "same(n).inherited(); // inherited-member",
      "",
    ].join("\n"),
  };
  const broken = await brokenOf(files, {
    "bad.ts": bad + "const broken = (;\n",
  });
  isResolved(
    linkAt(broken, "use.ts", "// own-member", "own"),
    "use.ts#TD.own",
    "own-member",
  );
  isFailed(
    linkAt(broken, "use.ts", "// inherited-member", "inherited"),
    { file: "bad.ts" },
    "inherited-member",
  );
});

test("O3: `this` denotes the receiver with its type arguments, along every route", async () => {
  const bad = "export class Failed { m() {} }\n";
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Failed } from "./bad";',
      "class TT<T> { self(): this { return this; } v!: T; }",
      "declare let t: TT<Failed>;",
      "t.v.m(); // control",
      "t.self().v.m(); // self",
      "const s = t.self();",
      "s.v.m(); // variable",
      "const { v: dv } = t.self();",
      "dv.m(); // destructuring",
      "declare const flag: boolean;",
      "(flag ? t.self() : t).v.m(); // conditional",
      "(0, t.self()).v.m(); // comma",
      "(t.self() ?? t).v.m(); // nullish",
      "function wrap() { return t.self(); }",
      "wrap().v.m(); // wrapper",
      "[t.self()][0].v.m(); // element",
      "[t.self()].forEach((x) => x.v.m()); // callback",
      "",
    ].join("\n"),
  };
  const broken = await brokenOf(files, {
    "bad.ts": bad + "const broken = (;\n",
  });
  for (const marker of [
    "control",
    "self",
    "variable",
    "destructuring",
    "conditional",
    "comma",
    "nullish",
    "wrapper",
    "element",
    "callback",
  ])
    isFailed(
      linkAt(broken, "use.ts", `// ${marker}`, "m"),
      { file: "bad.ts" },
      marker,
    );
});

test("default-deny: each explicit case, in both directions", async () => {
  const bad = "export class Failed { m() {} }\n";
  const files = {
    "bad.ts": bad,
    "ok.ts": "export class Fine { m() {} }\n",
    "use.ts": [
      'import { Failed } from "./bad";',
      "class A { m() {} n!: number; }",
      "class Box<T> { t!: T; a!: A; count!: number; self(): this { return this; } get gt(): T { return null as any; } get ga(): A { return new A(); } }",
      "declare const bf: Box<Failed>;",
      "declare const flag: boolean;",
      // Expressions.
      "const idT = bf.t;",
      "idT.m(); // e-identifier-fail",
      "const idA = bf.a;",
      "idA.m(); // e-identifier-keep",
      "class HF { f!: Failed; a!: A; run() {",
      "  this.f.m(); // e-this-fail",
      "  this.a.m(); // e-this-keep",
      "} }",
      "class SubB extends Box<Failed> { run() {",
      "  super.self().t.m(); // e-super-fail",
      "  super.self().a.m(); // e-super-keep",
      "} }",
      'bf["t"].m(); // e-element-fail',
      'bf["a"].m(); // e-element-keep',
      'declare const key: "t" | "a";',
      "bf[key].m(); // e-element-computed",
      "new Box<Failed>().t.m(); // e-new-fail",
      "new Box<Failed>().a.m(); // e-new-keep",
      "declare function tag(s: TemplateStringsArray): Box<Failed>;",
      "tag`x`.t.m(); // e-tagged-fail",
      "tag`x`.a.m(); // e-tagged-keep",
      "declare const pbf: Promise<Box<Failed>>;",
      "export async function aw() {",
      "  (await pbf).t.m(); // e-await-fail",
      "  (await pbf).a.m(); // e-await-keep",
      "}",
      "declare const u: unknown;",
      "(u as Box<Failed>).t.m(); // e-as-fail",
      "(bf as unknown as Box<A>).t.m(); // e-as-keep",
      "(<Box<Failed>>u).t.m(); // e-assertion-fail",
      "(bf satisfies object).t.m(); // e-satisfies-fail",
      "(bf satisfies object).a.m(); // e-satisfies-keep",
      "(flag ? bf : bf).t.m(); // e-conditional-fail",
      "(flag ? bf : bf).a.m(); // e-conditional-keep",
      "(bf || bf).t.m(); // e-binary-fail",
      "(bf || bf).a.m(); // e-binary-keep",
      "(bf.a.n + bf.count).toFixed(); // e-arithmetic-keep",
      "[bf][0].t.m(); // e-array-fail",
      "[bf][0].a.m(); // e-array-keep",
      "({ v: bf }).v.t.m(); // e-object-fail",
      "({ v: bf }).v.a.m(); // e-object-keep",
      "(() => bf)().t.m(); // e-arrow-fail",
      "(() => bf)().a.m(); // e-arrow-keep",
      "(function () { return bf; })().t.m(); // e-function-fail",
      "(function () { return bf; })().a.m(); // e-function-keep",
      "new (class { b = bf; })().b.t.m(); // e-class-fail",
      "new (class { b = bf; })().b.a.m(); // e-class-keep",
      // Types (members of a container over the failed type).
      'class W<T> { arr!: T[]; tup!: [A, T]; named!: [a: A, t: T]; opt!: [A, T?]; rest!: [A, ...T[]]; par!: (T); fn!: (x: T) => A; fnr!: () => T; ctor!: new () => T; lit!: { t: T; a: A }; uni!: T | A; inter!: T & A; ro!: readonly T[]; cond!: T extends object ? A : A; cond2!: string extends string ? A : A; imp!: import("./ok").Fine; }',
      "declare const w: W<Failed>;",
      "w.arr[0].m(); // t-array-fail",
      "w.arr.length.toFixed(); // t-array-keep",
      "w.tup[1].m(); // t-tuple-fail",
      "w.tup[0].m(); // t-tuple-keep",
      "w.named[1].m(); // t-named-fail",
      "w.named[0].m(); // t-named-keep",
      "w.opt[1]!.m(); // t-optional-fail",
      "w.rest[1]!.m(); // t-rest-fail",
      "w.par.m(); // t-paren-fail",
      "w.fn(null!).m(); // t-function-keep",
      "w.fnr().m(); // t-function-fail",
      "new w.ctor().m(); // t-constructor-fail",
      "w.lit.t.m(); // t-literal-fail",
      "w.lit.a.m(); // t-literal-keep",
      "w.uni.m(); // t-union-fail",
      "w.inter.m(); // t-intersection-fail",
      "w.ro[0].m(); // t-readonly-fail",
      "w.ro.length.toFixed(); // t-readonly-keep",
      "w.cond.m(); // t-conditional-fail",
      "w.cond2.m(); // t-conditional-keep",
      "w.imp.m(); // t-import-keep",
      // Declarations.
      "function pf(p: Box<Failed>) {",
      "  p.t.m(); // d-parameter-fail",
      "  p.a.m(); // d-parameter-keep",
      "}",
      "const { t: dt, a: da } = bf;",
      "dt.m(); // d-binding-fail",
      "da.m(); // d-binding-keep",
      "const t = bf;",
      "({ t }).t.t.m(); // d-shorthand-fail",
      "({ t }).t.a.m(); // d-shorthand-keep",
      "interface I<T> { get(): T; a: A }",
      "declare const ii: I<Failed>;",
      "ii.get().m(); // d-method-signature-fail",
      "ii.a.m(); // d-property-signature-keep",
      "bf.gt.m(); // d-getter-fail",
      "bf.ga.m(); // d-getter-keep",
      // Contextual parameters.
      "declare const arrF: Failed[];",
      "arrF.forEach((x) => x.m()); // c-call-fail",
      "class Runner<T> { constructor(run: (x: T) => void, a: (y: A) => void) {} }",
      "new Runner<Failed>((x) => x.m(), (y) => y.m()); // c-new",
      "const cbf: (x: Failed) => void = (x) => x.m(); // c-variable-fail",
      "const cba: (x: A) => void = (x) => x.m(); // c-variable-keep",
      // Elements.
      "declare const setF: Set<Failed>;",
      "for (const s of setF) s.m(); // l-set-fail",
      "declare const mapF: Map<A, Failed>;",
      "for (const [k, v] of mapF) {",
      "  k.m(); // l-map-keep",
      "  v.m(); // l-map-fail",
      "}",
      "",
    ].join("\n"),
  };
  const broken = await brokenOf(files, {
    "bad.ts": bad + "const broken = (;\n",
  });
  const lines = files["use.ts"].split("\n");
  const markers = lines.flatMap((line) =>
    [...line.matchAll(/\/\/ ([a-z]-[a-z0-9-]+)/g)].map((m) => m[1]),
  );
  for (const marker of markers) {
    if (marker === "c-new") continue;
    const at =
      marker.startsWith("t-array-keep") || marker.startsWith("t-readonly-keep")
        ? "toFixed"
        : marker === "e-arithmetic-keep"
          ? "toFixed"
          : "m";
    const link = linkAt(broken, "use.ts", marker, at);
    if (marker.endsWith("-fail") || marker === "e-element-computed")
      isFailed(link, { file: "bad.ts" }, marker);
    else keeps(link, marker);
  }
  // A constructor's callback parameters: the first is the failed type.
  const runner = [...broken.links.values()].filter(
    (l) => l.file === "use.ts" && l.line.includes("// c-new") && l.text === "m",
  );
  assert.equal(runner.length, 2);
  isFailed(runner[0], { file: "bad.ts" }, "c-new x");
  keeps(runner[1], "c-new y");
});

test("default-deny: each default branch fails a kind it does not handle", async () => {
  const bad = "export class Failed { m() {} }\n";
  const files = {
    "tsconfig.json":
      '{ "compilerOptions": { "allowJs": true, "checkJs": false, "target": "es2020", "lib": ["es2020"] } }\n',
    "bad.ts": bad,
    "box.ts":
      'import { Failed } from "./bad";\nexport class Box<T> { t!: T; }\nexport declare const bf: Box<Failed>;\n',
    "use.ts": [
      'import { Failed } from "./bad";',
      'import { bf } from "./box";',
      // expression: yield
      "export function* gen() { (yield bf).t.m(); /* default-expression */ }",
      // declaration: a set-only accessor
      "class SA<T> { set w(x: T) {} }",
      "declare const sa: SA<Failed>;",
      "sa.w.m(); // default-declaration",
      // contextual: a callback in an object literal property
      "declare function takes(o: { f: (x: Failed) => void }): void;",
      "takes({ f: (x) => x.m() }); // default-contextual",
      // element: a project iterable
      "class Bag<T> { *[Symbol.iterator](): Iterator<T> { } }",
      "declare const bag: Bag<Failed>;",
      "for (const x of bag) x.m(); // default-element",
      // await: a project thenable
      "class Th<T> { then(r: (v: T) => void) { } }",
      "declare const th: Th<Failed>;",
      "export async function aw() { (await th).m(); /* default-await */ }",
      // call: a generator's result
      "function* g2() { yield bf; }",
      "g2().next(); // default-call",
      "",
    ].join("\n"),
    "use.js": [
      'import { bf } from "./box";',
      "/** @type {?import('./box').Box<import('./bad').Failed>} */",
      "let jn = bf;",
      "jn.t.m(); // default-type",
      "",
    ].join("\n"),
  };
  const broken = await brokenOf(files, {
    "bad.ts": bad + "const broken = (;\n",
  });
  const cases = [
    [
      "use.ts",
      "default-expression",
      "m",
      "unhandled expression YieldExpression",
    ],
    ["use.ts", "default-declaration", "m", "unhandled declaration SetAccessor"],
    [
      "use.ts",
      "default-contextual",
      "m",
      "unhandled contextual PropertyAssignment",
    ],
    ["use.ts", "default-element", "m", "unhandled element Bag"],
    ["use.ts", "default-await", "m", "unhandled await Th"],
    ["use.ts", "default-call", "next", "unhandled call a generator"],
    ["use.js", "default-type", "m", "unhandled type JSDocNullableType"],
  ];
  for (const [file, marker, at, via] of cases)
    failsWith(
      linkAt(broken, file, marker, at),
      { file: "bad.ts" },
      via,
      marker,
    );
});

test("default-deny: the handled kinds of each switch are listed", async () => {
  await indexFiles({ "a.ts": "export const a = 1;\n" });
  const { HANDLED } = await import(
    "../dist/graph/languages/typescript/judge.js"
  );
  // Only kinds with an explicit case; everything else is FAILED.
  assert.deepEqual(HANDLED, {
    types: [
      "AnyKeyword",
      "UnknownKeyword",
      "NumberKeyword",
      "BigIntKeyword",
      "BooleanKeyword",
      "StringKeyword",
      "SymbolKeyword",
      "VoidKeyword",
      "UndefinedKeyword",
      "NeverKeyword",
      "ObjectKeyword",
      "IntrinsicKeyword",
      "LiteralType",
      "TypePredicate",
      "ThisType",
      "TypeReference",
      "ExpressionWithTypeArguments",
      "ArrayType",
      "TupleType",
      "NamedTupleMember",
      "OptionalType",
      "RestType",
      "ParenthesizedType",
      "FunctionType",
      "ConstructorType",
      "TypeLiteral",
      "UnionType",
      "IntersectionType",
      "TypeOperator",
      "ConditionalType",
      "MappedType",
      "IndexedAccessType",
      "InferType",
      "TemplateLiteralType",
      "TypeQuery",
      "ImportType",
    ],
    expressions: [
      "Identifier",
      "ThisKeyword",
      "SuperKeyword",
      "QualifiedName",
      "PropertyAccessExpression",
      "ElementAccessExpression",
      "CallExpression",
      "NewExpression",
      "TaggedTemplateExpression",
      "AwaitExpression",
      "ParenthesizedExpression",
      "NonNullExpression",
      "AsExpression",
      "TypeAssertionExpression",
      "SatisfiesExpression",
      "ConditionalExpression",
      "BinaryExpression",
      "ArrayLiteralExpression",
      "ObjectLiteralExpression",
      "FunctionExpression",
      "ArrowFunction",
      "ClassExpression",
      "StringLiteral",
      "NumericLiteral",
      "BigIntLiteral",
      "NoSubstitutionTemplateLiteral",
      "TemplateExpression",
      "RegularExpressionLiteral",
      "TrueKeyword",
      "FalseKeyword",
      "NullKeyword",
      "PrefixUnaryExpression",
      "PostfixUnaryExpression",
      "TypeOfExpression",
      "VoidExpression",
      "DeleteExpression",
      "MetaProperty",
    ],
    declarations: [
      "VariableDeclaration",
      "Parameter",
      "BindingElement",
      "PropertyDeclaration",
      "PropertySignature",
      "PropertyAssignment",
      "ShorthandPropertyAssignment",
      "MethodDeclaration",
      "MethodSignature",
      "FunctionDeclaration",
      "FunctionExpression",
      "ArrowFunction",
      "GetAccessor",
      "IndexSignature",
      "EnumMember",
      "EnumDeclaration",
      "ClassDeclaration",
      "ClassExpression",
      "ModuleDeclaration",
      "SourceFile",
    ],
    contextual: [
      "CallExpression",
      "NewExpression",
      "VariableDeclaration",
      "PropertyDeclaration",
      "ExpressionStatement",
    ],
    element: [
      "failed",
      "clean",
      "union",
      "tuple",
      "checked",
      "object (library iterables)",
    ],
    await: [
      "failed",
      "clean",
      "union",
      "checked",
      "object (library promises, non-thenables)",
      "literal (non-thenable)",
      "other non-thenables",
    ],
    call: [
      "failed",
      "clean",
      "checked",
      "function",
      "static (new of a class)",
      "object (call/construct signatures)",
      "literal (call/construct signatures)",
      "union",
    ],
  });
});

test("O2 at the call link: distinct targets with a failed parameter type fail; a tainted argument does too", async () => {
  const bad = "export class Job { x() {} }\n";
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Job } from "./bad";',
      "export class A { m() {} }",
      "export class B { m() {} }",
      "interface I1 { f(x: Job): A }",
      "interface I2 { f(x: number): B }",
      "declare const u12: I1 | I2;",
      "declare let n: number;",
      "u12.f(n as never); // union-targets",
      // Neither signature mentions the failed file: the argument decides.
      "declare function pk3(x: number): A;",
      "declare function pk3(x: unknown): B;",
      "declare const fv: Job;",
      "pk3(fv).m(); // tainted-argument",
      "",
    ].join("\n"),
  };
  const broken = await brokenOf(files, {
    "bad.ts": bad + "const broken = (;\n",
  });
  failsWith(
    linkAt(broken, "use.ts", "// union-targets", "f"),
    { file: "bad.ts" },
    "overloaded callee whose parameter types depend on the failed file",
    "union-targets",
  );
  failsWith(
    linkAt(broken, "use.ts", "// tainted-argument", "m"),
    { file: "bad.ts" },
    "with a tainted argument",
    "tainted-argument",
  );
});

test("a member set reaches a failed file through any number of heritage steps (no pass limit)", async () => {
  const bad = "export class Failed { m() {} }\n";
  const chain = Array.from(
    { length: 90 },
    (_, i) => `class H${i + 1} extends H${i} {}`,
  );
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Failed } from "./bad";',
      "class V { v() {} }",
      "class H0 extends Failed {}",
      ...chain,
      "interface H90 extends V {}",
      "new H90().v(); // deep-heritage",
      "",
    ].join("\n"),
  };
  const broken = await brokenOf(files, {
    "bad.ts": bad + "const broken = (;\n",
  });
  isFailed(
    linkAt(broken, "use.ts", "// deep-heritage", "v"),
    { file: "bad.ts" },
    "deep-heritage",
  );
});

test("heritage through a name only a failed script declares taints the member set (O1)", async () => {
  const script = "class SC { m() {} }\n";
  const files = {
    "sc.ts": script,
    "use.ts": [
      "export {};",
      "class V { v() {} }",
      "class D extends SC {}",
      "interface D extends V {}",
      "new D().v(); // script-heritage",
      "",
    ].join("\n"),
  };
  const broken = await brokenOf(files, {
    "sc.ts": script + "const broken = (;\n",
  });
  isFailed(
    linkAt(broken, "use.ts", "// script-heritage", "v"),
    { file: "sc.ts" },
    "script-heritage",
  );
});

test("operators and computed keys keep only plainly clean operands (B1)", async () => {
  const bad =
    'export interface Failed { kind: "yes"; count: number; big: bigint; big2: bigint; key: "a" }\n';
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Failed } from "./bad";',
      "class A { m() {} }",
      "class B { m() {} }",
      "declare const f: Failed;",
      "declare function k(x: bigint): A;",
      "declare function k(x: number): B;",
      "k(-f.big).m(); // b1-negate",
      "k(f.big - f.big2).m(); // b1-subtract",
      "let i = f.big;",
      "k(i++).m(); // b1-postfix",
      "declare function k2(x: number): A;",
      "declare function k2(x: string): B;",
      "k2(f.count + 1).m(); // b1-add",
      "const r = k2(f.count + 1);",
      "r.m(); // b1-variable",
      "declare const obj: { a: A; b: B };",
      "obj[f.key].m(); // b1-key",
      "(f.count + 1).toFixed(); // b1-number",
      // An operand that is a container over the failed type (not failed
      // itself, not plainly clean).
      "class Box<T> { t!: T; }",
      "declare const bx: Box<Failed>;",
      'k2(bx + "").m(); // b1-object-operand',
      // A computed key that is not plainly clean, on objects whose own
      // judgement is clean or the checker's (only the key check fails these).
      "class C2 { a!: A; b!: B; }",
      'declare const p: Pick<C2, "a" | "b">;',
      "p[f.key].m(); // b1-pick-key",
      "declare const s: string;",
      "s[f.count].toUpperCase(); // b1-string-key",
      'declare const rec: Record<"a" | "b", A>;',
      "rec[f.key].m(); // b1-record-key",
      'declare const mapped: { [K in "a" | "b"]: A };',
      "mapped[f.key].m(); // b1-mapped-key",
      // Plainly clean operands and keys keep.
      "declare const n: number;",
      "k2(n + 1).m(); // b1-clean-add",
      'declare const key: "a" | "b";',
      "obj[key].m(); // b1-clean-key",
      "",
    ].join("\n"),
  };
  const broken = await brokenOf(files, {
    "bad.ts": bad + "const broken = (;\n",
  });
  for (const [marker, at] of [
    ["b1-negate", "m"],
    ["b1-subtract", "m"],
    ["b1-postfix", "m"],
    ["b1-add", "m"],
    ["b1-variable", "m"],
    ["b1-key", "m"],
    ["b1-number", "toFixed"],
    ["b1-object-operand", "m"],
    ["b1-pick-key", "m"],
    ["b1-string-key", "toUpperCase"],
    ["b1-record-key", "m"],
    ["b1-mapped-key", "m"],
  ])
    isFailed(
      linkAt(broken, "use.ts", `// ${marker}`, at),
      { file: "bad.ts" },
      marker,
    );
  isResolved(
    linkAt(broken, "use.ts", "// b1-clean-add", "m"),
    "use.ts#A.m",
    "b1-clean-add",
  );
  keeps(linkAt(broken, "use.ts", "// b1-clean-key", "m"), "b1-clean-key");
});

// Known limits (the contract for a program with a failed file, W2-D.md):
// a link the module cannot attribute to the failed file is FLAGGED
// `no-unseen-declarations` (unverified: computed without the failed file)
// and may differ from the clean index. Each case pins that it is flagged
// and what it gives today, with the clean index's answer for the record.
const knownLimitFiles = (() => {
  const bad = [
    'export interface Failed { kind: "yes" }',
    "export declare function isF(v: unknown): v is Failed;",
    "export declare function assertF(v: unknown): asserts v is Failed;",
    'export const KIND_A = "a";',
    'export enum Kind { A = "a", B = "b" }',
    "",
  ].join("\n");
  return {
    bad,
    use: [
      'import { Failed, isF, assertF, KIND_A, Kind } from "./bad";',
      'class A { m() {} kind!: "a" }',
      'class B { m() {} kind!: "b" }',
      "class Param { value!: Failed }",
      "function pick(x: Param): A;",
      "function pick(x: { value: number }): B;",
      "function pick(x: unknown): A | B { return new A(); }",
      "pick({ value: 123 }).m(); // kl-structural-overload",
      "type Select<T> = T extends { value: number } ? A : B;",
      "declare let sel: Select<Param>;",
      "sel.m(); // kl-structural-computation",
      "declare const x: A | B;",
      "if (isF(x)) x.m(); // kl-guard-union",
      "declare const y: B;",
      "if (isF(y)) y.m(); // kl-guard-single",
      "declare const z: A | B;",
      "assertF(z); z.m(); // kl-asserts",
      "declare const w1: A | B;",
      "if (w1.kind === KIND_A) w1.m(); // kl-constant",
      "declare const w2: A | B;",
      "if (w2.kind === Kind.A) w2.m(); // kl-enum",
      "declare const w3: A | B;",
      "switch (w3.kind) { case Kind.B: w3.m(); } // kl-switch",
      "",
    ].join("\n"),
  };
})();
let knownLimitIndex;
const knownLimitBroken = () =>
  (knownLimitIndex ??= indexFiles({
    "bad.ts": knownLimitFiles.bad + "const broken = (;\n",
    "use.ts": knownLimitFiles.use,
  }));
for (const [marker, title, today] of [
  [
    "kl-structural-overload",
    "overload selection through a class property's type (clean B.m)",
    { resolution: "resolved", targets: ["use.ts#A.m"] },
  ],
  [
    "kl-structural-computation",
    "a conditional type over a class whose member type is failed (clean B.m)",
    { resolution: "resolved", targets: ["use.ts#A.m"] },
  ],
  [
    "kl-guard-union",
    "narrowing by a type guard declared in the failed file (clean no-symbol)",
    { resolution: "ambiguous", targets: ["use.ts#A.m", "use.ts#B.m"] },
  ],
  [
    "kl-guard-single",
    "a type guard that narrows to never when readable (clean no-symbol)",
    { resolution: "resolved", targets: ["use.ts#B.m"] },
  ],
  [
    "kl-asserts",
    "an assertion function declared in the failed file (clean no-symbol)",
    { resolution: "ambiguous", targets: ["use.ts#A.m", "use.ts#B.m"] },
  ],
  [
    "kl-constant",
    "narrowing by `=== KIND_A`, a constant of the failed file (clean A.m)",
    { resolution: "ambiguous", targets: ["use.ts#A.m", "use.ts#B.m"] },
  ],
  [
    "kl-enum",
    "narrowing by `=== Kind.A`, an enum of the failed file (clean A.m)",
    { resolution: "ambiguous", targets: ["use.ts#A.m", "use.ts#B.m"] },
  ],
  [
    "kl-switch",
    "narrowing by `switch … case Kind.B` (clean B.m)",
    { resolution: "ambiguous", targets: ["use.ts#A.m", "use.ts#B.m"] },
  ],
])
  test(`known limit: ${title}`, async () => {
    const link = linkAt(
      await knownLimitBroken(),
      "use.ts",
      `// ${marker}`,
      "m",
    );
    // The requirement: the link is flagged unverified.
    assert.ok(
      link.assumes?.includes("no-unseen-declarations"),
      `${marker}: flagged (${JSON.stringify(link.assumes)})`,
    );
    assert.notEqual(link.reason, "invalid-code", `${marker}: not attributed`);
    // What it gives today (recorded so that a change is visible).
    assert.equal(link.resolution, today.resolution, `${marker}: resolution`);
    assert.deepEqual(link.targets, today.targets, `${marker}: targets`);
  });

test("K3: in a program with a failed file, unresolved links are flagged too", async () => {
  const bad = "export class Failed { m() {} }\n";
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import "./bad";',
      'import { gone } from "./missing";',
      'import { readFileSync } from "node:fs";',
      "undeclaredName(); // no-symbol",
      'readFileSync("x"); // external',
      "Math.floor(1); // lib",
      "gone(); // missing-module",
      "export function outer(local: () => number) {",
      "  local(); // local",
      "  return (null as any).whatever(); // any-member",
      "}",
      "",
    ].join("\n"),
  };
  const { clean: intact, bad: broken } = await differential(files, {
    "bad.ts": bad + "const broken = (;\n",
  });
  assert.equal(
    linkAt(intact, "use.ts", "// lib", "floor").resolution,
    "library",
  );
  assert.equal(
    linkAt(broken, "use.ts", "// lib", "floor").resolution,
    "unresolved",
  );
  const seen = new Set();
  const syntaxProofs = [];
  for (const link of broken.links.values()) {
    if (link.file !== "use.ts" || link.reason === "invalid-code") continue;
    if (link.resolution === "library") {
      assert.equal(link.assumes, undefined);
      assert.equal(link.libraries[0].unit, "fs");
      syntaxProofs.push(link.libraries[0].symbol ?? "(module)");
      continue;
    }
    assert.ok(
      link.assumes?.includes("no-unseen-declarations"),
      `${link.text} (${link.resolution} ${link.reason}) is flagged`,
    );
    if (link.resolution === "unresolved") seen.add(link.reason);
  }
  assert.deepEqual(syntaxProofs.sort(), [
    "(module)",
    "readFileSync",
    "readFileSync",
  ]);
  // The unresolved reasons this fixture produces, each flagged.
  for (const reason of ["no-symbol", "external", "local", "missing-module"])
    assert.ok(
      seen.has(reason),
      `an unresolved ${reason} link is covered (${[...seen]})`,
    );
});
