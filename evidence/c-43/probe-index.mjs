// SPDX-License-Identifier: MIT
// C-43: index one Rust project with the toolchain route on, and print the
// route's notes and every link it decided.
// Usage: node probe-index.mjs PROJECT SCRATCH
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  LanguageRegistry,
  SqliteGraphStore,
  indexProject,
} from "../../dist/graph/index.js";
import rust from "../../dist/graph/languages/rust/index.js";

const [project, scratch] = process.argv.slice(2);
mkdirSync(scratch, { recursive: true });
const store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "probe");
try {
  const report = await indexProject(project, new LanguageRegistry([rust]), store, {
    toolchainDirectory: join(scratch, "toolchain"),
    toolchains: { rust: true },
    signal: new AbortController().signal,
  });
  console.log(JSON.stringify(report.toolchains, null, 1));
  const symbols = new Map(store.findSymbols().map((s) => [s.id, s]));
  for (const link of store.links()) {
    const t = link.data?.toolchain;
    const target = symbols.get(link.targetId)?.identity ?? link.resolution;
    console.log(
      `${t ? "TC " + t.from : "  "} ${link.kind} ${link.file}:${link.range.start} ${link.targetName} -> ${target}${link.data?.uncertainty ? " (" + link.data.uncertainty + ")" : ""}`,
    );
  }
} finally {
  store.close();
}
