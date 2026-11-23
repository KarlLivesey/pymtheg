// SPDX-License-Identifier: MIT
// Probe what the compiler binds at a site, in the owning program the graph
// builds. Usage: node probe.mjs BUILD CHECKOUT FILE NEEDLE
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
const [build, root, file, needle] = process.argv.slice(2);
const load = (p) => import(pathToFileURL(resolve(build, "dist/graph", p)));
const { projectModel, toVirtual } = await load("languages/typescript/project.js");
const { DependencyInputs } = await load("dependency-inputs.js");
const ts = (await import(pathToFileURL(resolve(build, "node_modules/typescript/lib/typescript.js")))).default;
const db = new DatabaseSync(join(root, ".pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
const rows = (t) => db.prepare(`SELECT body FROM ${t} ORDER BY path`).all().map(({ body }) => JSON.parse(body));
const files = rows("graph_files");
const contexts = rows("graph_contexts").filter((f) => !f.dependency);
const model = projectModel(files, contexts, new DependencyInputs(root, "typescript"));
const group = model.owner.get(file);
console.log("owner", group?.config, "roots", group?.roots.length, "failure", group?.failure, "options.types", JSON.stringify(group?.options.types));
const program = ts.createProgram({ rootNames: group.roots, options: group.options, host: model.host(group) });
const checker = program.getTypeChecker();
const source = program.getSourceFile(toVirtual(file));
const at = source.text.indexOf(needle);
const visit = (node) => {
  if (node.getStart(source) <= at && at < node.end) {
    if (ts.isPropertyAccessExpression(node) && node.getText(source) === needle) {
      for (const part of [node.expression, node.name]) {
        const symbol = checker.getSymbolAtLocation(part);
        const target = symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        console.log(part.getText(source), "symbol", symbol?.name, "aliased", target?.name,
          (target?.declarations ?? []).map((d) => d.getSourceFile().fileName).join(" | "),
          "type", checker.typeToString(checker.getTypeAtLocation(part)).slice(0, 80));
      }
    }
    ts.forEachChild(node, visit);
  }
};
visit(source);
const rtl = program.getSourceFiles().filter((s) => s.fileName.includes("@testing-library")).map((s) => s.fileName);
console.log("testing-library files in program:", rtl.length, rtl.slice(0, 6));
