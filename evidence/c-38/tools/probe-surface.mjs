// probe-surface.mjs TSCONFIG FILE : builds the config's program with the
// plain compiler API and times the checker surface (scoped.ts) of FILE, then
// of each export alone (a diagnosis aid; times are observations).
import ts from "typescript";
import { dirname, resolve } from "node:path";
import { checkerSurface } from "../../../dist/graph/languages/typescript/scoped.js";

const [configPath, file] = process.argv.slice(2).map((p) => resolve(p));
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  dirname(configPath),
);
// --forced: the options the module forces (project.ts `forced`).
if (process.argv.includes("--forced"))
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
const source = program.getSourceFile(file);
console.log("files", program.getSourceFiles().length, "found", !!source);
let started = performance.now();
const all = checkerSurface(program, checker, file);
console.log(
  "whole surface",
  Math.round(performance.now() - started),
  "ms",
  all === undefined ? "undefined" : `${all.length} chars`,
);
const module = checker.getSymbolAtLocation(source);
for (const symbol of checker.getExportsOfModule(module)) {
  const fresh = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    oldProgram: program,
  });
  const c = fresh.getTypeChecker();
  started = performance.now();
  const type = c.getTypeOfSymbol(
    symbol.flags & ts.SymbolFlags.Alias ? c.getAliasedSymbol(symbol) : symbol,
  );
  const printed = c.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
  const ms = Math.round(performance.now() - started);
  if (ms > 200) console.log(symbol.name, ms, "ms", printed.slice(0, 120));
}
