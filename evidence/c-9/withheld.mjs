// SPDX-License-Identifier: MIT
// Replay the candidate's Rust resolver over the captured graph, with and
// without the module-level explicit-import rule. No Rust source is reparsed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const scratch = process.env.PYM_SCRATCH;
const build =
  process.env.PYM_C9_AUDIT_BUILD ?? join(scratch, "candidate-build");
const built = (path) => import(pathToFileURL(join(build, "dist/graph", path)));
const { SqliteGraphStore } = await built("store.js");
const { matchesPattern } = await built("registry.js");
const { default: rust } = await built("languages/rust/index.js");
const { resolveRust } = await built("languages/rust/resolve.js");
const selected = new Set(process.argv.slice(2));
const verifyOnly = selected.delete("--verify-only");
const { repos } = JSON.parse(
  readFileSync(join(scratch, "candidate-run.json"), "utf8"),
);
const increment = (counts, key) => (counts[key] = (counts[key] ?? 0) + 1);

function stats() {
  return {
    reasons: {},
    details: {},
    exampleSites: {},
    macros: new Map(),
    sitesWithKnownMacro: 0,
  };
}

function add(result, entry, link) {
  if (!entry) return;
  increment(result.reasons, entry.reason);
  increment(result.details, entry.detail);
  if (entry.macros.some((macro) => macro.known)) result.sitesWithKnownMacro++;
  for (const macro of entry.macros) {
    const key = JSON.stringify([macro.file, macro.start, macro.name]);
    const previous = result.macros.get(key);
    result.macros.set(
      key,
      result.macros.has(key) && previous !== macro.known
        ? undefined
        : macro.known,
    );
  }
  const sites = (result.exampleSites[entry.reason] ??= []);
  if (
    sites.length < 4 &&
    !sites.some(
      (site) => site.file === link.file && site.name === link.targetName,
    )
  ) {
    sites.push({
      file: link.file,
      offset: link.range.start,
      name: link.targetName,
      ...entry,
    });
  }
}

function summarize(root, { macros, exampleSites, ...result }) {
  const known = {};
  for (const value of macros.values()) if (value) increment(known, value);
  const lines = new Map();
  const line = (file, offset) => {
    if (!lines.has(file))
      lines.set(file, readFileSync(join(root, file), "utf8"));
    return lines.get(file).slice(0, offset).split("\n").length;
  };
  const examples = Object.fromEntries(
    Object.entries(exampleSites).map(([reason, sites]) => [
      reason,
      sites.map((site) => ({
        ...site,
        line: line(site.file, site.offset),
        macros: site.macros
          .slice(0, 5)
          .map((macro) => ({ ...macro, line: line(macro.file, macro.start) })),
      })),
    ]),
  );
  return { ...result, known, macroOrigins: macros.size, examples };
}

for (const repo of repos) {
  if (selected.size && !selected.has(repo.id)) continue;
  assert.equal(repo.outcome, "finished", repo.id);
  const root = join(scratch, repo.attempt, "checkout");
  const store = new SqliteGraphStore(
    join(root, ".pymtheg/rebuildable/graph.sqlite"),
    undefined,
    { readOnly: true },
  );
  try {
    const links = store.moduleLinks("rust");
    const context = {
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
      links: links.map(({ libraries, ...link }) => ({
        ...link,
        targetId: null,
        targetStatus: null,
        candidates: [],
        resolution: "unresolved",
      })),
    };
    const before = stats();
    const after = stats();
    let gained = 0;
    let lost = 0;
    const audit = {
      withheld(link, previous, next) {
        add(before, previous, link);
        add(after, next, link);
        if (previous && !next) gained++;
        if (!previous && next) lost++;
      },
    };
    const replay = resolveRust(
      context,
      undefined,
      undefined,
      undefined,
      () => {},
      verifyOnly ? undefined : audit,
    );
    const stored = new Map(
      links.flatMap(({ id, resolution, libraries }) =>
        resolution === "library"
          ? [[id, libraries.map(({ id, ...entry }) => entry)]]
          : [],
      ),
    );
    const differences = [];
    for (const { linkId, library } of replay) {
      if (!library) continue;
      if (!isDeepStrictEqual(stored.get(linkId), [library]))
        differences.push({
          linkId,
          previous: stored.get(linkId),
          next: library,
        });
      stored.delete(linkId);
    }
    for (const [linkId, previous] of stored)
      differences.push({ linkId, previous });
    if (verifyOnly) {
      console.log(
        JSON.stringify({
          repo: repo.id,
          changed: differences.length,
          examples: differences.slice(0, 5),
        }),
      );
      continue;
    }
    assert.deepEqual(
      differences.slice(0, 5),
      [],
      `${repo.id} stored Rust decisions`,
    );
    console.log(
      JSON.stringify({
        repo: repo.id,
        pin: repo.commit,
        gained,
        lost,
        before: summarize(root, before),
        after: summarize(root, after),
      }),
    );
  } finally {
    store.close();
  }
}
