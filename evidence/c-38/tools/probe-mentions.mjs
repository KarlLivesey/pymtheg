// probe-mentions.mjs FIXTURE.json TEXT : indexes FIXTURE.json (path → text)
// with the TypeScript module and prints every stored link whose data
// mentions TEXT, with its file.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../../../dist/graph/index.js";
import typescript from "../../../dist/graph/languages/typescript/index.js";

const [fixture, text] = process.argv.slice(2);
const files = JSON.parse(readFileSync(fixture, "utf8"));
const base = mkdtempSync(join(tmpdir(), "c38-mentions-"));
const root = join(base, "tree");
for (const [path, content] of Object.entries(files)) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
const store = new SqliteGraphStore(join(base, "graph.sqlite"));
try {
  await indexProject(root, new LanguageRegistry([typescript]), store);
  for (const file of store.files())
    for (const link of file.result.links)
      if (JSON.stringify(link).includes(text))
        console.log(file.path, JSON.stringify(link).slice(0, 400));
} finally {
  store.close();
  rmSync(base, { recursive: true, force: true });
}
