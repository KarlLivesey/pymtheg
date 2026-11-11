import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LanguageRegistry } from "./registry.js";
import { SqliteGraphStore } from "./store.js";
import { indexProject } from "./indexer.js";
import { validateResult } from "./identity.js";
import type { LanguageModule, ParseStatus } from "./types.js";

export interface ConformanceFixture {
  path: string;
  text: string;
  status?: ParseStatus;
}
export interface ConformanceExpectations {
  symbols: { file: string; name: string; kind: string }[];
  /** Exact links; null target proves an unresolved case was retained. */
  links: {
    file: string;
    kind: string;
    targetName: string;
    source: { name: string; kind: string } | null;
    target: { file: string; name: string; kind: string } | null;
  }[];
}
/** Throws assertion failures; each invocation owns and finally deletes its files and database. */
export async function checkLanguageConformance(
  module: LanguageModule,
  fixtures: readonly ConformanceFixture[],
  expected: ConformanceExpectations,
): Promise<void> {
  const registry = new LanguageRegistry([module]);
  assert.ok(fixtures.length, "Provide a sample project");
  assert.ok(
    expected.links.some((link) => link.target === null),
    "Provide an unresolved-link control",
  );
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-graph-conformance-"));
  let store: SqliteGraphStore | undefined;
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return value;
  };
  const sorted = (values: unknown[]) =>
    values.map((value) => JSON.stringify(canonical(value))).sort();
  try {
    const root = join(scratch, "project");
    await mkdir(root);
    for (const fixture of fixtures) {
      assert.ok(
        fixture.path &&
          !fixture.path.startsWith("/") &&
          !fixture.path.includes("\\") &&
          fixture.path
            .split("/")
            .every((part) => part && part !== "." && part !== ".."),
        "Fixture path must be relative",
      );
      assert.equal(
        registry.claim(fixture.path),
        module,
        "Fixture must be claimed",
      );
      const first = await module.parse({
        path: fixture.path,
        text: fixture.text,
      });
      validateResult(fixture.text, first);
      assert.equal(first.status, fixture.status ?? "clean");
      assert.deepEqual(
        await module.parse({ path: fixture.path, text: fixture.text }),
        first,
        "Parsing must be deterministic",
      );
      await mkdir(dirname(join(root, fixture.path)), { recursive: true });
      await writeFile(join(root, fixture.path), fixture.text);
    }
    store = new SqliteGraphStore(
      join(scratch, "graph.sqlite"),
      "conformance-project",
    );
    const report = await indexProject(root, registry, store);
    assert.equal(report.indexed, fixtures.length);
    assert.deepEqual(report.resolutionErrors, []);
    const symbols = store.findSymbols();
    const links = store.links();
    assert.deepEqual(
      sorted(symbols.map(({ file, name, kind }) => ({ file, name, kind }))),
      sorted(expected.symbols),
    );
    assert.deepEqual(
      sorted(
        links.map((link) => {
          const symbol = symbols.find((item) => item.id === link.targetId);
          const source = symbols.find((item) => item.id === link.sourceId);
          return {
            file: link.file,
            kind: link.kind,
            targetName: link.targetName,
            source: source ? { name: source.name, kind: source.kind } : null,
            target: symbol
              ? { file: symbol.file, name: symbol.name, kind: symbol.kind }
              : null,
          };
        }),
      ),
      sorted(expected.links),
    );
    assert.equal(
      store.unresolved().length,
      expected.links.filter((link) => link.target === null).length,
    );
    const repeat = await indexProject(root, registry, store);
    assert.equal(
      repeat.indexed,
      fixtures.filter((fixture) => fixture.status === "failed").length,
    );
    assert.deepEqual(store.findSymbols(), symbols);
    assert.deepEqual(store.links(), links);
    // Force real per-file replacement rather than merely exercising the hash skip.
    for (const file of store.files()) store.replaceFile(file);
    await indexProject(root, registry, store);
    assert.deepEqual(store.findSymbols(), symbols, "IDs survive replacement");
    assert.deepEqual(store.links(), links, "Resolution is deterministic");
  } finally {
    store?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
