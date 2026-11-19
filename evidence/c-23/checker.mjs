// SPDX-License-Identifier: MIT
// Query the pinned tsc binder/checker over the graph's captured project inputs.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

const [scratch, receipt, build, draw] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const load = (path) =>
  import(pathToFileURL(resolve(build, "dist/graph", path)));
const { projectModel, toVirtual } = await load(
  "languages/typescript/project.js",
);
const { DependencyInputs } = await load("dependency-inputs.js");
const byPin = new Map(read(receipt).repos.map((repo) => [repo.id, repo]));
const location = (node) => {
  const file = node.getSourceFile();
  const owner =
    node.parent && ts.isTypeLiteralNode(node.parent)
      ? node.parent.parent
      : node.parent;
  return {
    path: file.fileName.slice(1),
    start: node.getStart(file),
    line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
    kind: ts.SyntaxKind[node.kind],
    name: node.name?.getText(file)?.slice(0, 100),
    owner: owner?.name?.getText(file)?.slice(0, 100),
    text: node.getWidth(file) <= 180 ? node.getText(file) : undefined,
  };
};
const unique = (rows) => [
  ...new Map(rows.map((row) => [JSON.stringify(row), row])).values(),
];

function inspect(program, file, row) {
  if (!file) return { absent: true };
  const checker = program.getTypeChecker();
  const token = ts.getTokenAtPosition(file, row.start);
  let node = token;
  let call;
  for (
    let ancestor = token;
    ancestor && !ts.isSourceFile(ancestor);
    ancestor = ancestor.parent
  ) {
    if (ancestor.getStart(file) === row.start && ancestor.end === row.end)
      node = ancestor;
    if (
      (ts.isCallExpression(ancestor) || ts.isNewExpression(ancestor)) &&
      ancestor.expression.getStart(file) <= row.start &&
      ancestor.expression.end >= row.end
    ) {
      call = ancestor;
      break;
    }
  }
  const selector = call && row.kind === "calls" ? call.expression : node;
  const use = ts.isPropertyAccessExpression(selector)
    ? selector.name
    : ts.isQualifiedName(selector)
      ? selector.right
      : selector;
  const symbol =
    checker.getSymbolAtLocation(use) ?? checker.getSymbolAtLocation(token);
  const selected =
    symbol && symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  const type = checker.getTypeAtLocation(selector);
  const receiver =
    ts.isPropertyAccessExpression(selector) ||
    ts.isElementAccessExpression(selector)
      ? checker.getTypeAtLocation(selector.expression)
      : undefined;
  const binding = symbol && symbol !== selected && symbol.declarations?.[0];
  const importDeclaration =
    binding && ts.findAncestor(binding, ts.isImportDeclaration);
  const boundModule =
    importDeclaration &&
    ts.isStringLiteralLike(importDeclaration.moduleSpecifier)
      ? importDeclaration.moduleSpecifier
      : undefined;
  const literal =
    boundModule ??
    (ts.isStringLiteralLike(use) &&
      (ts.isImportDeclaration(use.parent) ||
        ts.isExportDeclaration(use.parent) ||
        ts.isExternalModuleReference(use.parent) ||
        ts.isCallExpression(use.parent)) &&
      use);
  const modulePath =
    literal &&
    program.getResolvedModuleFromModuleSpecifier(literal, file)?.resolvedModule
      ?.resolvedFileName;
  const signature =
    call && row.kind === "calls"
      ? checker.getResolvedSignature(call)?.declaration
      : undefined;
  const typeKind = (t) =>
    !t
      ? undefined
      : t.isUnion()
        ? "union"
        : t.isIntersection()
          ? "intersection"
          : t.flags & ts.TypeFlags.Any
            ? t.intrinsicName === "error"
              ? "error"
              : "any"
            : t.flags & ts.TypeFlags.Unknown
              ? "unknown"
              : (t.symbol?.getName() ?? ts.TypeFlags[t.flags]);
  return {
    selector: selector.getText(file).slice(0, 100),
    symbol: selected?.getName(),
    type: typeKind(type),
    receiver: typeKind(receiver),
    module: modulePath ? modulePath.slice(1) : undefined,
    signature: signature && location(signature),
    binding: binding && location(binding),
    declarations: unique((selected?.declarations ?? []).map(location)).slice(
      0,
      12,
    ),
  };
}

for (const [pin, rows] of Map.groupBy(read(draw), (row) => row.pin)) {
  const repo = byPin.get(pin);
  const root = join(scratch, repo.attempt, "checkout");
  const db = new DatabaseSync(join(root, ".pymtheg/rebuildable/graph.sqlite"), {
    readOnly: true,
  });
  const loadRows = (table) =>
    db
      .prepare(`SELECT body FROM ${table} ORDER BY path`)
      .all()
      .map(({ body }) => JSON.parse(body));
  const files = loadRows("graph_files");
  const byPath = new Map(files.map((file) => [file.path, file]));
  const context = loadRows("graph_contexts").filter((file) => !file.dependency);
  const anchor = db.prepare(
    "SELECT json_extract(body,'$.identity') AS identity FROM graph_symbols WHERE file=? AND json_extract(body,'$.range.start')=? ORDER BY id LIMIT 1",
  );
  const model = projectModel(
    files,
    context,
    new DependencyInputs(root, "typescript"),
  );
  const groups = new Map();
  for (const row of rows) {
    const file = byPath.get(row.file);
    if (!file) throw Error(`Missing ${pin} ${row.file}`);
    const owners = model.ties.get(row.file) ?? [
      model.owner.get(row.file) ??
        model.groups.find((group) => group.roots.includes(toVirtual(row.file))),
    ];
    const line = file.text.slice(0, row.start).split("\n").length;
    row.line = line;
    row.snippet = file.text.split("\n")[line - 1]?.trim().slice(0, 240);
    if (row.id) {
      row.stored = JSON.parse(
        db.prepare("SELECT body FROM graph_links WHERE id=?").get(row.id).body,
      ).data;
      row.targets = db
        .prepare(
          "SELECT ecosystem,unit,symbol,version_source AS versionSource FROM graph_library_targets WHERE link=?",
        )
        .all(row.id);
    }
    row.checker = [];
    for (const owner of owners) {
      if (!groups.has(owner)) groups.set(owner, []);
      groups.get(owner).push(row);
    }
  }
  for (const [group, selected] of groups) {
    try {
      if (!group || group.failure)
        throw Error("No readable compiler configuration");
      const program = ts.createProgram({
        rootNames: group.roots,
        options: group.options,
        host: model.host(group),
        projectReferences: group.references,
      });
      for (const row of selected) {
        try {
          row.checker.push({
            config: group.config,
            limitations: group.limitations,
            ...inspect(
              program,
              program.getSourceFile(toVirtual(row.file)),
              row,
            ),
          });
        } catch {
          row.checker.push({ config: group.config, unavailable: true });
        }
      }
    } catch {
      for (const row of selected)
        row.checker.push({ config: group?.config, unavailable: true });
    }
  }
  for (const row of rows) {
    for (const answer of row.checker) {
      for (const declaration of [
        answer.signature,
        ...(answer.declarations ?? []),
      ]) {
        if (declaration && byPath.has(declaration.path))
          declaration.anchor = anchor.get(
            declaration.path,
            declaration.start,
          )?.identity;
      }
    }
    console.log(JSON.stringify(row));
  }
  db.close();
}
