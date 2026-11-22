// probe-links.mjs FIXTURE.json FILE : indexes the files of FIXTURE.json
// (path → text) with the TypeScript module and prints FILE's links: kind,
// target name, outcome, reason and target file.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../../../dist/graph/index.js";
import typescript from "../../../dist/graph/languages/typescript/index.js";

const [fixture, file] = process.argv.slice(2);
const files = JSON.parse(readFileSync(fixture, "utf8"));
const base = mkdtempSync(join(tmpdir(), "c38-probe-"));
const root = join(base, "tree");
for (const [path, text] of Object.entries(files)) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
const store = new SqliteGraphStore(join(base, "graph.sqlite"));
try {
  await indexProject(root, new LanguageRegistry([typescript]), store);
  for (const link of store.links().filter((l) => l.file === file))
    console.log(
      link.kind,
      link.targetName,
      link.resolution,
      link.data?.reason ?? "",
      link.targetId ? store.getSymbol(link.targetId)?.file : "",
    );
} finally {
  store.close();
  rmSync(base, { recursive: true, force: true });
}
