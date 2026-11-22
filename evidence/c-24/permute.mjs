// SPDX-License-Identifier: MIT
// C-24: run the Rust resolve phase of a finished graph store on its own
// inputs presented in a seeded random order, and print a digest of the
// answers keyed by link and symbol keys (never by ids). Equal digests for
// different seeds mean the answers do not depend on input order.
// Usage: node permute.mjs BUILD graph.sqlite SEED [SEED ...]
// Seed "sorted" keeps the store's own order. Set OUT=prefix to write each
// seed's answers to prefix-SEED.txt.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [build, path, ...seeds] = process.argv.slice(2);
const root = resolve(build);
const { SqliteGraphStore } = await import(join(root, "dist/graph/store.js"));
const rust = (await import(join(root, "dist/graph/languages/rust/index.js")))
  .default;

function rng(seed) {
  let h = createHash("sha256").update(String(seed)).digest();
  let i = 0;
  return () => {
    if (i + 4 > h.length) {
      h = createHash("sha256").update(h).digest();
      i = 0;
    }
    const v = h.readUInt32LE(i);
    i += 4;
    return v / 2 ** 32;
  };
}
function shuffle(list, random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const store = new SqliteGraphStore(path);
const files = store.files().filter((f) => f.module === "rust");
const contexts = store.contexts().filter((c) => !c.dependency);
const symbols = store.findSymbols().filter((s) => s.module === "rust");
const links = store
  .moduleLinks("rust")
  .map(({ libraries: _l, ...link }) => ({
    ...link,
    targetId: null,
    targetStatus: null,
    candidates: [],
    resolution: "unresolved",
  }));
const projectId = store.projectId;
store.close();
const symbolKey = new Map(
  symbols.map((s) => [s.id, `${s.file}|${s.key}|${s.kind}`]),
);
const linkKey = new Map(
  links.map((l) => [
    l.id,
    `${l.file}|${l.kind}|${l.range.start}-${l.range.end}|${l.targetName}`,
  ]),
);
const key = (id) => symbolKey.get(id) ?? linkKey.get(id) ?? id;

for (const seed of seeds) {
  const random = rng(seed);
  const order = (list) => (seed === "sorted" ? list : shuffle(list, random));
  const input = {
    projectId,
    files: order(files).map(({ path, module, result }) => ({
      path,
      module,
      result: {
        status: result.status,
        diagnostics: result.diagnostics,
        ...(result.data === undefined ? {} : { data: result.data }),
      },
    })),
    contextFiles: order(contexts).map(({ path, status, text }) => ({
      path,
      status,
      text,
    })),
    symbols: order(symbols),
    links: order(links),
  };
  const output = await rust.resolve(input);
  const resolutions = Array.isArray(output) ? output : output.resolutions;
  const added = Array.isArray(output) ? [] : output.links;
  const lines = [
    ...resolutions.map((r) =>
      JSON.stringify([
        "R",
        key(r.linkId),
        r.targetId === undefined ? undefined : key(r.targetId),
        r.candidateIds?.map(key).sort(),
        r.library,
        r.libraries,
      ]),
    ),
    ...added.map((l) =>
      JSON.stringify([
        "A",
        l.file,
        l.key,
        l.kind,
        l.sourceId && key(l.sourceId),
        l.targetName,
        l.range,
      ]),
    ),
  ].sort();
  const text = lines.join("\n") + "\n";
  if (process.env.OUT) writeFileSync(`${process.env.OUT}-${seed}.txt`, text);
  console.log(
    seed,
    createHash("sha256").update(text).digest("hex").slice(0, 16),
    lines.length,
  );
}
