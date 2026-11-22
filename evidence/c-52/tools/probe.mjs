// probe-local.mjs DIST FIXTURE.json : indexes FIXTURE.json (path → text)
// with DIST's TypeScript module and prints every link with its outcome,
// reason, local shape (diagnostic build) and target identity.
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [dist, fixture] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(resolve(dist, path)).href);
const { indexProject, LanguageRegistry, SqliteGraphStore } =
  await load("graph/index.js");
const typescript = (await load("graph/languages/typescript/index.js")).default;
const files = JSON.parse(readFileSync(fixture, "utf8"));
const base = mkdtempSync(join(tmpdir(), "c41-probe-"));
const root = join(base, "tree");
for (const [path, content] of Object.entries(files)) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
const store = new SqliteGraphStore(join(base, "graph.sqlite"));
try {
  await indexProject(root, new LanguageRegistry([typescript]), store);
  for (const link of store.links()) {
    if (link.kind === "contains") continue;
    const target = link.targetId ? store.getSymbol(link.targetId) : undefined;
    console.log(
      [
        link.file,
        link.kind,
        link.targetName,
        link.resolution,
        link.data?.reason ?? "",
        JSON.stringify(link.data?.assumes ?? []),
        link.data?.unbuiltEntry?.source ?? "",
        target ? `${target.file}#${target.identity}` : "",
      ].join(" | "),
    );
  }
  console.log("symbols", store.findSymbols().length);
} finally {
  store.close();
  rmSync(base, { recursive: true, force: true });
}
