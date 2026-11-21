// SPDX-License-Identifier: MIT
// Verify the pinned Hono pack configuration as data, then enable its measured
// declaration route in a disposable copy of the compiled analyzer.
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, sep } from "node:path";
import ts from "typescript";

const [scratchPath, checkout, artifact, archivePath] = process.argv.slice(2);
const scratch = realpathSync(scratchPath);
const confined = (path) => {
  const real = realpathSync(path);
  if (!real.startsWith(scratch + sep)) throw Error("Expected a scratch input");
  return real;
};
const source = (path) => readFileSync(confined(join(checkout, path)), "utf8");
const manifest = JSON.parse(source("package.json"));
const ast = ts.createSourceFile(
  "vite.config.ts",
  source("vite.config.ts"),
  ts.ScriptTarget.Latest,
  true,
);
const requireFact = (fact) => {
  if (!fact) throw Error("Pinned Hono build does not match the study");
};
const declarations = ast.statements
  .filter(ts.isVariableStatement)
  .flatMap((node) => [...node.declarationList.declarations]);
const variable = (name) =>
  declarations.find(
    (node) => ts.isIdentifier(node.name) && node.name.text === name,
  )?.initializer;
const field = (node, name) =>
  node && ts.isObjectLiteralExpression(node)
    ? node.properties.find((item) => item.name?.getText(ast) === name)
    : undefined;
const value = (node, name) => {
  const item = field(node, name);
  return item && ts.isPropertyAssignment(item) ? item.initializer : undefined;
};
const literal = (node) => node && ts.isStringLiteral(node) && node.text;
const array = (node) =>
  node && ts.isArrayLiteralExpression(node)
    ? node.elements.map((element) => element.getText(ast))
    : [];
const entry = variable("entry");
const common = variable("common");
const assignment = ast.statements.find(ts.isExportAssignment);
const expression = assignment?.expression;
const pack =
  expression && ts.isCallExpression(expression)
    ? value(expression.arguments[0], "pack")
    : undefined;
const types =
  pack && ts.isArrayLiteralExpression(pack)
    ? pack.elements.find(
        (item) => literal(value(item, "outDir")) === "dist/types",
      )
    : undefined;
const extensions = value(types, "outExtensions");
requireFact(
  manifest.name === "hono" &&
    manifest.version === "4.13.19" &&
    manifest.scripts.build ===
      "pnpm run remove-dist && vp pack && pnpm run copy:package.cjs.json && publint" &&
    entry &&
    ts.isArrayLiteralExpression(entry) &&
    JSON.stringify(entry.elements.map(literal)) ===
      JSON.stringify([
        "src/**/*.ts",
        "!src/**/*.test.ts",
        "!src/**/*.test.tsx",
      ]) &&
    common &&
    ts.isObjectLiteralExpression(common) &&
    common.properties.some(
      (item) =>
        ts.isShorthandPropertyAssignment(item) && item.name.text === "entry",
    ) &&
    value(common, "unbundle")?.kind === ts.SyntaxKind.TrueKeyword &&
    literal(value(common, "tsconfig")) === "tsconfig.build.json" &&
    types &&
    ts.isObjectLiteralExpression(types) &&
    types.properties.some(
      (item) =>
        ts.isSpreadAssignment(item) &&
        item.expression.getText(ast) === "common",
    ) &&
    value(value(types, "dts"), "emitDtsOnly")?.kind ===
      ts.SyntaxKind.TrueKeyword &&
    extensions &&
    ts.isArrowFunction(extensions) &&
    ts.isParenthesizedExpression(extensions.body) &&
    literal(value(extensions.body.expression, "dts")) === ".d.ts" &&
    JSON.stringify(array(value(types, "plugins"))) ===
      JSON.stringify([
        "removeDtsPrivateFieldsPlugin",
        "keepBarrelImportsInDts",
        "appendExportEmptyToDts",
      ]),
);

const file = confined(
  join(artifact, "dist/graph/languages/typescript/workspace-entries.js"),
);
const archive = confined(archivePath);
requireFact(
  createHash("sha512").update(readFileSync(archive)).digest("base64") ===
    "KmXvQAXwcAHV+muzbIwoJ23niEB5nMoDVr9WcRkU8mvjUECm/1+7v4Jgp7P7a+H6MLFrh+vXrGonGrGS+RQfkA==",
);
const outputs = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
  .split("\n")
  .filter((name) => /^package\/dist\/types\/[\w./-]+\.d\.ts$/.test(name))
  .map((name) => name.slice("package".length));
requireFact(outputs.length && new Set(outputs).size === outputs.length);
const code = readFileSync(file, "utf8");
const needle = "function plainBuild(root, manifest) {";
const lookup = "proof(root, output) {";
requireFact(code.split(needle).length === 2 && code.split(lookup).length === 2);
writeFileSync(
  file,
  `const studyOutputs = new Set(${JSON.stringify(outputs)});\n` +
    code
      .replace(
        needle,
        `${needle}
    // Study only. The shipping analyzer requires a real plain build.
    if (root === "/" && manifest.json.name === "hono" && manifest.json.version === "4.13.19")
        return {config:"/tsconfig.build.json",build:false,clean:undefined};`,
      )
      .replace(
        lookup,
        `${lookup}
    if (root === "/" && packages.get(root)?.json.name === "hono" && !studyOutputs.has(output))
        return undefined;`,
      ),
);
