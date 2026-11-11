// Node as the oracle for the scope analysis of `require` (src/graph/languages/
// typescript/rename.ts). Builds a deterministic corpus of small CommonJS and ES
// module files, runs each in one Node child process (sequentially), and
// records, per call site, whether `require("./dep.cjs")` reached the real
// loader ("real"), something local ("local"), or threw ("error").
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const LOCAL = "function require(n) { return __fake(); }";
/** Callee text per site placeholder: S plain, P/Q/M the supported indirect forms. */
export const CALLEES = {
  S: "require",
  P: "(require)",
  Q: "(0, require)",
  M: "module.require",
};
/**
 * A call site: reports what the loader call reaches at this point, and uses
 * a member of the value (`v.real()`), so the emitted member link is checked
 * too. X sites (cross-file consumers) report an expression instead.
 */
const SITE_PREFIX = "{ const v = ";
const siteFor = (id, expression) =>
  `__report(${JSON.stringify(id)}, () => ${SITE_PREFIX}${expression}; v.real(); return v; })`;
const site = (id, form) => siteFor(id, `${CALLEES[form]}("./dep.cjs")`);

/**
 * Templates. `code` uses S0, S1, ... placeholders for call sites. `modes`
 * limits where a template is valid; `category` says how the analysis may
 * differ from Node:
 *  - static: must match exactly;
 *  - dynamic: run-time scope (with, direct eval, reassignment): "uncertain"
 *    is allowed, "real" only where Node says real;
 *  - value-flow: a local binding that receives the real loader's value at run
 *    time; the analysis classifies the binding as local (an import is lost,
 *    never a wrong link);
 *  - base: createRequire with a base other than this file: Node resolves
 *    elsewhere; the analysis says "uncertain" and links nothing;
 *  - bundler: a free `require` in an ES module: Node throws, the analysis
 *    keeps the bundler reading ("real") and must flag every emitted link.
 * Placeholders: S0.. plain `require(...)`; P0 `(require)(...)`; Q0
 * `(0, require)(...)`; M0 `module.require(...)`.
 */
const TEMPLATES = [
  {
    name: "function at top level",
    code: `${LOCAL}\nS0`,
    modes: ["cjs", "cjs-strict"],
  },
  {
    name: "function in a function",
    code: `function g() { ${LOCAL} S0; }\ng();\nS1`,
  },
  {
    name: "function in a block, use inside/after",
    code: `{ ${LOCAL} S0; }\nS1`,
  },
  { name: "function in a block, use before", code: `S0;\n{ ${LOCAL} }` },
  { name: "function in a nested block", code: `{ { ${LOCAL} S0; } S1; }\nS2` },
  {
    name: "function in a block in a function (Annex B)",
    code: `function g() { { ${LOCAL} S0; } S1; }\ng();\nS2`,
  },
  {
    name: "function in a block in a function, use before the block",
    code: `function g() { S0; { ${LOCAL} } }\ng();`,
  },
  {
    name: "block function shadowed by a parameter name",
    code: `function g(require) { { ${LOCAL} S0; } S1; }\ng(__fake);\nS2`,
  },
  {
    name: "block function conflicting with an outer let",
    code: `function g() { let require = __fake; { ${LOCAL} S0; } S1; }\ng();`,
  },
  {
    name: "two same-named functions in one block of a function",
    code: `function g() { { ${LOCAL} ${LOCAL} S0; } S1; }\ng();`,
    modes: ["cjs"],
  },
  {
    name: "same-named functions in nested blocks of a function",
    code: `function g() { { ${LOCAL} { ${LOCAL} S0; } S1; } S2; }\ng();`,
    modes: ["cjs"],
  },
  {
    name: "block function in a function with a catch parameter",
    code: `function g() { try { throw 1; } catch (require) { { ${LOCAL} S0; } } S1; }\ng();`,
    modes: ["cjs"],
  },
  {
    name: "block function in a nested function at top level",
    code: `function g() { function h() { { ${LOCAL} } S0; } h(); S1; }\ng();\nS2`,
  },
  {
    name: "var at top level, before",
    code: `var require = __fake;\nS0`,
    modes: ["cjs", "cjs-strict"],
    category: "dynamic",
  },
  {
    name: "var at top level, after",
    code: `S0;\nvar require = __fake;`,
    modes: ["cjs", "cjs-strict"],
    category: "dynamic",
  },
  {
    name: "var without initializer at top level",
    code: `var require;\nS0`,
    modes: ["cjs", "cjs-strict"],
  },
  {
    name: "var in a function",
    code: `function g() { var require = __fake; S0; }\ng();\nS1`,
  },
  {
    name: "var in a function, use before",
    code: `function g() { S0; var require = __fake; }\ng();`,
  },
  {
    name: "var in a nested block of a function",
    code: `function g() { { var require = __fake; } S0; }\ng();`,
  },
  {
    name: "const in a function",
    code: `function g() { const require = __fake; S0; }\ng();\nS1`,
  },
  {
    name: "let in a function, use before (TDZ)",
    code: `function g() { S0; let require = __fake; }\ng();`,
  },
  {
    name: "let at top level (early error in CommonJS)",
    code: `let require = __fake;\nS0`,
    modes: ["cjs", "cjs-strict"],
  },
  { name: "parameter", code: `function g(require) { S0; }\ng(__fake);\nS1` },
  {
    name: "later default parameter",
    code: `function g(a, require = __fake) { S0; }\ng(1);`,
  },
  {
    name: "use inside a parameter default",
    code: `function g(require = __fake, b = S0) {}\ng();`,
  },
  {
    name: "destructured parameter",
    code: `function g({ require }) { S0; }\ng({ require: __fake });`,
  },
  {
    name: "body var shadowing a parameter",
    code: `function g(require) { var require; S0; }\ng(__fake);`,
  },
  {
    name: "body var shadowing a parameter with expressions",
    code: `function g(require = __fake, x = 1) { var require; S0; }\ng();`,
  },
  {
    name: "catch clause",
    code: `try { throw __fake; } catch (require) { S0; }\nS1`,
  },
  {
    name: "destructured catch clause",
    code: `try { throw { require: __fake }; } catch ({ require }) { S0; }\nS1`,
  },
  {
    name: "class static block var",
    code: `class S { static { var require = __fake; S0; } }\nS1`,
  },
  {
    name: "class static block var, use before",
    code: `class S { static { S0; var require = __fake; } }`,
  },
  {
    name: "class expression name",
    code: `const C = class require { static m() { return S0; } };\nC.m();\nS1`,
  },
  {
    name: "class declaration name in a function",
    code: `function g() { class require { static m() { return S0; } } return require.m(); }\ng();\nS1`,
  },
  {
    name: "function expression name",
    code: `const f = function require(n) { if (n) return __fake(); return S0; };\nf();\nS1`,
  },
  {
    name: "for-of let head",
    code: `for (let require of [__fake]) { S0; }\nS1`,
  },
  {
    name: "for const head",
    code: `for (const require = __fake; ; ) { S0; break; }\nS1`,
  },
  {
    name: "for-of var head in a function",
    code: `function g() { for (var require of [__fake]) { S0; } S1; }\ng();\nS2`,
  },
  {
    name: "for-of var head at top level",
    code: `for (var require of [__fake]) { S0; }\nS1`,
    modes: ["cjs", "cjs-strict"],
    category: "dynamic",
  },
  { name: "labelled block", code: `lbl: { ${LOCAL} S0; }\nS1` },
  {
    name: "labelled function in a function (sloppy only)",
    code: `function g() { lbl: ${LOCAL} S0; }\ng();\nS1`,
    modes: ["cjs"],
  },
  {
    name: "switch case function",
    code: `switch (1) { case 1: ${LOCAL} S0; }\nS1`,
  },
  {
    name: "switch case function in a function, use after",
    code: `function g() { switch (1) { case 1: ${LOCAL} } S0; }\ng();`,
  },
  {
    name: "arrow parameter",
    code: `const g = (require) => S0;\ng(__fake);\nS1`,
  },
  {
    name: "getter",
    code: `const o = { get x() { const require = __fake; return S0; } };\no.x;\nS1`,
  },
  {
    name: "setter parameter",
    code: `const o = { set x(require) { S0; } };\no.x = __fake;\nS1`,
  },
  {
    name: "method",
    code: `const o = { m() { var require = __fake; return S0; } };\no.m();`,
  },
  {
    name: "generator",
    code: `function* g() { const require = __fake; yield S0; }\ng().next();\nS1`,
  },
  {
    name: "async function",
    code: `async function g() { const require = __fake; S0; }\ng();\nS1`,
  },
  {
    name: "direct eval in a function",
    code: `function g() { eval("var require = __fake"); S0; }\ng();\nS1`,
    category: "dynamic",
  },
  {
    name: "direct eval at top level",
    code: `eval("var require = __fake");\nS0`,
    modes: ["cjs", "cjs-strict"],
    category: "dynamic",
  },
  { name: "indirect eval", code: `(0, eval)("var require = __fake");\nS0` },
  {
    name: "globalThis.eval",
    code: `globalThis.eval("var require = __fake");\nS0`,
  },
  {
    name: "new Function",
    code: `new Function("var require = 1; return require;")();\nS0`,
  },
  {
    name: "with statement (sloppy only)",
    code: `with ({ require: __fake }) { S0; }\nS1`,
    modes: ["cjs"],
    category: "dynamic",
  },
  {
    name: "reassignment at top level, before",
    code: `require = __fake;\nS0`,
    modes: ["cjs", "cjs-strict"],
    category: "dynamic",
  },
  {
    name: "reassignment at top level, after",
    code: `S0;\nrequire = __fake;`,
    modes: ["cjs", "cjs-strict"],
    category: "dynamic",
  },
  {
    name: "real require passed to a parameter",
    code: `function g(require) { S0; }\ng(require);`,
    modes: ["cjs", "cjs-strict"],
    category: "value-flow",
  },
  {
    name: "createRequire spoof in a function",
    code: `function g() { function createRequire() { return () => __fake(); } const require = createRequire(); S0; }\ng();\nS1`,
  },
  {
    name: "createRequire from node:module in a function (CommonJS)",
    code: `const { createRequire } = require("node:module");\nfunction g() { const require = createRequire(__filename); S0; }\ng();`,
    modes: ["cjs", "cjs-strict"],
  },
  {
    name: "unrelated declarations",
    code: `const x = 1; function h(a) { return a; }\nS0`,
  },
  // Round 7: Annex B with an if branch (B.3.4), sloppy only.
  {
    name: "function as an if branch in a function",
    code: `function g() { if (true) ${LOCAL} return S0; }\ng();`,
    modes: ["cjs"],
  },
  {
    name: "function as an else branch in a function",
    code: `function g() { if (false) ; else ${LOCAL} return S0; }\ng();`,
    modes: ["cjs"],
  },
  {
    name: "function as a nested if branch in a function",
    code: `function g() { if (true) if (true) ${LOCAL} return S0; }\ng();`,
    modes: ["cjs"],
  },
  {
    name: "function as an if branch at top level",
    code: `if (true) ${LOCAL}\nS0`,
    modes: ["cjs"],
  },
  // Round 7: the wrapper's `arguments` (mapped to its parameters when sloppy).
  {
    name: "wrapper arguments written in an arrow",
    code: `(() => { arguments[1] = () => __fake(); })();\nS0`,
    modes: ["cjs", "cjs-strict"],
    category: "dynamic",
  },
  {
    name: "wrapper arguments written by a later-called arrow",
    code: `const patch = () => { arguments[1] = (n) => __fake(); };\npatch();\nS0`,
    modes: ["cjs", "cjs-strict"],
    category: "dynamic",
  },
  {
    name: "wrapper arguments returned and written",
    code: `const f = () => arguments;\nf()[1] = () => __fake();\nS0`,
    modes: ["cjs", "cjs-strict"],
    category: "dynamic",
  },
  {
    name: "wrapper arguments read only",
    code: `const count = arguments.length;\nconst first = arguments[0];\nS0`,
    modes: ["cjs", "cjs-strict"],
  },
  {
    name: "a function's own arguments written",
    code: `function h() { arguments[1] = () => __fake(); }\nh();\nS0`,
    modes: ["cjs", "cjs-strict"],
  },
  // Round 7: supported indirect loader forms, and shadowed variants.
  { name: "parenthesised require", code: `P0` },
  { name: "comma require", code: `Q0` },
  { name: "module.require", code: `M0`, modes: ["cjs", "cjs-strict"] },
  {
    name: "parenthesised local require",
    code: `function g(require) { return P0; }\ng(__fake);`,
  },
  {
    name: "comma local require",
    code: `function g(require) { return Q0; }\ng(__fake);`,
  },
  {
    name: "module.require on a local module",
    code: `function g(module) { return M0; }\ng({ require: __fake });`,
    modes: ["cjs", "cjs-strict"],
  },
  {
    name: "createRequire renamed by destructuring",
    code: `const { createRequire: cr } = require("node:module");\nfunction g() { const require = cr(__filename); return S0; }\ng();`,
    modes: ["cjs", "cjs-strict"],
  },
  // Round 8: `var arguments` keeps the mapped object; other bindings do not.
  {
    name: "var arguments then a write",
    code: `var arguments;\narguments[1] = () => __fake();\nS0`,
    modes: ["cjs"],
    category: "dynamic",
  },
  {
    name: "var arguments = arguments then a write",
    code: `var arguments = arguments;\narguments[1] = () => __fake();\nS0`,
    modes: ["cjs"],
    category: "dynamic",
  },
  {
    name: "let arguments then a write",
    code: `let arguments = [];\narguments[1] = () => __fake();\nS0`,
    modes: ["cjs"],
  },
  {
    name: "function arguments then a write",
    code: `function arguments() {}\narguments[1] = () => __fake();\nS0`,
    modes: ["cjs"],
  },
  {
    name: "arrow parameter named arguments",
    code: `const f = (arguments) => { arguments[1] = () => __fake(); };\nf([]);\nS0`,
    modes: ["cjs"],
  },
  // Round 8: computed keys are evaluated in the enclosing scope.
  {
    name: "class computed key writes wrapper arguments",
    code: `class C { [arguments[1] = () => __fake()]() {} }\nS0`,
    modes: ["cjs"],
    category: "dynamic",
  },
  {
    name: "object computed key writes wrapper arguments",
    code: `({ [(arguments[1] = () => __fake(), "k")]() {} });\nS0`,
    modes: ["cjs"],
    category: "dynamic",
  },
  // Round 8: harmless copies of the wrapper's arguments.
  {
    name: "spread of wrapper arguments",
    code: `function f() {}\nf(...arguments);\nS0`,
    modes: ["cjs", "cjs-strict"],
  },
  {
    name: "Array.from of wrapper arguments",
    code: `const copy = Array.from(arguments);\nS0`,
    modes: ["cjs", "cjs-strict"],
  },
  {
    name: "slice.call of wrapper arguments",
    code: `const copy = Array.prototype.slice.call(arguments);\nS0`,
    modes: ["cjs", "cjs-strict"],
  },
  {
    name: "wrapper arguments passed on",
    code: `function keep(a) { return a; }\nkeep(arguments);\nS0`,
    modes: ["cjs", "cjs-strict"],
    category: "dynamic",
  },
  // Round 8: createRequire's base must be proven.
  {
    name: "createRequire with a reassigned __filename",
    code: `const { createRequire } = require("node:module");\n__filename = __dirname + "/sub/x.cjs";\nfunction g() { const require = createRequire(__filename); return S0; }\ng();`,
    modes: ["cjs"],
    category: "base",
  },
  {
    name: "createRequire with a local pathToFileURL",
    code: `const { createRequire } = require("node:module");\nfunction pathToFileURL(f) { return require("node:url").pathToFileURL(__dirname + "/sub/x.cjs"); }\nfunction g() { const require = createRequire(pathToFileURL(__filename)); return S0; }\ng();`,
    modes: ["cjs", "cjs-strict"],
    category: "base",
  },
  {
    name: "createRequire with node:url pathToFileURL",
    code: `const { createRequire } = require("node:module");\nconst { pathToFileURL } = require("node:url");\nfunction g() { const require = createRequire(pathToFileURL(__filename)); return S0; }\ng();`,
    modes: ["cjs", "cjs-strict"],
  },
];
const ESM_ONLY = [
  {
    name: "module.require in an ES module (bundler assumption)",
    header: "",
    category: "bundler",
    code: `export {};\nM0`,
  },
  {
    name: "createRequire(__filename) in an ES module",
    header: "",
    category: "base",
    code: `import { createRequire } from "node:module";\nfunction g() { const require = createRequire(__filename); return S0; }\ng();`,
  },
  {
    name: "import binding",
    header: "",
    code: `import { require } from "./fake.mjs";\nS0`,
  },
  {
    name: "default import binding",
    header: "",
    code: `import require from "./fake-default.mjs";\nS0`,
  },
  {
    name: "createRequire spoof at top level",
    header: "",
    code: `function createRequire() { return () => __fake(); }\nconst require = createRequire();\nS0`,
  },
  {
    name: "createRequire through a namespace import",
    header: "",
    code: `import * as m from "node:module";\nconst require = m.createRequire(import.meta.url);\nS0`,
  },
  {
    name: "createRequire through a default import",
    header: "",
    code: `import m from "node:module";\nconst require = m.createRequire(import.meta.url);\nS0`,
  },
  {
    name: "createRequire aliased import",
    header: "",
    code: `import { createRequire as cr } from "node:module";\nconst require = cr(import.meta.url);\nS0`,
  },
  {
    name: "createRequire replaced on the default import",
    header: "",
    category: "dynamic",
    // Restores Node's factory so later cases in the same process are unaffected.
    code: `import m from "node:module";\nconst original = m.createRequire;\nm.createRequire = () => () => __fake();\nconst require = m.createRequire(import.meta.url);\nS0;\nm.createRequire = original;`,
  },
  {
    name: "createRequire replaced by Object.assign",
    header: "",
    category: "dynamic",
    code: `import m from "node:module";\nconst original = m.createRequire;\nObject.assign(m, { createRequire: () => () => __fake() });\nconst require = m.createRequire(import.meta.url);\nS0;\nObject.assign(m, { createRequire: original });`,
  },
  {
    name: "createRequire with another base",
    header: "",
    category: "base",
    code: `import { createRequire } from "node:module";\nconst require = createRequire(new URL("./sub/", import.meta.url));\nS0`,
  },
  {
    name: "free require in an ES module (bundler assumption)",
    header: "",
    category: "bundler",
    code: `export {};\nS0`,
  },
  {
    name: "createRequire renamed import",
    header: "",
    code: `import { createRequire as cr } from "node:module";\nconst createRequire = () => () => __fake();\nconst require = createRequire();\nS0`,
  },
];
const ESM_HEADER =
  'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\n';

/**
 * Cross-file pairs: an exporter (no sites) and a Node-run consumer whose X
 * sites use an imported value (`v.real()`), so the emitted links in an
 * importing file are checked against Node too. EXP/BARREL name the files.
 */
const CROSS = [
  {
    name: "bundler: named, default and namespace imports of a free require",
    category: "bundler",
    exporter: `export const d = require("./dep.cjs");\nconst alias = d;\nexport default d;\nexport { alias };`,
    consumer: `import { d, alias } from "./EXP";\nimport dflt from "./EXP";\nimport * as ns from "./EXP";\nX0(d)\nX1(dflt)\nX2(ns.d)\nX3(alias)`,
  },
  {
    name: "bundler: through a barrel",
    category: "bundler",
    exporter: `export const d = require("./dep.cjs");`,
    barrel: true,
    consumer: `import { d } from "./BARREL";\nX0(d)`,
  },
  {
    name: "createRequire exporter, consumed",
    exporter: `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\nexport const d = require("./dep.cjs");`,
    consumer: `import { d } from "./EXP";\nX0(d)`,
  },
  {
    name: "local require exporter, consumed",
    exporter: `function require(n) { return __fake(); }\nexport const d = require("./dep.cjs");`,
    consumer: `import { d } from "./EXP";\nX0(d)`,
  },
];

/** The corpus: [{file, mode, template, category, code, sites: [id]}]. */
export function buildCorpus() {
  const cases = [];
  let index = 0;
  const add = (template, mode, code) => {
    const sites = [];
    const forms = {};
    const siteTexts = {};
    const text = code
      .replace(/\b([SPQM])(\d)\b/g, (_, form, n) => {
        const id = `c${index}s${n}`;
        sites.push(id);
        forms[id] = form;
        return (siteTexts[id] = site(id, form));
      })
      .replace(/\bX(\d)\(([^)\n]*)\)/g, (_, n, expression) => {
        const id = `c${index}x${n}`;
        sites.push(id);
        forms[id] = "X";
        return (siteTexts[id] = siteFor(id, expression));
      });
    const extension = mode === "esm" ? "mjs" : "cjs";
    cases.push({
      file: `case${String(index).padStart(3, "0")}.${extension}`,
      mode,
      template: template.name,
      category: template.category ?? "static",
      code: text,
      sites,
      forms,
      siteTexts,
    });
    index++;
  };
  for (const template of TEMPLATES)
    for (const mode of template.modes ?? ["cjs", "cjs-strict", "esm"]) {
      const prefix =
        mode === "cjs-strict"
          ? '"use strict";\n'
          : mode === "esm"
            ? ESM_HEADER
            : "";
      add(template, mode, prefix + template.code);
    }
  for (const template of ESM_ONLY)
    add(template, "esm", template.header + template.code);
  CROSS.forEach((pair, n) => {
    const exporter = `cross${n}-exporter.mjs`;
    const barrel = `cross${n}-barrel.mjs`;
    const category = pair.category ?? "static";
    cases.push({
      file: exporter,
      mode: "esm",
      template: `${pair.name} (exporter)`,
      category,
      code: pair.exporter + "\n",
      sites: [],
      forms: {},
      siteTexts: {},
    });
    if (pair.barrel)
      cases.push({
        file: barrel,
        mode: "esm",
        template: `${pair.name} (barrel)`,
        category,
        code: `export * from "./${exporter}";\n`,
        sites: [],
        forms: {},
        siteTexts: {},
      });
    add(
      { name: `${pair.name} (consumer)`, category },
      "esm",
      pair.consumer
        .replace("./EXP", `./${exporter}`)
        .replace(/\.\/EXP/g, `./${exporter}`)
        .replace("./BARREL", `./${barrel}`) + "\n",
    );
  });
  return cases;
}

const RUNNER = `
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
const [list, out] = process.argv.slice(2);
const results = {};
let current = [];
globalThis.__fake = () => ({ marker: "LOCAL", real() {} });
globalThis.__report = (id, call) => {
  try {
    const value = call();
    results[id] =
      value && value.marker === "REAL"
        ? "real"
        : value && value.marker === "SUB"
          ? "elsewhere"
          : "local";
  } catch {
    results[id] = "error";
  }
};
const load = createRequire(import.meta.url);
for (const item of JSON.parse(readFileSync(list, "utf8"))) {
  try {
    if (item.path.endsWith(".mjs")) await import(pathToFileURL(item.path).href);
    else load(item.path);
  } catch {}
  // Let async sites settle.
  await new Promise((resolve) => setImmediate(resolve));
  for (const id of item.sites) if (!(id in results)) results[id] = "error";
}
writeFileSync(out, JSON.stringify(results));
`;

/** Runs the corpus in one Node child process; returns {siteId: "real"|"local"|"error"}. */
export async function runOracle(scratch, cases) {
  await mkdir(scratch, { recursive: true });
  await writeFile(
    join(scratch, "dep.cjs"),
    'module.exports = { marker: "REAL", real() {} };\n',
  );
  await mkdir(join(scratch, "sub"), { recursive: true });
  await writeFile(
    join(scratch, "sub", "dep.cjs"),
    'module.exports = { marker: "SUB", real() {} };\n',
  );
  await writeFile(
    join(scratch, "fake.mjs"),
    'export function require() { return { marker: "LOCAL", real() {} }; }\n',
  );
  await writeFile(
    join(scratch, "fake-default.mjs"),
    'export default function () { return { marker: "LOCAL", real() {} }; }\n',
  );
  for (const item of cases)
    await writeFile(join(scratch, item.file), item.code);
  await writeFile(join(scratch, "runner.mjs"), RUNNER);
  await writeFile(
    join(scratch, "list.json"),
    JSON.stringify(
      // Indirect-eval cases create a global `require` for the rest of the
      // process; the free-`require` (bundler) cases must run before them.
      [...cases]
        .sort(
          (a, b) =>
            (a.category === "bundler" ? 0 : 1) -
            (b.category === "bundler" ? 0 : 1),
        )
        .map((item) => ({
          path: join(scratch, item.file),
          sites: item.sites,
        })),
    ),
  );
  const out = join(scratch, "results.json");
  execFileSync(
    process.execPath,
    [
      ...process.execArgv.filter((flag) => flag.startsWith("--stack-size")),
      join(scratch, "runner.mjs"),
      join(scratch, "list.json"),
      out,
    ],
    // A hang guard, not a correctness criterion.
    { cwd: scratch, stdio: "ignore", timeout: 600_000 },
  );
  return JSON.parse(await readFile(out, "utf8"));
}

/** Offset of the site's callee identifier (`require`, or `module` for M). */
const calleeStart = (item, id) => {
  const marker = `__report(${JSON.stringify(id)}, () => ${SITE_PREFIX}`;
  const start = item.code.indexOf(marker) + marker.length;
  const form = item.forms[id];
  return form === "P" ? start + 1 : form === "Q" ? start + 4 : start;
};
/** Offset of the site's specifier string `"./dep.cjs"`. */
export const specifierStart = (item, id) => {
  const marker = `__report(${JSON.stringify(id)}, () => ${SITE_PREFIX}`;
  return (
    item.code.indexOf(marker) +
    marker.length +
    CALLEES[item.forms[id]].length +
    1
  );
};

/** The analysis' classification of each site's callee. */
export function analyse(classify, item) {
  const occurrences = classify(`/${item.file}`, item.code);
  const result = {};
  for (const id of item.sites) {
    if (item.forms[id] === "X") {
      result[id] = "n/a";
      continue;
    }
    const start = calleeStart(item, id);
    const occurrence = occurrences.find((o) => o.start === start);
    result[id] = occurrence ? occurrence.classification : "missing";
  }
  return result;
}

/** Whether an analysis answer agrees with Node for a case category. */
export function agrees(category, node, ours) {
  if (ours === "n/a") return true; // cross-file X sites: emitted links only
  if (ours === "missing") return false;
  if (category === "bundler") return node === "error" && ours === "real";
  if (node === "real") {
    if (ours === "real") return true;
    if (category === "dynamic") return ours === "uncertain";
    if (category === "value-flow") return ours === "local";
    return false;
  }
  // Node: something local, an error, or resolved elsewhere. Never "real".
  if (ours === "local") return true;
  return (
    (category === "dynamic" || category === "base") && ours === "uncertain"
  );
}

/**
 * What the module EMITTED at a site must agree with Node. The import link at
 * the specifier, and the member link `v.real` of the site's value (in the
 * site's own file, which for X sites is an importing file):
 *  - none into dep.cjs where Node used something local, threw, or resolved
 *    elsewhere;
 *  - where Node used the real loader and the analysis says so: a resolved
 *    import, and a member resolved into dep.cjs (forms the compiler does not
 *    type give an `untyped-require` member instead);
 *  - for the bundler reading: links into dep.cjs flagged `data.assumes`.
 * Returns a problem description or null.
 */
export function checkEmitted(item, id, node, ours, links, dep) {
  const into = (link) =>
    dep.all.has(link.targetId) ||
    link.candidates.some((candidate) => dep.all.has(candidate.id));
  const form = item.forms[id];
  const siteStart = item.code.indexOf(item.siteTexts[id]);
  const siteEnd = siteStart + item.siteTexts[id].length;
  const members = links.filter(
    (link) =>
      link.file === item.file &&
      link.kind === "calls" &&
      link.targetName === "v.real" &&
      link.range.start >= siteStart &&
      link.range.end <= siteEnd,
  );
  if (members.length !== 1)
    return `expected one v.real link, found ${members.length}`;
  const member = members[0];
  const imports =
    form === "X"
      ? []
      : links.filter(
          (link) =>
            link.file === item.file &&
            link.kind === "imports" &&
            link.range.start === specifierStart(item, id),
        );
  const importsIntoDep = imports.filter(into);
  const untyped = form === "P" || form === "Q" || form === "M";
  if (item.category === "bundler") {
    if (form !== "X") {
      if (importsIntoDep.length !== 1)
        return "expected one import link into dep.cjs";
      if (importsIntoDep[0].data?.assumes !== "bundler-require")
        return "bundler import without data.assumes";
    }
    if (member.data?.assumes !== "bundler-require")
      return "bundler member link without data.assumes";
    if (!untyped && !into(member))
      return "bundler member link not into dep.cjs";
    return null;
  }
  if (node === "real" && (ours === "real" || form === "X")) {
    if (
      form !== "X" &&
      !(
        importsIntoDep.length === 1 &&
        importsIntoDep[0].resolution === "resolved"
      )
    )
      return `expected a resolved import of dep.cjs, found ${imports.length} link(s)`;
    if (untyped)
      return member.data?.reason === "untyped-require"
        ? null
        : `expected an untyped-require member, got ${member.resolution} ${member.data?.reason}`;
    if (!(member.resolution === "resolved" && into(member)))
      return `expected the member resolved into dep.cjs, got ${member.resolution} ${member.data?.reason}`;
    if (member.data?.assumes) return "an assumes flag on a real link";
    return null;
  }
  if (importsIntoDep.length)
    return "an import link into dep.cjs where Node did not use the real loader";
  if (into(member))
    return "a member link into dep.cjs where Node did not use the real loader";
  return null;
}
