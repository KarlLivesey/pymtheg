// SPDX-License-Identifier: MIT
// C-17 evidence: on a writable copy of a Go project, indexes with this
// branch's build source-only (the default) and with the opt-in toolchain
// route on, and compares EVERY link the source-only route resolves from the
// standard-library table (library target with `declaring-owner` evidence)
// with the toolchain run's link at the same site. go/types decided it when
// the toolchain run records toolchain provenance; a different unit or symbol
// is a disagreement (listed). Also counts what the toolchain run has where
// the table resolved nothing.
// Usage: node toolchain-agree.mjs --build DIR --project DIR --work DIR --name NAME
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    build: { type: "string" },
    project: { type: "string" },
    work: { type: "string" },
    name: { type: "string" },
  },
});
// A new folder; nothing is removed (WORK is scratch).
if (existsSync(values.work))
  throw Error(`${values.work} exists: use a new --work`);
mkdirSync(values.work, { recursive: true });

function index(label, toolchain) {
  const root = join(values.work, label);
  cpSync(values.project, root, {
    recursive: true,
    filter: (path) => !/\/\.git(\/|$)/.test(path) && !path.includes("/.pymtheg"),
  });
  execFileSync("chmod", ["-R", "u+w", root]);
  const cli = (...args) =>
    execFileSync(
      process.execPath,
      [join(values.build, "dist/cli/main.js"), ...args],
      { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 },
    );
  cli("init", ".", "--name", "c17", "--format", "json");
  if (toolchain)
    writeFileSync(
      join(root, ".pymtheg/settings.json"),
      JSON.stringify({
        version: 1,
        scenarios: {},
        graph: { toolchain: { go: true } },
      }),
    );
  let report = "";
  try {
    report = cli("graph", "index", "--root", ".", "--json");
  } catch (error) {
    if (error.status !== 2) throw error; // 2: incomplete, graph kept
    report = error.stdout;
  }
  const db = new DatabaseSync(
    join(root, ".pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );
  const library = db.prepare(
    "SELECT ecosystem, unit, symbol, evidence FROM graph_library_targets WHERE link=? AND role='target'",
  );
  const links = new Map();
  for (const row of db
    .prepare(
      "SELECT id, file, kind, resolution, target, body FROM graph_links WHERE module='go'",
    )
    .iterate()) {
    const body = JSON.parse(row.body);
    links.set(
      `${row.file}\u0000${row.kind}\u0000${body.range.start}\u0000${body.range.end}\u0000${body.targetName}`,
      {
        file: row.file,
        kind: row.kind,
        start: body.range.start,
        name: body.targetName,
        resolution: row.resolution,
        library: row.resolution === "library" ? library.get(row.id) : undefined,
        toolchain: body.data?.toolchain,
      },
    );
  }
  db.close();
  let notes = [];
  try {
    notes = JSON.parse(report).toolchains ?? [];
  } catch {
    notes = [];
  }
  return { links, notes };
}

const off = index("source-only", false);
const on = index("toolchain", true);
const out = {
  project: values.name,
  toolchainNotes: on.notes.map((item) => ({
    status: item.note?.status,
    universeClean: item.note?.universeClean,
    configuration: item.note?.configuration,
  })),
  tableResolved: 0,
  goTypesDecided: 0,
  agree: 0,
  disagreements: [],
  notDecidedByGoTypes: {},
  toolchainOwnerWhereTableNone: 0,
};
for (const [key, link] of off.links) {
  const other = on.links.get(key);
  if (link.library?.evidence === "declaring-owner") {
    out.tableResolved++;
    const decided =
      other?.toolchain?.origin === "toolchain" && !!other.library;
    if (!decided) {
      const why = !other
        ? "site absent"
        : other.library
          ? "same table answer (no go/types fact for the link)"
          : `toolchain: ${other.resolution}`;
      out.notDecidedByGoTypes[why] = (out.notDecidedByGoTypes[why] ?? 0) + 1;
      if (other?.library && other.library.symbol !== link.library.symbol)
        out.disagreements.push({ ...link, toolchainLibrary: other.library });
      continue;
    }
    out.goTypesDecided++;
    if (
      other.library.unit === link.library.unit &&
      other.library.symbol === link.library.symbol
    )
      out.agree++;
    else
      out.disagreements.push({
        file: link.file,
        kind: link.kind,
        start: link.start,
        name: link.name,
        table: link.library,
        goTypes: other.library,
      });
  } else if (
    link.resolution === "unresolved" &&
    other?.library?.evidence === "declaring-owner" &&
    other.library.ecosystem === "go-std"
  )
    out.toolchainOwnerWhereTableNone++;
}
out.disagreementCount = out.disagreements.length;
console.log(JSON.stringify(out, null, 1));
