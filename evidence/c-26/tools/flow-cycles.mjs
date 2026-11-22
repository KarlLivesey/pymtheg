// flow-cycles.mjs BUILD ROOT [PREFIX...] : binds ROOT's TS/JS files (one
// program per file, no lib) and reports every file where following the
// compiler's single-successor flow steps from some flow node comes back to
// a node already visited: the loop in getTypeAtFlowNode would not end there.
// Prints the files found, the count checked and the time taken.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const [build, root, ...prefixes] = process.argv.slice(2);
const ts = createRequire(`${build}/package.json`)("typescript");
const F = ts.FlowFlags;
const tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], { maxBuffer: 1 << 30 })
  .toString().split("\0").filter(Boolean)
  .filter((p) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(p))
  .filter((p) => !prefixes.length || prefixes.some((x) => p.startsWith(x)));
const memo = new Map();
/** Whether the single-successor walk from `start` revisits a node. */
function cycles(start) {
  const path = [];
  const seen = new Set();
  let flow = start;
  let answer = false;
  while (flow) {
    if (memo.has(flow)) { answer = memo.get(flow); break; }
    if (seen.has(flow)) { answer = true; break; }
    seen.add(flow);
    path.push(flow);
    const flags = flow.flags;
    if (flags & (F.Assignment | F.Call | F.ArrayMutation)) { flow = flow.antecedent; continue; }
    if (flags & F.Label && flow.antecedent?.length === 1) { flow = flow.antecedent[0]; continue; }
    if (flags & F.Start && flow.node?.flowNode) { flow = flow.node.flowNode; continue; }
    break;
  }
  for (const node of path) memo.set(node, answer);
  return answer;
}
const started = Date.now();
let checked = 0;
const found = [];
for (const path of tracked) {
  let text;
  try { text = readFileSync(`${root}/${path}`, "utf8"); } catch { continue; }
  const name = `/${path}`;
  const host = ts.createCompilerHost({});
  let program;
  try {
    program = ts.createProgram({
      rootNames: [name],
      options: { noLib: true, noResolve: true, allowJs: true, noEmit: true },
      host: { ...host, fileExists: (f) => f === name, readFile: (f) => (f === name ? text : undefined), getSourceFile: (f, v) => (f === name ? ts.createSourceFile(f, text, v, true) : undefined) },
    });
    program.getTypeChecker();
  } catch { continue; }
  const source = program.getSourceFile(name);
  if (!source) continue;
  checked++;
  let at;
  const visit = (node) => {
    if (at) return;
    for (const flow of [node.flowNode, node.endFlowNode, node.returnFlowNode])
      if (flow && cycles(flow)) { at = node; return; }
    ts.forEachChild(node, visit);
  };
  try { visit(source); } catch { continue; }
  if (at) {
    const { line, character } = source.getLineAndCharacterOfPosition(at.getStart(source));
    found.push(`${path}:${line + 1}:${character + 1}`);
  }
}
console.log(JSON.stringify({ checked, found: found.length, seconds: (Date.now() - started) / 1000 }));
for (const f of found.slice(0, 50)) console.log(f);
