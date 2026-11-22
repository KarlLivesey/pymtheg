// blockers.mjs GRAPH.sqlite : stored TypeScript results that the scoped
// path's candidate check looks at: renamed for the compiler, compiler-limit
// links, stack-limit diagnostics, failed results (with their kind).
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(process.argv[2], { readOnly: true });
const counts = {};
const add = (what, path) => {
  counts[what] ??= { n: 0, first: path };
  counts[what].n++;
};
for (const row of db.prepare("SELECT path, body FROM graph_files").iterate()) {
  const { result, module } = JSON.parse(row.body);
  if (module !== "typescript") continue;
  const data = result.data ?? {};
  if (data.renamedForCompiler) add("renamedForCompiler", row.path);
  if (data.dynamicScopeOccurrences) add("dynamicScopeOccurrences", row.path);
  if (result.links.some((link) => link.data?.reason === "compiler-limit"))
    add("compiler-limit", row.path);
  if (result.diagnostics.some((d) => /exhausted its stack|overflowed/.test(d.message)))
    add("stack diagnostic", row.path);
  if (result.status === "failed")
    add(data.invalid ? "failed: invalid code" : `failed: ${result.diagnostics[0]?.message.slice(0, 60)}`, row.path);
  if (!Array.isArray(data.loadedBy) && result.status !== "failed") add("no loadedBy", row.path);
}
console.log(JSON.stringify(counts, null, 1));
