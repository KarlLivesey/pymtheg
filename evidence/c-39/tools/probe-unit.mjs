// SPDX-License-Identifier: MIT
// C-39 item 3 diagnosis: for unit-only library call links (not imports) in a
// pin's installed graph, take N at a fixed seed and report what the compiler
// binds at the member in the owning program: how many declarations, in which
// installed packages, and whether the property is synthetic (mapped).
// Usage: node probe-unit.mjs BUILD CHECKOUT N SEED
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
const [build, root, n, seed] = process.argv.slice(2);
const load = (p) => import(pathToFileURL(resolve(build, "dist/graph", p)));
const { projectModel, toVirtual } = await load("languages/typescript/project.js");
const { DependencyInputs } = await load("dependency-inputs.js");
const ts = (await import(pathToFileURL(resolve(build, "node_modules/typescript/lib/typescript.js")))).default;
const db = new DatabaseSync(join(root, ".pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
const rows = (t) => db.prepare(`SELECT body FROM ${t} ORDER BY path`).all().map(({ body }) => JSON.parse(body));
const files = rows("graph_files");
const contexts = rows("graph_contexts").filter((f) => !f.dependency);
const links = db.prepare(`SELECT l.id, l.file, l.body FROM graph_links l WHERE l.module='typescript' AND l.kind='calls' AND l.resolution='library'
  AND NOT EXISTS (SELECT 1 FROM graph_library_targets t WHERE t.link=l.id AND t.symbol IS NOT NULL)`).all()
  .map((r) => ({ ...r, body: JSON.parse(r.body), rank: createHash("sha256").update(`${seed}\0${r.id}`).digest("hex") }))
  .sort((a, b) => (a.rank < b.rank ? -1 : 1)).slice(0, Number(n));
const model = projectModel(files, contexts, new DependencyInputs(root, "typescript"));
const programs = new Map();
const pkg = (name) => /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(name)?.[1] ?? (name.includes("/lib.") ? "typescript-lib" : "checkout");
const summary = {};
for (const link of links) {
  const group = model.owner.get(link.file);
  if (!group || group.failure) { console.log(link.file, "no group"); continue; }
  let program = programs.get(group);
  if (!program) programs.set(group, (program = ts.createProgram({ rootNames: group.roots, options: group.options, host: model.host(group) })));
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(toVirtual(link.file));
  const { start, end } = link.body.range;
  let found;
  const visit = (node) => { if (node.getStart(source) === start && node.end === end) found = node; else if (node.pos <= start && end <= node.end) ts.forEachChild(node, visit); };
  visit(source);
  const symbol = found && checker.getSymbolAtLocation(found);
  const target = symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const decls = target?.declarations ?? [];
  const packages = [...new Set(decls.map((d) => pkg(d.getSourceFile().fileName)))];
  const unit = link.body.data?.libraryFacts?.[0]?.unit;
  const check = target ? (target.links?.checkFlags ?? 0) : 0;
  const shape = !target ? "no symbol" : !decls.length ? "no declaration (synthetic member)"
    : decls.length === 1 ? `one declaration in ${packages[0] === unit ? "the linked package" : "another package"}`
    : packages.length === 1 ? "several declarations, one package" : "several declarations, several packages";
  summary[shape] = (summary[shape] ?? 0) + 1;
  console.log(`${link.file}:${source.getLineAndCharacterOfPosition(start).line + 1} ${link.body.targetName} | unit=${unit} | ${shape} | ${packages.join(",")} | check=${check}`);
}
console.log(JSON.stringify(summary));
