// probe-cuts.mjs FIXTURE.json : indexes FIXTURE.json (path → text) with the
// TypeScript module and prints how many object-producer lookups were cut.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../../../dist/graph/index.js";
import typescript from "../../../dist/graph/languages/typescript/index.js";
import { producerStatistics } from "../../../dist/graph/languages/typescript/object-producers.js";

const files = JSON.parse(readFileSync(process.argv[2], "utf8"));
const base = mkdtempSync(join(tmpdir(), "c38-cuts-"));
const root = join(base, "tree");
for (const [path, content] of Object.entries(files)) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
const store = new SqliteGraphStore(join(base, "graph.sqlite"));
try {
  await indexProject(root, new LanguageRegistry([typescript]), store);
  console.log("cuts", producerStatistics.cuts);
  for (const link of store.links().filter((l) => l.kind === "calls"))
    console.log(link.file, link.targetName, link.resolution, link.data?.reason ?? "");
} finally {
  store.close();
  rmSync(base, { recursive: true, force: true });
}
