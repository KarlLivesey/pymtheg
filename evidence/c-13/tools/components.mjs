// components.mjs BUILD ROOT : prototype of a conservative split of the
// inferred (no-config) group into parts that cannot affect each other.
// Prints the size distribution of the parts and why the largest merged.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const [build, root] = process.argv.slice(2);
const ts = createRequire(`${build}/package.json`)("typescript");
const { projectModel, toVirtual, fromVirtual } = await import(
  `${build}/dist/graph/languages/typescript/project.js`
);
const tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], { maxBuffer: 1 << 30 })
  .toString().split("\0").filter(Boolean);
const source = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const context = /(^|\/)([^/]*tsconfig[^/]*\.json|[^/]*jsconfig[^/]*\.json|package\.json|pnpm-workspace\.yaml)$/;
const read = (path) => readFileSync(`${root}/${path}`, "utf8");
const files = tracked.filter((p) => source.test(p)).map((path) => ({ path, text: read(path), hash: "", module: "typescript", version: "", result: { status: "clean", diagnostics: [], symbols: [], links: [] } }));
const contexts = tracked.filter((p) => context.test(p)).map((path) => ({ path, text: read(path), hash: "", status: "clean", diagnostics: [] }));
const model = projectModel(files, contexts);
const group = model.groups.find((g) => g.config === null);
const host = model.host(group);
const cache = ts.createModuleResolutionCache("/", (x) => x, group.options);
const t0 = Date.now();

// Names the checker can reach without the file naming them.
const libProgram = ts.createProgram({ rootNames: ["/__empty.ts"], options: group.options, host: { ...host, getSourceFile: (n, v) => n === "/__empty.ts" ? ts.createSourceFile(n, "", v) : host.getSourceFile(n, v), fileExists: (n) => n === "/__empty.ts" || host.fileExists(n) } });
const libChecker = libProgram.getTypeChecker();
const implicit = new Set(["JSX", "React", "globalThis"]);
for (const symbol of libChecker.getSymbolsInScope(libProgram.getSourceFile("/__empty.ts"), ts.SymbolFlags.Type | ts.SymbolFlags.Namespace)) implicit.add(symbol.name);
const tsText = readFileSync(createRequire(`${build}/package.json`).resolve("typescript"), "utf8");
for (const m of tsText.matchAll(/getGlobal[A-Za-z]*\(\s*"([A-Za-z_$][\w$]*)"/g)) implicit.add(m[1]);
const globalObject = new Set(["globalThis", "window", "self", "top", "parent", "frames", "global"]);

const summaries = new Map();
function summarize(path) {
  if (summaries.has(path)) return summaries.get(path);
  const text = host.readFile(toVirtual(path));
  const s = { provides: new Set(), mentions: new Set(), properties: new Set(), specifiers: new Set(), ambient: [], universal: null, globalUser: false, failed: false };
  summaries.set(path, s);
  let file;
  try { file = ts.createSourceFile(toVirtual(path), text, ts.ScriptTarget.Latest, true); } catch { s.failed = true; return s; }
  const script = !file.externalModuleIndicator;
  for (const m of text.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\r\n])*)\1/g)) if (m[2].length && m[2].length < 300 && !/\s/.test(m[2])) s.specifiers.add(m[2]);
  for (const ref of file.referencedFiles) s.specifiers.add(ref.fileName.startsWith(".") || ref.fileName.startsWith("/") ? ref.fileName : "./" + ref.fileName);
  if (file.libReferenceDirectives.length || file.hasNoDefaultLib) s.universal = "lib reference";
  const declare = (name, typeMeaning) => {
    s.provides.add(name);
    if (typeMeaning && implicit.has(name)) s.universal ??= `declares global ${name}`;
  };
  const declarations = (statements, global) => {
    for (const st of statements) {
      if (global) {
        if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) bindingNames(d.name, (n) => declare(n, false));
        else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st) || ts.isImportEqualsDeclaration(st)) && st.name && ts.isIdentifier(st.name))
          declare(st.name.text, !ts.isFunctionDeclaration(st) && !ts.isImportEqualsDeclaration(st));
      }
      if (ts.isModuleDeclaration(st)) {
        if (ts.isStringLiteral(st.name)) s.ambient.push(st.name.text);
        let body = st.body; while (body && ts.isModuleDeclaration(body)) body = body.body;
        const augmentsGlobal = (st.flags & ts.NodeFlags.GlobalAugmentation) !== 0;
        if (body && ts.isModuleBlock(body) && (global || augmentsGlobal)) declarations(body.statements, true);
      }
      if (ts.isNamespaceExportDeclaration(st)) declare(st.name.text, true);
    }
  };
  const bindingNames = (name, add) => { if (ts.isIdentifier(name)) add(name.text); else for (const e of name.elements) if (!ts.isOmittedExpression(e)) bindingNames(e.name, add); };
  declarations(file.statements, script);
  const stack = [file];
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.ThisKeyword && script) s.globalUser = true;
    if (ts.isIdentifier(node)) {
      const p = node.parent;
      const isProperty = p && ((ts.isPropertyAccessExpression(p) && p.name === node) || (ts.isQualifiedName(p) && p.right === node) || ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodSignature(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isEnumMember(p) || ts.isJsxAttribute(p) || ts.isBindingElement(p) && p.propertyName === node) && p.name === node));
      if (isProperty) s.properties.add(node.text); else s.mentions.add(node.text);
      if (globalObject.has(node.text)) s.globalUser = true;
      if (script && p && ts.isPropertyAccessExpression(p) && p.name === node && p.expression.kind === ts.SyntaxKind.ThisKeyword) s.provides.add(node.text);
    } else if (ts.isPrivateIdentifier(node)) {
    } else if (ts.isStringLiteralLike(node)) s.properties.add(node.text);
    if (node.jsDoc) for (const doc of node.jsDoc) stack.push(doc);
    ts.forEachChild(node, (child) => { stack.push(child); });
  };
  while (stack.length) visit(stack.pop());
  if (file.statements.length === 0 && false) s.universal = "empty";
  return s;
}

// Union-find over every reached captured file.
const parent = new Map();
const find = (x) => { let r = x; while (parent.get(r) !== r) r = parent.get(r); while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; } return r; };
const add = (x) => { if (!parent.has(x)) parent.set(x, x); };
const union = (a, b) => { add(a); add(b); const [x, y] = [find(a), find(b)]; if (x !== y) parent.set(x, y); };
const why = new Map();
const roots = group.roots.map((r) => r.slice(1));
const queue = [...roots];
for (const r of roots) add(r);
let resolutions = 0;
while (queue.length) {
  const path = queue.pop();
  const s = summarize(path);
  for (const spec of s.specifiers) {
    resolutions++;
    const resolved = ts.resolveModuleName(spec, toVirtual(path), group.options, host, cache).resolvedModule?.resolvedFileName;
    const target = resolved && fromVirtual(host.realpath?.(resolved) ?? resolved);
    if (target === undefined || target === path || !source.test(target)) continue;
    if (!parent.has(target)) { add(target); queue.push(target); }
    union(path, target);
  }
}
const t1 = Date.now();
const all = [...parent.keys()];
const providers = new Map();
for (const path of all) for (const name of summaries.get(path).provides) (providers.get(name) ?? providers.set(name, []).get(name)).push(path);
const ambient = all.filter((p) => summaries.get(p).ambient.length);
const universal = all.filter((p) => summaries.get(p).universal);
console.log(JSON.stringify({ roots: roots.length, reached: all.length, resolutions, universal: universal.length, ambient: ambient.length, providedNames: providers.size, prepassSeconds: (t1 - t0) / 1000 }));
for (const p of universal.slice(0, 10)) console.log("universal", p, summaries.get(p).universal);
if (universal.length && !process.env.NO_UNIVERSAL) for (const p of all) union(p, universal[0]);
const linkNames = (extra) => {
  for (const path of all) {
    const s = summaries.get(path);
    const names = extra.has(find(path)) ? [...s.mentions, ...s.properties] : s.mentions;
    for (const name of names) for (const provider of providers.get(name) ?? []) { if (find(provider) !== find(path)) { why.set(`${path} -> ${provider}`, name); union(path, provider); } }
    for (const spec of s.specifiers) for (const p of ambient) if (summaries.get(p).ambient.some((a) => a === spec || (a.includes("*") && new RegExp("^" + a.split("*").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$").test(spec)))) union(path, p);
  }
};
let users = new Set();
for (let round = 0; ; round++) {
  linkNames(users);
  const next = new Set(all.filter((p) => summaries.get(p).globalUser).map(find));
  if (next.size === users.size && [...next].every((x) => users.has(x))) break;
  users = next;
}
const sizes = new Map();
for (const r of roots) sizes.set(find(r), (sizes.get(find(r)) ?? 0) + 1);
const sorted = [...sizes.values()].sort((a, b) => b - a);
console.log(JSON.stringify({ components: sorted.length, largest: sorted.slice(0, 10), singletons: sorted.filter((x) => x === 1).length, seconds: (Date.now() - t0) / 1000 }));
const names = new Map();
for (const name of why.values()) names.set(name, (names.get(name) ?? 0) + 1);
console.log("top merging names", JSON.stringify([...names].sort((a, b) => b[1] - a[1]).slice(0, 40)));
