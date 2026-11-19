// SPDX-License-Identifier: MIT
// Select pins where a captured type request can overlap a stored test global.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { competingTestNames } from "../../dist/graph/languages/typescript/global-types.js";

const [manifest, scratch, output] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const previous = new Map(
  read(join(scratch, "merged-run.json")).repos.map((repo) => [repo.id, repo]),
);
const selected = read(manifest).filter(({ id, commit }) => {
  const repo = previous.get(id);
  if (repo?.commit !== commit || repo.outcome !== "finished")
    throw Error(`Missing prior graph for ${id}`);
  const db = new DatabaseSync(
    join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );
  try {
    const names = new Set(
      db
        .prepare(
          `SELECT DISTINCT t.symbol AS name
        FROM graph_library_targets t JOIN graph_links l ON l.id=t.link
        WHERE l.module='typescript' AND t.ecosystem='npm'
        AND t.unit IN ('jest','mocha','vitest')
        AND t.symbol=json_extract(l.body,'$.targetName')`,
        )
        .all()
        .map(({ name }) => name),
    );
    if (!names.size) return false;
    const requests = new Set();
    const overlaps = (request) =>
      competingTestNames(request)?.some((name) => names.has(name));
    for (const { path, body } of db
      .prepare("SELECT path, body FROM graph_contexts")
      .iterate()) {
      if (!path.endsWith(".json")) continue;
      const { status, text } = JSON.parse(body);
      if (status !== "clean") continue;
      const { config } = ts.parseConfigFileTextToJson(path, text);
      const types = config?.compilerOptions?.types;
      if (Array.isArray(types))
        for (const request of types)
          if (overlaps(request)) requests.add(request);
    }
    for (const { path, text } of db
      .prepare(
        `SELECT path, json_extract(body,'$.text') AS text
      FROM graph_files WHERE json_extract(body,'$.module')='typescript'`,
      )
      .iterate()) {
      if (typeof text !== "string") continue;
      const { typeReferenceDirectives, importedFiles } = ts.preProcessFile(
        text,
        true,
        true,
      );
      for (const { fileName } of typeReferenceDirectives)
        if (overlaps(fileName)) requests.add(fileName);
      if (!importedFiles.some(({ fileName }) => overlaps(fileName))) continue;
      const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest);
      for (const statement of source.statements)
        if (
          ts.isImportDeclaration(statement) &&
          !statement.importClause &&
          ts.isStringLiteralLike(statement.moduleSpecifier)
        ) {
          const request = statement.moduleSpecifier.text;
          if (overlaps(request)) requests.add(request);
        }
    }
    if (requests.size) console.log(id, [...requests].sort().join(", "));
    return requests.size > 0;
  } finally {
    db.close();
  }
});
writeFileSync(output, JSON.stringify(selected));
