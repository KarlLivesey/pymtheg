// variants.mjs BUILD : for each small source below, whether the flow check
// (flow.ts) reports a non-returning flow, and whether the checker call the
// module would make on it returns within ten seconds (run in a child
// process, which is killed after ten seconds). Prints one line per variant.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const [build] = process.argv.slice(2);
const variants = {
  "throwing-for-head": 'for ((function () { throw 1; })(); (function* () { throw 2; })(); (function* () { throw 3; })()) {\n  console.log("x");\n}\n',
  "throwing-update-only": 'for (let i = 0; i < 3; (function* () { throw 3; })()) {\n  console.log("x");\n}\n',
  "throwing-condition-only": 'for (let i = 0; (function* () { throw 2; })(); i++) {\n  console.log("x");\n}\n',
  "throwing-init-only": 'for ((function () { throw 1; })(); ; ) {\n  console.log("x");\n  break;\n}\n',
  "ordinary-for": 'for (let i = 0; i < 3; i++) {\n  console.log(i);\n}\n',
  "for-of-throwing-iterable": 'for (const x of (function* () { throw 1; })()) {\n  console.log(x);\n}\n',
  "iife-in-loop-body": 'for (let i = 0; i < 3; i++) {\n  (function () { throw 1; })();\n  console.log(i);\n}\n',
};
if (process.argv[3] === "--child") {
  const ts = createRequire(`${build}/package.json`)("typescript");
  const text = variants[process.argv[4]];
  const name = "/v.ts";
  const host = ts.createCompilerHost({});
  const program = ts.createProgram({ rootNames: [name], options: { noEmit: true, allowJs: true }, host: { ...host, fileExists: (f) => f === name || host.fileExists(f), readFile: (f) => (f === name ? text : host.readFile(f)), getSourceFile: (f, v) => (f === name ? ts.createSourceFile(f, text, v, true) : host.getSourceFile(f, v)) } });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(name);
  const { nonReturningFlow } = await import(`${build}/dist/graph/languages/typescript/flow.js`);
  console.log(JSON.stringify({ flagged: !!nonReturningFlow(source, new WeakMap()) }));
  const visit = (node) => {
    if (ts.isIdentifier(node)) checker.getSymbolAtLocation(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  console.log(JSON.stringify({ returned: true }));
} else {
  for (const name of Object.keys(variants)) {
    const run = spawnSync(process.execPath, [process.argv[1], build, "--child", name], { timeout: 10000, encoding: "utf8" });
    const lines = (run.stdout ?? "").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const flagged = lines.find((l) => "flagged" in l)?.flagged;
    const returned = lines.some((l) => l.returned);
    console.log(JSON.stringify({ name, flagged, returned, error: (run.stderr ?? "").split("\n").find((l) => /Error/.test(l)) }));
  }
}
