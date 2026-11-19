// SPDX-License-Identifier: MIT
// Attribute stored opacity to the resolver's observed macro-scope guards.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const [build, runFile, work, output, lane] = process.argv.slice(2);
const seed = process.env.PYM_MACRO_CENSUS_SEED;
const sampleKinds = new Set(["derive", "attribute", "other"]);
function keepSample(samples, kind, sample) {
  const group = (samples[kind] ??= []);
  group.push(sample);
  group.sort((a, b) => a.rank.localeCompare(b.rank));
  if (group.length > 50) group.pop();
}
const lanes = ["0", "1", "2"];
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const repos = read(runFile).repos.sort((a, b) =>
  a.id < b.id ? -1 : Number(a.id > b.id),
);
const tally = (counts, name, n = 1) => (counts[name] = (counts[name] ?? 0) + n);
const addCounts = (to, from) => {
  for (const [name, count] of Object.entries(from)) tally(to, name, count);
};
const fresh = () => ({
  links: 0,
  names: Object.create(null),
  constructs: Object.create(null),
});
const kinds = [
  "derive",
  "attribute",
  "external-item",
  "local-item",
  "block",
  "other",
];
const rows = () => Object.fromEntries(kinds.map((kind) => [kind, fresh()]));
if (lane === undefined) {
  const script = fileURLToPath(import.meta.url);
  await Promise.all(
    lanes.map(
      (id) =>
        new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              "--max-old-space-size=8192",
              script,
              build,
              runFile,
              work,
              output,
              id,
            ],
            { stdio: "inherit" },
          );
          child.on("error", reject);
          child.on("close", (code) =>
            code === 0
              ? resolve()
              : reject(Error(`Macro audit worker ${id} exited ${code}`)),
          );
        }),
    ),
  );
  const totals = rows();
  const pins = lanes.flatMap((id) => read(`${output}.${id}.json`));
  const expectedPins = repos.map(({ id }) => id);
  if (
    JSON.stringify(pins.map(({ id }) => id).sort()) !==
    JSON.stringify(expectedPins)
  )
    throw Error("Macro audit must cover each pin exactly once");
  for (const pin of pins)
    for (const kind of kinds) {
      totals[kind].links += pin.kinds[kind].links;
      addCounts(totals[kind].names, pin.kinds[kind].names);
      addCounts(totals[kind].constructs, pin.kinds[kind].constructs);
    }
  const sample = {};
  if (seed)
    for (const pin of pins)
      for (const [kind, group] of Object.entries(pin.sample))
        for (const link of group) keepSample(sample, kind, link);
  writeFileSync(output, JSON.stringify({ totals, pins, ...(seed && { seed, sample }) }, null, 2));
  const sorted = (counts) =>
    Object.entries(counts).sort(
      ([a, n], [b, m]) => m - n || a.localeCompare(b),
    );
  for (const [kind, row] of Object.entries(totals))
    console.log(
      kind,
      row.links,
      sorted(row.names)
        .filter(
          ([name]) =>
            !["no recorded final macro origin", "non-parse link"].includes(
              name,
            ),
        )
        .slice(0, 15),
      sorted(row.constructs),
    );
  process.exit(0);
}

const load = (path) => import(pathToFileURL(join(build, "dist/graph", path)));
const { SqliteGraphStore } = await load("store.js");
const { matchesPattern } = await load("registry.js");
const { default: rust } = await load("languages/rust/index.js");
const { resolveRust } = await load("languages/rust/resolve.js");
const report = [];
for (const [index, repo] of repos.entries()) {
  if (lanes[index % lanes.length] !== lane) continue;
  if (repo.outcome !== "finished") throw Error(`Unfinished pin ${repo.id}`);
  console.error(`Attributing Rust macro opacity in ${repo.id}`);
  const checkout = join(work, repo.attempt, "checkout");
  const graphPath = join(checkout, ".pymtheg/rebuildable/graph.sqlite");
  const store = new SqliteGraphStore(graphPath, undefined, { readOnly: true });
  const database = new DatabaseSync(graphPath, { readOnly: true });
  const totals = rows();
  const sample = {};
  try {
    const selected = new Map(
      database
        .prepare(
          `SELECT id, body FROM graph_links
      WHERE module='rust' AND resolution='unresolved' AND
      (json_extract(body, '$.data.reason') LIKE '%opaque-item-may-shadow-name%' OR
       json_extract(body, '$.data.uncertainty') LIKE '%opaque-item-may-shadow-name%')`,
        )
        .all()
        .map(({ id, body }) => [id, seed ? JSON.parse(body) : undefined]),
    );
    function recordSample(kind, link, blocker) {
      if (!seed || !sampleKinds.has(kind)) return;
      const { id, file, range, targetName, data } = link;
      const rank = createHash("sha256").update(`${seed}|${repo.id}|${id}`).digest("hex");
      keepSample(sample, kind, {
        rank, repo: repo.id, file, range, targetName,
        reason: data?.reason ?? data?.uncertainty,
        macroBody: data?.macroBody,
        blocker: blocker && { name: blocker.name, construct: blocker.construct, origin: blocker.origin },
      });
    }
    const visited = new Set();
    const constructs = new Map();
    function localConstruct(blocker) {
      const { definition, construct } = blocker;
      if (!definition || construct !== "opaque transcriber") return construct;
      if (!constructs.has(definition.id)) {
        const body = readFileSync(
          join(checkout, definition.file),
          "utf8",
        ).slice(definition.range.start, definition.range.end);
        const tags = [];
        if (/:(?:tt|item|stmt)\b/.test(body))
          tags.push("token/item/statement fragments");
        if (/=>[\s\S]*#\[/.test(body)) tags.push("attributes in output");
        if (/=>[\s\S]*\bmacro_rules\s*!/.test(body))
          tags.push("nested macro definitions");
        if (/=>[\s\S]*\$\(/.test(body)) tags.push("repeated output tokens");
        constructs.set(
          definition.id,
          tags.join(" + ") || "other item header or dynamic macro call",
        );
      }
      return constructs.get(definition.id);
    }
    resolveRust(
      {
        projectId: store.projectId,
        files: store
          .filesAt(
            store
              .fileSummaries()
              .filter(({ module }) => module === "rust")
              .map(({ path }) => path),
          )
          .map(({ path, module, result: { status, diagnostics, data } }) => ({
            path,
            module,
            result: { status, diagnostics, data },
          })),
        contextFiles: store
          .contexts()
          .filter(({ path }) =>
            rust.contextFiles.some((pattern) => matchesPattern(path, pattern)),
          ),
        symbols: store.findSymbols().filter(({ module }) => module === "rust"),
        links: store.moduleLinks("rust"),
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        includes: (link) => selected.has(link.id),
        blocked(link, blockers) {
          if (visited.has(link.id))
            throw Error(`Macro audit revisited link ${link.id}`);
          visited.add(link.id);
          const primary =
            blockers.find((blocker) => blocker.name !== "unattributed scope") ??
            blockers[0];
          const row = totals[primary?.kind ?? "other"];
          row.links++;
          tally(row.names, primary?.name ?? "no recorded final macro origin");
          const construct =
            primary &&
            (primary.kind === "local-item"
              ? localConstruct(primary)
              : primary.construct);
          if (construct) tally(row.constructs, construct);
          recordSample(primary?.kind ?? "other", selected.get(link.id) ?? link, primary);
        },
      },
    );
    const unvisited = selected.size - visited.size;
    if (unvisited) {
      totals.other.links += unvisited;
      tally(totals.other.names, "non-parse link", unvisited);
      if (seed)
        for (const [id, link] of selected)
          if (!visited.has(id)) recordSample("other", link, { name: "non-parse link" });
    }
    report.push({ id: repo.id, kinds: totals, ...(seed && { sample }) });
  } finally {
    store.close();
    database.close();
  }
}
writeFileSync(`${output}.${lane}.json`, JSON.stringify(report));
