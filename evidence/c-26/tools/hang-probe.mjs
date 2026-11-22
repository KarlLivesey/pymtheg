// hang-probe.mjs BUILD ROOT : builds the TypeScript module's program for
// ROOT's files (its own project model and host) and replays the module's
// warm-up, printing each checker call before it is made, so the last line
// printed names the call that does not return.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const [build, root] = process.argv.slice(2);
const ts = createRequire(`${build}/package.json`)("typescript");
const { projectModel } = await import(`${build}/dist/graph/languages/typescript/project.js`);
const tracked = execFileSync("git", ["-C", root, "ls-files", "-z"]).toString().split("\0").filter(Boolean);
const files = tracked.map((path) => ({ path, text: readFileSync(`${root}/${path}`, "utf8"), hash: "", module: "typescript", version: "", result: { status: "clean", diagnostics: [], symbols: [], links: [] } }));
const model = projectModel(files, []);
const group = model.groups[0];
const program = ts.createProgram({ rootNames: group.roots, options: group.options, host: model.host(group) });
const checker = program.getTypeChecker();
console.log("options", JSON.stringify({ target: group.options.target, strict: group.options.strict, allowUnreachableCode: group.options.allowUnreachableCode }));
for (const source of program.getSourceFiles()) {
  if (!source.fileName.startsWith("/h")) continue;
  const where = (node) => {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    return `${line + 1}:${character + 1} ${ts.SyntaxKind[node.kind]} ${JSON.stringify(node.getText(source).slice(0, 50))}`;
  };
  const warm = (node) => {
    if (ts.isVariableDeclaration(node) || ts.isBindingElement(node)) {
      console.log("getTypeAtLocation", where(node.name));
      checker.getTypeAtLocation(node.name);
    } else if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.body) {
      console.log("getSignatureFromDeclaration", where(node));
      const signature = checker.getSignatureFromDeclaration(node);
      if (signature) checker.getReturnTypeOfSignature(signature);
    }
    ts.forEachChild(node, warm);
  };
  warm(source);
  console.log("warm-up returned");
  // What extraction asks next: every identifier's symbol.
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      console.log("getSymbolAtLocation", where(node));
      checker.getSymbolAtLocation(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  console.log("identifiers returned");
}
