// SPDX-License-Identifier: MIT
// Print the owning config (and its types option) the graph's project model
// assigns to given files. Usage: node owner.mjs BUILD CHECKOUT FILE...
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
const [build, root, ...paths] = process.argv.slice(2);
const load = (p) => import(pathToFileURL(resolve(build, "dist/graph", p)));
const { projectModel, toVirtual } = await load("languages/typescript/project.js");
const { DependencyInputs } = await load("dependency-inputs.js");
const db = new DatabaseSync(join(root, ".pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
const rows = (t) => db.prepare(`SELECT body FROM ${t} ORDER BY path`).all().map(({ body }) => JSON.parse(body));
const files = rows("graph_files");
const contexts = rows("graph_contexts").filter((f) => !f.dependency);
const model = projectModel(files, contexts, new DependencyInputs(root, "typescript"));
for (const p of paths) {
  const ties = model.ties.get(p);
  const owner = model.owner.get(p) ?? model.groups.find((g) => g.roots.includes(toVirtual(p)));
  for (const g of ties ?? [owner])
    console.log(p, "->", g?.config, JSON.stringify(g?.options?.types), g?.failure ?? "", ties ? "(tie)" : "");
}
console.log("configs:", model.groups.map((g) => g.config).filter((c) => c && !c.includes("/")).join(" "));
