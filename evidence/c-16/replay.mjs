// SPDX-License-Identifier: MIT
// Replay the pins affected by the final tightening of ambient global proof.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [mode, first, second, output] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const write = (value) => writeFileSync(output, JSON.stringify(value));
if (mode === "select" || mode === "select-members") {
  const pins = read(first);
  const { stats } = read(second);
  if (stats.length !== pins.length || stats.some(({ after }) => !after))
    throw Error("Need the preliminary graph comparison for every pin");
  const selected = new Set(
    stats
      .filter(({ newNodeGlobals, vitestBench, newMemberForms }) =>
        mode === "select-members"
          ? newMemberForms
          : newNodeGlobals || vitestBench,
      )
      .map(({ pin }) => pin),
  );
  write(pins.filter(({ id }) => selected.has(id)));
} else if (mode === "select-deno") {
  const pins = read(first);
  const baseline = new Map(
    read(join(second, "main-run.json")).repos.map((repo) => [repo.id, repo]),
  );
  write(
    pins.filter(({ id, commit }) => {
      const repo = baseline.get(id);
      if (repo?.outcome !== "finished" || repo.commit !== commit)
        throw Error(`Need a comparable baseline for ${id}`);
      const database = new DatabaseSync(
        join(
          second,
          repo.attempt,
          "checkout/.pymtheg/rebuildable/graph.sqlite",
        ),
        { readOnly: true },
      );
      try {
        return database
          .prepare("SELECT path FROM graph_contexts")
          .all()
          .some(({ path }) =>
            /^(?:deno(?:\..+)?|import_map|import-map|importMap)\.jsonc?$/.test(
              basename(path),
            ),
          );
      } finally {
        database.close();
      }
    }),
  );
} else if (mode === "overlay") {
  const preliminary = read(first);
  const replay = read(second);
  const repos = new Map(
    preliminary.repos.map((repo) => [
      repo.id,
      { ...repo, build: repo.build ?? preliminary.release.sha256 },
    ]),
  );
  for (const repo of replay.repos) {
    if (
      repo.outcome !== "finished" ||
      repos.get(repo.id)?.commit !== repo.commit
    )
      throw Error(
        `Expected a finished replay of ${repo.id} at its original pin`,
      );
    repos.set(repo.id, { ...repo, build: replay.release.sha256 });
  }
  write({ ...replay, repos: [...repos.values()] });
} else throw Error("Use select, select-deno, select-members or overlay");
