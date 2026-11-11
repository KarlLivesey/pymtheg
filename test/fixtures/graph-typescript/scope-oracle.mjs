// Node as the oracle for the scope analysis of `require` (src/graph/languages/
// typescript/rename.ts). Builds a deterministic corpus of small CommonJS and ES
// module files, runs each in one Node child process (sequentially), and
// records, per call site, whether `require("./dep.cjs")` reached the real
// loader ("real"), something local ("local"), or threw ("error").
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const LOCAL = "function require(n) { return __fake(); }";
/** A call site: reports what `require` reaches at this point. */
const site = (id) =>
  `__report(${JSON.stringify(id)}, () => require("./dep.cjs"))`;

/**
 * Templates. `code` uses S0, S1, ... placeholders for call sites. `modes`
 * limits where a template is valid; `category` says how the analysis may
 * differ from Node:
 *  - static: must match exactly;
 *  - dynamic: run-time scope (with, direct eval, reassignment): "uncertain"
 *    is allowed, "real" only where Node says real;
 *  - value-flow: a local binding that receives the real loader's value at run
 *    time; the analysis classifies the binding as local (an import is lost,
 *    never a wrong link).
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
];
const ESM_ONLY = [
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
    name: "createRequire renamed import",
    header: "",
    code: `import { createRequire as cr } from "node:module";\nconst createRequire = () => () => __fake();\nconst require = createRequire();\nS0`,
  },
];
const ESM_HEADER =
  'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\n';

/** The corpus: [{file, mode, template, category, code, sites: [id]}]. */
export function buildCorpus() {
  const cases = [];
  let index = 0;
  const add = (template, mode, code) => {
    const sites = [];
    const text = code.replace(/S(\d)/g, (_, n) => {
      const id = `c${index}s${n}`;
      sites.push(id);
      return site(id);
    });
    const extension = mode === "esm" ? "mjs" : "cjs";
    cases.push({
      file: `case${String(index).padStart(3, "0")}.${extension}`,
      mode,
      template: template.name,
      category: template.category ?? "static",
      code: text,
      sites,
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
  return cases;
}

const RUNNER = `
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
const [list, out] = process.argv.slice(2);
const results = {};
let current = [];
globalThis.__fake = () => ({ marker: "LOCAL" });
globalThis.__report = (id, call) => {
  try {
    const value = call();
    results[id] = value && value.marker === "REAL" ? "real" : "local";
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
    'module.exports = { marker: "REAL" };\n',
  );
  await writeFile(
    join(scratch, "fake.mjs"),
    'export function require() { return { marker: "LOCAL" }; }\n',
  );
  await writeFile(
    join(scratch, "fake-default.mjs"),
    'export default function () { return { marker: "LOCAL" }; }\n',
  );
  for (const item of cases)
    await writeFile(join(scratch, item.file), item.code);
  await writeFile(join(scratch, "runner.mjs"), RUNNER);
  await writeFile(
    join(scratch, "list.json"),
    JSON.stringify(
      cases.map((item) => ({
        path: join(scratch, item.file),
        sites: item.sites,
      })),
    ),
  );
  const out = join(scratch, "results.json");
  execFileSync(
    process.execPath,
    [join(scratch, "runner.mjs"), join(scratch, "list.json"), out],
    // A hang guard, not a correctness criterion.
    { cwd: scratch, stdio: "ignore", timeout: 600_000 },
  );
  return JSON.parse(await readFile(out, "utf8"));
}

/** The analysis' classification of each site's `require`. */
export function analyse(classify, item) {
  const occurrences = classify(`/${item.file}`, item.code);
  const result = {};
  for (const id of item.sites) {
    const marker = `__report(${JSON.stringify(id)}, () => `;
    const start = item.code.indexOf(marker) + marker.length;
    const occurrence = occurrences.find((o) => o.start === start);
    result[id] = occurrence ? occurrence.classification : "missing";
  }
  return result;
}

/** Whether an analysis answer agrees with Node for a case category. */
export function agrees(category, node, ours) {
  if (ours === "missing") return false;
  if (node === "real") {
    if (ours === "real") return true;
    if (category === "dynamic") return ours === "uncertain";
    if (category === "value-flow") return ours === "local";
    return false;
  }
  // Node: something local, or an error. Never the real loader.
  if (ours === "local") return true;
  return category === "dynamic" && ours === "uncertain";
}
