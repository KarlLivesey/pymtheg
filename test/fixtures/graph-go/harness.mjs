import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  LanguageRegistry,
  SqliteGraphStore,
  indexProject,
} from "../../../dist/graph/index.js";
import go from "../../../dist/graph/languages/go/index.js";

/** Indexes a small project and returns readable link facts. */
export async function project(files, steps = []) {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-graph-go-"));
  const root = join(scratch, "project");
  const store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "go-test");
  const write = async (path, text) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  };
  try {
    await mkdir(root);
    for (const [path, text] of Object.entries(files)) await write(path, text);
    const snapshots = [];
    for (const step of [null, ...steps]) {
      if (step)
        for (const [path, text] of Object.entries(step))
          await write(path, text);
      const report = await indexProject(
        root,
        new LanguageRegistry([go]),
        store,
      );
      assert.deepEqual(report.errors, []);
      assert.deepEqual(report.analysisErrors, []);
      assert.deepEqual(report.resolutionErrors, []);
      const symbols = store.findSymbols();
      const name = (id) => {
        const symbol = symbols.find((item) => item.id === id);
        return symbol
          ? `${symbol.file}:${symbol.kind}:${symbol.identity}`
          : null;
      };
      // One read per file (a file's record can be large).
      const texts = new Map();
      const text = (path) => {
        if (!texts.has(path)) texts.set(path, store.getFile(path).text);
        return texts.get(path);
      };
      const links = store
        .links()
        .sort(
          (a, b) =>
            (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
            a.range.start - b.range.start,
        )
        .map((link) => ({
          file: link.file,
          kind: link.kind,
          targetName: link.targetName,
          at: text(link.file).slice(link.range.start, link.range.end),
          target: name(link.targetId),
          candidates: link.candidates.map((item) => name(item.id)).sort(),
          data: link.data,
          // Library targets (C-14), without their content-derived ids.
          ...(link.libraries
            ? {
                resolution: link.resolution,
                libraries: link.libraries.map(({ id: _id, ...rest }) => rest),
              }
            : {}),
        }));
      snapshots.push({ report, symbols, links });
    }
    return steps.length ? snapshots : snapshots[0];
  } finally {
    store.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
export const one = (links, predicate, label) => {
  const found = links.filter(predicate);
  assert.equal(found.length, 1, `${label}: ${JSON.stringify(found)}`);
  return found[0];
};
export const call = (links, file, at) =>
  one(
    links,
    (link) => link.kind === "calls" && link.file === file && link.at === at,
    `${file} ${at}`,
  );
