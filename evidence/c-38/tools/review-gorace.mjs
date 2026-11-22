// Reviewer probe (PR 50, P4): two index runs on one store, Go's analysis of
// run A paused after computing on a tree with an export removed; the export is
// restored and run B indexes; A resumes. Prints what A did and whether the store
// equals a cold index.  node gorace.mjs <dist> <tree(mirror)> <base>
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
const [distArg, treeArg, baseArg] = process.argv.slice(2);
const dist = resolve(distArg);
const { discoverLanguages, indexProject, LanguageRegistry, SqliteGraphStore } = await import(join(dist, "graph/index.js"));
const { compareRows, storeRows } = await import(join(resolve(treeArg), "scripts/reindex/dump.mjs"));
const production = await discoverLanguages();
const lang = process.argv[5] ?? "go";
const base = resolve(baseArg);
if (existsSync(base)) throw Error("exists: " + base);
const root = join(base, "tree");
const graph = join(base, "graph.sqlite");
const write = (p, t) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), t); };
const aFull = lang === "go"
  ? "package a\n\nfunc Hello() int { return 1 }\n\nfunc Gone() int { return 2 }\n"
  : "export function hello(): number { return 1; }\n\nexport function gone(): number { return 2; }\n";
const aCut = lang === "go"
  ? "package a\n\nfunc Hello() int { return 1 }\n"
  : "export function hello(): number { return 1; }\n";
if (lang === "go") {
  write("go.mod", "module example.com/m\n\ngo 1.22\n");
  write("a/a.go", aFull);
  write("b/b.go", 'package b\n\nimport "example.com/m/a"\n\nfunc Use() int { return a.Hello() + a.Gone() }\n');
} else {
  write("package.json", JSON.stringify({ name: "f", private: true }));
  write("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }));
  write("src/a.ts", aFull);
  write("src/b.ts", 'import { hello, gone } from "./a";\nexport const b = hello() + gone();\n');
}
const aPath = lang === "go" ? "a/a.go" : "src/a.ts";
function gate() { let open, arrive; const opened = new Promise((r) => (open = r)); const reached = new Promise((r) => (arrive = r)); return { open, reached, async wait() { arrive(); await opened; } }; }
const pausing = (held) => new LanguageRegistry(production.modules.map((m) => m.id !== lang ? m : { ...m, async analyze(ctx) { const r = await m.analyze(ctx); const h = held.shift(); if (h) await h.wait(); return r; } }));
const goneTarget = () => {
  const s = new SqliteGraphStore(graph, undefined, { readOnly: true });
  try { const l = s.links().find((x) => /gone/i.test(x.targetName ?? "") && x.file.startsWith("b") || (/gone/i.test(x.targetName ?? "") && x.file.includes("b."))); return l?.targetId ? s.getSymbol(l.targetId)?.file : null; } finally { s.close(); }
};
const first = new SqliteGraphStore(graph); await indexProject(root, production, first); first.close();
console.log("initial gone target:", goneTarget());
write(aPath, aCut);
const held = gate();
const sA = new SqliteGraphStore(graph);
const runA = indexProject(root, pausing([held]), sA);
await held.reached;
console.log("A paused in analysis");
write(aPath, aFull);
const sB = new SqliteGraphStore(graph); const rB = await indexProject(root, production, sB); const projectId = sB.projectId; sB.close();
console.log("B indexed:", rB.indexed, "unchanged", rB.unchanged);
held.open();
const [settled] = await Promise.allSettled([runA]);
console.log("A:", settled.status, settled.status === "rejected" ? settled.reason.message : "");
sA.close();
console.log("gone target after A:", goneTarget());
const coldPath = join(base, "cold.sqlite");
const c = new SqliteGraphStore(coldPath, projectId); await indexProject(root, production, c); c.close();
console.log("store vs cold differences:", compareRows(storeRows(graph), storeRows(coldPath)).length);
const again = new SqliteGraphStore(graph); await indexProject(root, production, again); again.close();
console.log("after one more index, differences:", compareRows(storeRows(graph), storeRows(coldPath)).length);
