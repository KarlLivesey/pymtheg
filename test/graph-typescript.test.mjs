// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkLanguageConformance,
  discoverLanguages,
} from "../dist/graph/index.js";
import typescript from "../dist/graph/languages/typescript/index.js";

// Conformance of the TypeScript/JavaScript module on the hard-case sample project.
const sampleRoot = fileURLToPath(
  new URL("./fixtures/graph-typescript/sample/", import.meta.url),
);
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}
const texts = Object.fromEntries(
  walk(sampleRoot).map((path) => [
    relative(sampleRoot, path).split("\\").join("/"),
    readFileSync(path, "utf8"),
  ]),
);
const isContext = (path) =>
  /(^|\/)(tsconfig[^/]*|jsconfig[^/]*|package)\.json$/.test(path);
const fixtures = Object.entries(texts).map(([path, text]) => ({
  path,
  text,
  ...(isContext(path) ? { context: true } : {}),
  // A file that cannot be read is not valid code: it has failed.
  ...(path === "src/broken.ts" ? { status: "failed" } : {}),
}));

/** Exact source text from the first `start` to the end of the following `end`. */
function span(file, start, end) {
  const text = texts[file];
  const from = text.indexOf(start);
  assert.ok(from >= 0, `${start} in ${file}`);
  if (end === undefined) return start;
  const to = text.indexOf(end, from + start.length);
  assert.ok(to >= 0, `${end} after ${start} in ${file}`);
  return text.slice(from, to + end.length);
}
/** Range of the nth (0-based) occurrence of `text` in a file. */
function nth(file, text, index) {
  let at = -1;
  for (let i = 0; i <= index; i++) at = texts[file].indexOf(text, at + 1);
  assert.ok(at >= 0);
  return { range: { start: at, end: at + text.length }, at: text };
}

const symbols = [];
const contains = [];
/** Declares a symbol and its expected `contains` link from `parent` (default: the module). */
function sym(
  file,
  kind,
  identity,
  at,
  parent = { name: file, kind: "module" },
) {
  // CommonJS `module.exports` is one name; other identities are dot-qualified.
  const name =
    identity === "module.exports"
      ? identity
      : identity.slice(identity.lastIndexOf(".") + 1);
  const position = typeof at === "string" ? { at } : at;
  symbols.push({ file, name, kind, identity, ...position });
  contains.push({
    file,
    kind: "contains",
    targetName: identity,
    source: parent,
    target: { file, name, kind },
    ...position,
  });
}
const module = (file) =>
  symbols.push({
    file,
    name: file,
    kind: "module",
    identity: file,
    range: { start: 0, end: texts[file].length },
  });

const API = "src/lib/api.ts";
const MAIN = "src/main.ts";
const SHAPES = "src/shapes.ts";
const UTIL = "packages/util/src/index.ts";
for (const file of [
  UTIL,
  "src/lazy.ts",
  "src/legacy.js",
  "src/loader.js",
  API,
  "src/lib/index.ts",
  "src/lib/inner.ts",
  MAIN,
  SHAPES,
  "src/view.tsx",
])
  module(file);
sym(UTIL, "function", "helper", span(UTIL, "export function helper", "\n}"));
// src/broken.ts has a syntax error: failed, it contributes no symbols.
sym("src/lazy.ts", "constant", "lazy", "export const lazy = 1;");
sym(
  "src/legacy.js",
  "function",
  "legacy",
  span("src/legacy.js", "function legacy", "\n}"),
);
sym(
  "src/legacy.js",
  "constant",
  "module.exports",
  "module.exports = { legacy }",
);
// A locally declared require: renamed for the compiler, reported as written.
sym(
  "src/loader.js",
  "function",
  "require",
  span("src/loader.js", "function require", "\n}"),
);
sym(
  "src/loader.js",
  "constant",
  "loaded",
  'export const loaded = require("./lib/api");',
);
sym(API, "interface", "Runner", span(API, "export interface Runner", "\n}"));
const runner = { name: "Runner", kind: "interface" };
sym(API, "method", "Runner.run", "run(): void;", runner);
sym(API, "class", "Base", span(API, "export class Base", "\n}"));
sym(API, "method", "Base.start", "start(): void {}", {
  name: "Base",
  kind: "class",
});
sym(API, "class", "Job", span(API, "export class Job", "\n  }\n}"));
sym(API, "method", "Job.run", span(API, "run(): void {", "\n  }"), {
  name: "Job",
  kind: "class",
});
// One symbol for the whole overload set: first signature through the implementation.
sym(
  API,
  "function",
  "format",
  span(API, "export function format(value: string)", "\n}"),
);
sym(
  API,
  "function",
  "makeJob",
  span(API, "export default function makeJob", "\n}"),
);
sym(
  MAIN,
  "constant",
  "café",
  "export const café: Config = { name: Config.fallback };",
);
sym(MAIN, "function", "main", span(MAIN, "export function main", "\n}"));
sym(SHAPES, "class", "Circle", span(SHAPES, "export class Circle", "\n  }\n}"));
sym(
  SHAPES,
  "method",
  "Circle.area",
  span(SHAPES, "area(): number {\n    return 3;", "\n  }"),
  { name: "Circle", kind: "class" },
);
sym(SHAPES, "class", "Square", span(SHAPES, "export class Square", "\n  }\n}"));
sym(
  SHAPES,
  "method",
  "Square.area",
  span(SHAPES, "area(): number {\n    return 4;", "\n  }"),
  { name: "Square", kind: "class" },
);
sym(
  SHAPES,
  "interface",
  "Config",
  span(SHAPES, "export interface Config", "\n}"),
);
sym(SHAPES, "property", "Config.name", "name: string;", {
  name: "Config",
  kind: "interface",
});
sym(
  SHAPES,
  "namespace",
  "Config",
  span(SHAPES, "export namespace Config", "\n}"),
);
sym(SHAPES, "constant", "Config.fallback", 'export const fallback = "none";', {
  name: "Config",
  kind: "namespace",
});
sym(
  "src/view.tsx",
  "function",
  "Badge",
  span("src/view.tsx", "export function Badge", "\n}"),
);
sym(
  "src/view.tsx",
  "function",
  "App",
  span("src/view.tsx", "export function App", "\n}"),
);

const fileSource = (file) => ({ name: file, kind: "module" });
const target = (file, name, kind) => ({ file, name, kind });
const link = (file, kind, targetName, source, to, at, extra = {}) => ({
  file,
  kind,
  targetName,
  source,
  target: to,
  ...(typeof at === "string" ? { at } : at),
  ...extra,
});
const apiModule = target(API, API, "module");
const format = target(API, "format", "function");
const job = target(API, "Job", "class");
const mainFn = { name: "main", kind: "function" };
const LOADER = "src/loader.js";
const links = [
  // The call goes to the file's own function, not to an import of ./lib/api.
  link(
    LOADER,
    "calls",
    "require",
    { name: "loaded", kind: "constant" },
    target(LOADER, "require", "function"),
    nth(LOADER, "require", 2),
  ),
  ...contains,
  // CommonJS require in a .js file importing a .ts module.
  link(
    "src/legacy.js",
    "imports",
    "./lib/api",
    fileSource("src/legacy.js"),
    apiModule,
    '"./lib/api"',
  ),
  link(
    "src/legacy.js",
    "imports",
    "format",
    fileSource("src/legacy.js"),
    format,
    "format",
  ),
  link(
    "src/legacy.js",
    "calls",
    "format",
    { name: "legacy", kind: "function" },
    format,
    nth("src/legacy.js", "format", 1),
  ),
  // Class extending a base and implementing an interface; `this` call to an inherited method.
  link(
    API,
    "extends",
    "Base",
    { name: "Job", kind: "class" },
    target(API, "Base", "class"),
    nth(API, "Base", 1),
  ),
  link(
    API,
    "implements",
    "Runner",
    { name: "Job", kind: "class" },
    target(API, "Runner", "interface"),
    nth(API, "Runner", 1),
  ),
  link(
    API,
    "calls",
    "this.start",
    { name: "run", kind: "method" },
    target(API, "start", "method"),
    nth(API, "start", 1),
  ),
  link(
    API,
    "calls",
    "String",
    { name: "format", kind: "function" },
    null,
    "String",
  ),
  link(
    API,
    "references",
    "Job",
    { name: "makeJob", kind: "function" },
    job,
    nth(API, "Job", 2),
  ),
  link(
    API,
    "calls",
    "Job",
    { name: "makeJob", kind: "function" },
    job,
    nth(API, "Job", 3),
  ),
  // Two-level barrel: index -> inner -> api, resolved to the original declarations.
  link(
    "src/lib/index.ts",
    "imports",
    "./inner",
    fileSource("src/lib/index.ts"),
    target("src/lib/inner.ts", "src/lib/inner.ts", "module"),
    '"./inner"',
  ),
  link(
    "src/lib/index.ts",
    "exports",
    "format",
    fileSource("src/lib/index.ts"),
    format,
    "format as fmt",
  ),
  link(
    "src/lib/index.ts",
    "exports",
    "Job",
    fileSource("src/lib/index.ts"),
    job,
    nth("src/lib/index.ts", "Job", 0),
  ),
  link(
    "src/lib/index.ts",
    "imports",
    "./api",
    fileSource("src/lib/index.ts"),
    apiModule,
    '"./api"',
  ),
  link(
    "src/lib/index.ts",
    "exports",
    "*",
    fileSource("src/lib/index.ts"),
    apiModule,
    "* as api",
  ),
  link(
    "src/lib/inner.ts",
    "imports",
    "./api",
    fileSource("src/lib/inner.ts"),
    apiModule,
    '"./api"',
  ),
  // paths alias + default import under another name.
  link(MAIN, "imports", "@lib/api", fileSource(MAIN), apiModule, '"@lib/api"'),
  link(
    MAIN,
    "imports",
    "default",
    fileSource(MAIN),
    target(API, "makeJob", "function"),
    nth(MAIN, "createJob", 0),
  ),
  link(
    MAIN,
    "imports",
    "./lib/index",
    fileSource(MAIN),
    target("src/lib/index.ts", "src/lib/index.ts", "module"),
    nth(MAIN, '"./lib/index"', 0),
  ),
  link(MAIN, "imports", "fmt", fileSource(MAIN), format, nth(MAIN, "fmt", 0)),
  link(MAIN, "imports", "Job", fileSource(MAIN), job, nth(MAIN, "Job", 1)),
  // import type
  link(
    MAIN,
    "imports",
    "./lib/api",
    fileSource(MAIN),
    apiModule,
    '"./lib/api"',
  ),
  link(
    MAIN,
    "imports",
    "Runner",
    fileSource(MAIN),
    target(API, "Runner", "interface"),
    nth(MAIN, "Runner", 0),
  ),
  // export * as ns, imported through the barrel.
  link(
    MAIN,
    "imports",
    "./lib/index",
    fileSource(MAIN),
    target("src/lib/index.ts", "src/lib/index.ts", "module"),
    nth(MAIN, '"./lib/index"', 1),
  ),
  link(
    MAIN,
    "imports",
    "api",
    fileSource(MAIN),
    apiModule,
    nth(MAIN, "api", 2),
  ),
  link(
    MAIN,
    "imports",
    "./shapes",
    fileSource(MAIN),
    target(SHAPES, SHAPES, "module"),
    '"./shapes"',
  ),
  link(
    MAIN,
    "imports",
    "Circle",
    fileSource(MAIN),
    target(SHAPES, "Circle", "class"),
    nth(MAIN, "Circle", 0),
  ),
  link(
    MAIN,
    "imports",
    "Square",
    fileSource(MAIN),
    target(SHAPES, "Square", "class"),
    nth(MAIN, "Square", 0),
  ),
  // Declaration merging (interface + namespace): one of these candidates.
  link(
    MAIN,
    "imports",
    "Config",
    fileSource(MAIN),
    null,
    nth(MAIN, "Config", 0),
    {
      candidates: [
        target(SHAPES, "Config", "interface"),
        target(SHAPES, "Config", "namespace"),
      ],
    },
  ),
  // Workspace package import resolved to the other package's source.
  link(
    MAIN,
    "imports",
    "@sample/util",
    fileSource(MAIN),
    target(UTIL, UTIL, "module"),
    '"@sample/util"',
  ),
  link(
    MAIN,
    "imports",
    "helper",
    fileSource(MAIN),
    target(UTIL, "helper", "function"),
    nth(MAIN, "helper", 0),
  ),
  // External package: unresolved, specifier kept.
  link(MAIN, "imports", "chalk", fileSource(MAIN), null, '"chalk"'),
  link(
    MAIN,
    "imports",
    "default",
    fileSource(MAIN),
    null,
    nth(MAIN, "chalk", 0),
  ),
  // In a type position the merged name means the interface.
  link(
    MAIN,
    "references",
    "Config",
    { name: "café", kind: "constant" },
    target(SHAPES, "Config", "interface"),
    nth(MAIN, "Config", 1),
  ),
  link(
    MAIN,
    "references",
    "Runner",
    mainFn,
    target(API, "Runner", "interface"),
    nth(MAIN, "Runner", 1),
  ),
  link(
    MAIN,
    "references",
    "Circle",
    mainFn,
    target(SHAPES, "Circle", "class"),
    nth(MAIN, "Circle", 1),
  ),
  link(
    MAIN,
    "references",
    "Square",
    mainFn,
    target(SHAPES, "Square", "class"),
    nth(MAIN, "Square", 1),
  ),
  link(
    MAIN,
    "calls",
    "createJob",
    mainFn,
    target(API, "makeJob", "function"),
    nth(MAIN, "createJob", 1),
  ),
  // Overloaded function: one symbol, a definite target.
  link(MAIN, "calls", "fmt", mainFn, format, nth(MAIN, "fmt", 1)),
  link(MAIN, "calls", "Job", mainFn, job, nth(MAIN, "Job", 3)),
  link(
    MAIN,
    "calls",
    "(expression).run",
    mainFn,
    target(API, "run", "method"),
    "run",
  ),
  link(MAIN, "calls", "api.format", mainFn, format, nth(MAIN, "format", 0)),
  // Method on a union-typed value: one of these candidates.
  link(MAIN, "calls", "shape.area", mainFn, null, "area", {
    // Selectors carry display names; graph-typescript-resolution checks the two identities.
    candidates: [
      target(SHAPES, "area", "method"),
      target(SHAPES, "area", "method"),
    ],
  }),
  link(
    MAIN,
    "calls",
    "helper",
    mainFn,
    target(UTIL, "helper", "function"),
    nth(MAIN, "helper", 1),
  ),
  link(MAIN, "calls", "chalk", mainFn, null, nth(MAIN, "chalk", 2)),
  // Dynamic import with a literal specifier.
  link(
    MAIN,
    "imports",
    "./lazy",
    mainFn,
    target("src/lazy.ts", "src/lazy.ts", "module"),
    '"./lazy"',
  ),
  // JSX element usage links to the component; the intrinsic <span> does not.
  link(
    "src/view.tsx",
    "calls",
    "Badge",
    { name: "App", kind: "function" },
    target("src/view.tsx", "Badge", "function"),
    nth("src/view.tsx", "Badge", 1),
  ),
];

test("TypeScript module passes the conformance kit on the hard-case sample", async () => {
  await checkLanguageConformance(typescript, fixtures, { symbols, links });
});

test("TypeScript module is discovered in production and claims declaration files", async () => {
  const registry = await discoverLanguages();
  assert.ok(registry.modules.some((module) => module.id === "typescript"));
  for (const path of [
    "a.ts",
    "a.tsx",
    "a.mts",
    "a.cts",
    "a.d.ts",
    "a.d.mts",
    "a.js",
    "a.jsx",
    "a.mjs",
    "a.cjs",
  ])
    assert.equal(registry.claim(path)?.id, "typescript", path);
  assert.equal(registry.claim("tsconfig.json"), undefined);
  assert.equal(registry.claim("a.json"), undefined);
});
