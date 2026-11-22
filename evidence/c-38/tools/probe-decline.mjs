// probe-decline.mjs TSCONFIG FILE... : builds the config's program with the
// options the module forces and reports, for each FILE, whether the checker
// surface (scoped.ts) is defined, and for each top-level declaration
// without a written type whose printed type is elided (`...`). A diagnosis
// aid for edits that took the full path.
import ts from "typescript";
import { dirname, resolve } from "node:path";
import { checkerSurface } from "../../../dist/graph/languages/typescript/scoped.js";

const [configPath, ...files] = process.argv.slice(2).map((p) => resolve(p));
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  dirname(configPath),
);
Object.assign(parsed.options, {
  allowJs: true,
  noEmit: true,
  skipLibCheck: true,
  ...(!parsed.options.types && !parsed.options.typeRoots ? { types: [] } : {}),
  maxNodeModuleJsDepth: 0,
});
const program = ts.createProgram({
  rootNames: parsed.fileNames,
  options: parsed.options,
});
const checker = program.getTypeChecker();
for (const file of files) {
  const source = program.getSourceFile(file);
  const surface = source && checkerSurface(program, checker, file);
  console.log(
    file.slice(dirname(configPath).length + 1),
    !source ? "not in program" : surface === undefined ? "declines" : "defined",
  );
  if (!source || surface !== undefined) continue;
  const visit = (node) => {
    const typed =
      (ts.isVariableDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)) &&
      !node.type;
    if (typed) {
      const type = ts.isVariableDeclaration(node)
        ? checker.getTypeAtLocation(node)
        : checker.getTypeAtLocation(node);
      const printed = checker.typeToString(
        type,
        undefined,
        ts.TypeFormatFlags.NoTruncation,
      );
      if (printed.includes("..."))
        console.log("  elided", node.getStart(), printed.slice(0, 160));
    }
    if (
      !ts.isFunctionLike(node) ||
      ts.isSourceFile(node) ||
      !("body" in node) ||
      !node.body
    )
      ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
}
