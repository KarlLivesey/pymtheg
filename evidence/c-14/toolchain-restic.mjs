// SPDX-License-Identifier: MIT
// C-14 evidence: on writable copies of a Go project, indexes with this
// branch's build source-only (the default) and with the opt-in toolchain
// route on. Reports Go level 2 both ways (resolved checkout links plus
// library links with a symbol, over all Go links), library links by
// evidence kind, and, for every site where both routes record a library
// target, whether they agree (unit and symbol). A source-only library target
// that go/types names differently is a disagreement and is listed. Also
// counts the links the toolchain gives a declaring owner that source-only
// leaves unresolved, split by standard library and dependency (what a
// shipped standard-library method table could at most recover).
// Usage: node toolchain-restic.mjs --build DIR --project DIR --work DIR
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
  },
});
// A new folder; nothing is removed (WORK is scratch).
if (existsSync(values.work)) throw Error(`${values.work} exists: use a new --work`);
mkdirSync(values.work, { recursive: true });

function index(label, toolchain) {
  const root = join(values.work, label);
  cpSync(values.project, root, {
    recursive: true,
    filter: (path) => !/\/\.git(\/|$)/.test(path) && !path.includes("/.pymtheg"),
  });
  execFileSync("chmod", ["-R", "u+w", root]);
  const cli = (...args) =>
    execFileSync(process.execPath, [join(values.build, "dist/cli/main.js"), ...args], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1 << 28,
    });
  cli("init", ".", "--name", "c14", "--format", "json");
  if (toolchain)
    writeFileSync(
      join(root, ".pymtheg/settings.json"),
      JSON.stringify({ version: 1, scenarios: {}, graph: { toolchain: { go: true } } }),
    );
  let report = "";
  try {
    report = cli("graph", "index", "--root", ".", "--json");
  } catch (error) {
    if (error.status !== 2) throw error; // 2: incomplete, graph kept
    report = error.stdout;
  }
  const db = new DatabaseSync(join(root, ".pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  const library = db.prepare(
    "SELECT ecosystem, unit, symbol, evidence FROM graph_library_targets WHERE link=? AND role='target'",
  );
  const links = new Map();
  for (const row of db.prepare("SELECT id, file, kind, resolution, body FROM graph_links WHERE module='go'").iterate()) {
    const body = JSON.parse(row.body);
    links.set(`${row.file}\u0000${row.kind}\u0000${body.range.start}\u0000${body.range.end}\u0000${body.targetName}`, {
      file: row.file,
      kind: row.kind,
      start: body.range.start,
      name: body.targetName,
      resolution: row.resolution,
      library: row.resolution === "library" ? library.get(row.id) : undefined,
      uncertainty: body.data?.uncertainty,
      toolchain: body.data?.toolchain,
    });
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

const score = (links) => {
  const out = { links: 0, resolved: 0, librarySymbol: 0, libraryUnit: 0, level2: 0, byEvidence: {} };
  for (const link of links.values()) {
    out.links++;
    if (link.resolution === "resolved") out.resolved++;
    if (link.library) {
      if (link.library.symbol) out.librarySymbol++;
      else out.libraryUnit++;
      const key = `${link.library.evidence}:${link.library.ecosystem}`;
      out.byEvidence[key] = (out.byEvidence[key] ?? 0) + 1;
    }
  }
  out.level2 = (out.resolved + out.librarySymbol) / out.links;
  return out;
};

const off = index("source-only", false);
const on = index("toolchain", true);
const out = {
  sourceOnly: score(off.links),
  toolchain: score(on.links),
  toolchainNotes: on.notes.map((item) => ({ status: item.note?.status, universeClean: item.note?.universeClean, configuration: item.note?.configuration, decided: item.note?.decided })),
  bothLibrary: 0,
  agree: 0,
  disagreements: [],
  sourceOnlyLibraryWithoutToolchainLibrary: {},
  toolchainOwnerWhereSourceUnresolved: { "go-std": 0, go: 0 },
  memberReasonSourceOnly: 0,
  memberReasonResolvedByToolchain: { "go-std": 0, go: 0 },
  sitesDiffer: 0,
};
for (const [key, link] of off.links) {
  const other = on.links.get(key);
  if (!other) {
    out.sitesDiffer++;
    continue;
  }
  if (link.uncertainty === "library-member-unproven") {
    out.memberReasonSourceOnly++;
    if (other.library?.evidence === "declaring-owner") out.memberReasonResolvedByToolchain[other.library.ecosystem]++;
  }
  if (link.library && other.library) {
    out.bothLibrary++;
    if (link.library.unit === other.library.unit && (link.library.symbol ?? null) === (other.library.symbol ?? null)) out.agree++;
    else out.disagreements.push({ file: link.file, kind: link.kind, start: link.start, name: link.name, sourceOnly: link.library, toolchain: other.library });
  } else if (link.library) {
    const why = other.resolution === "resolved" ? "toolchain: checkout target" : `toolchain: ${other.resolution}`;
    out.sourceOnlyLibraryWithoutToolchainLibrary[why] = (out.sourceOnlyLibraryWithoutToolchainLibrary[why] ?? 0) + 1;
  }
  if (!link.library && link.resolution === "unresolved" && other.library?.evidence === "declaring-owner")
    out.toolchainOwnerWhereSourceUnresolved[other.library.ecosystem]++;
}
out.disagreementCount = out.disagreements.length;
out.disagreements = out.disagreements.slice(0, 100);
console.log(JSON.stringify(out, null, 1));
