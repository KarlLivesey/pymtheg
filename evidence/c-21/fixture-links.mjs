// SPDX-License-Identifier: MIT
// Index each grammar fixture alone (as src/lib.rs) with the built module and
// print its failed files, symbols and links (kind, text, outcome, target).
//   node fixture-links.mjs <fixture.rs>...
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  LanguageRegistry,
  SqliteGraphStore,
  indexProject,
} from "../../dist/graph/index.js";
import rust from "../../dist/graph/languages/rust/index.js";

for (const path of process.argv.slice(2)) {
  const text = readFileSync(path, "utf8");
  const edition = /^\/\/ edition (\d+)/.exec(text)?.[1] ?? "2024";
  const root = mkdtempSync(join(tmpdir(), "c21-fixture-"));
  const store = new SqliteGraphStore(join(root, "graph.sqlite"), "c21");
  try {
    mkdirSync(join(root, "project", "src"), { recursive: true });
    writeFileSync(
      join(root, "project", "Cargo.toml"),
      `[package]\nname="app"\nedition="${edition}"\nversion="0.1.0"\n`,
    );
    writeFileSync(join(root, "project", "src", "lib.rs"), text);
    const report = await indexProject(
      join(root, "project"),
      new LanguageRegistry([rust]),
      store,
    );
    const symbols = store.findSymbols();
    const name = (id) => {
      const s = symbols.find((x) => x.id === id);
      return s ? `${s.kind}:${s.identity}` : null;
    };
    console.log(`== ${basename(path)} failed=${JSON.stringify(report.failed)}`);
    console.log(
      symbols
        .filter((s) => !["file", "module"].includes(s.kind))
        .map((s) => `${s.kind}:${s.identity}`)
        .sort()
        .join(" "),
    );
    for (const l of store.links())
      if (l.kind !== "contains")
        console.log(
          `  ${l.kind} ${JSON.stringify(text.slice(l.range.start, l.range.end))} ${l.resolution?.outcome ?? l.outcome ?? ""} -> ${name(l.targetId)} ${JSON.stringify(l.resolution?.reason ?? l.reason ?? "")}`,
        );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}
