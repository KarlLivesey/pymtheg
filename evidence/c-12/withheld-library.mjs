// SPDX-License-Identifier: MIT
// Reuse the C-9 library path audit on main's captured facts. Compare each
// withheld candidate to that same source site in the C-12 store.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { PYM_SCRATCH, TMPDIR } = process.env;
const worker = process.argv[2];
const workers = ["0", "1", "2"];
const laneOutput = (lane) => join(PYM_SCRATCH, `library-withheld-${lane}.json`);
if (worker === undefined) {
  await Promise.all(
    workers.map(
      (lane) =>
        new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            ["--max-old-space-size=8192", fileURLToPath(import.meta.url), lane],
            { stdio: "inherit" },
          );
          child.on("error", reject);
          child.on("close", (status) =>
            status === 0
              ? resolve()
              : reject(
                  Error(`Rust path audit worker ${lane} exited ${status}`),
                ),
          );
        }),
    ),
  );
  const report = workers.flatMap((lane) =>
    JSON.parse(readFileSync(laneOutput(lane), "utf8")),
  );
  report.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(
    join(PYM_SCRATCH, "library-withheld.json"),
    JSON.stringify(report, null, 2),
  );
  process.exit(0);
}
const get = (path) =>
  import(pathToFileURL(join(PYM_SCRATCH, "main-source/dist/graph", path)));
const { SqliteGraphStore } = await get("store.js");
const { matchesPattern } = await get("registry.js");
const { default: rust } = await get("languages/rust/index.js");
const { resolveRust } = await get("languages/rust/resolve.js");
const runs = (name) =>
  JSON.parse(readFileSync(join(TMPDIR, name), "utf8")).repos;
const candidate = new Map(
  runs("candidate-run.json").map((repo) => [repo.id, repo]),
);
const site = (link) =>
  JSON.stringify([
    link.file,
    link.kind,
    link.origin,
    link.range.start,
    link.range.end,
    link.targetName,
    link.sourceKey,
  ]);
const add = (rows, reason) => (rows[reason] = (rows[reason] ?? 0) + 1);
const open = (repo) =>
  new SqliteGraphStore(
    join(TMPDIR, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    undefined,
    { readOnly: true },
  );
const report = [];
for (const [index, repo] of runs("main-run.json").entries()) {
  if (workers[index % workers.length] !== worker) continue;
  const current = candidate.get(repo.id);
  if (repo.outcome !== "finished" || current?.outcome !== "finished") continue;
  const a = open(repo),
    b = open(current);
  try {
    console.error(`Auditing retained Rust library paths in ${repo.id}`);
    const newTargets = new Map();
    for (const link of b.moduleLinks("rust")) {
      if (
        link.resolution === "resolved" ||
        (link.resolution === "library" &&
          link.libraries?.some(({ symbol }) => symbol !== undefined))
      )
        newTargets.set(
          site(link),
          link.data?.assumes?.includes("rust-external-macro-name") ?? false,
        );
    }
    const totals = { id: repo.id, main: {}, proven: {}, included: {} };
    resolveRust(
      {
        projectId: a.projectId,
        files: a
          .filesAt(
            a
              .fileSummaries()
              .filter(({ module }) => module === "rust")
              .map(({ path }) => path),
          )
          .map(({ path, module, result: { status, diagnostics, data } }) => ({
            path,
            module,
            result: { status, diagnostics, data },
          })),
        contextFiles: a
          .contexts()
          .filter(({ path }) =>
            rust.contextFiles.some((pattern) => matchesPattern(path, pattern)),
          ),
        symbols: a.findSymbols().filter(({ module }) => module === "rust"),
        links: a.moduleLinks("rust"),
      },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        withheld(link, _beforeC9, entry) {
          if (!entry) return;
          add(totals.main, entry.reason);
          const credited = newTargets.get(site(link));
          if (credited !== false) add(totals.proven, entry.reason);
          if (credited === undefined) add(totals.included, entry.reason);
        },
      },
    );
    report.push(totals);
  } finally {
    a.close();
    b.close();
  }
}
writeFileSync(laneOutput(worker), JSON.stringify(report));
