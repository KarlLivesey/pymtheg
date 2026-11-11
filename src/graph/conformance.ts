import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LanguageRegistry, matchesPattern } from "./registry.js";
import { SqliteGraphStore } from "./store.js";
import { indexProject } from "./indexer.js";
import { compare, validateResult } from "./identity.js";
import type { LanguageModule, ParseStatus, SourceRange } from "./types.js";

export interface ConformanceFixture {
  path: string;
  text: string;
  status?: ParseStatus;
  context?: boolean;
}
/** Every expected symbol/link must check exact source text and/or an exact UTF-16 range. */
export type PositionExpectation =
  | { at: string; range?: SourceRange }
  | { range: SourceRange; at?: string };
type Selector = { file: string; name: string; kind: string };
export interface ConformanceExpectations {
  /** Explicit exceptions for source fixtures with other position-sensitive preambles. */
  identityEditExclusions?: readonly { file: string; reason: string }[];
  symbols: (Selector & { identity: string } & PositionExpectation)[];
  links: ({
    file: string;
    kind: string;
    targetName: string;
    source: { name: string; kind: string } | null;
    target: Selector | null;
    candidates?: Selector[];
  } & PositionExpectation)[];
}
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => compare(a, b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
};
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function checkPositions(
  actual: (Record<string, unknown> & { range: SourceRange; at: string })[],
  expected: (PositionExpectation & object)[],
): void {
  assert.equal(actual.length, expected.length, "Exact fact count");
  const remaining = [...actual];
  for (const item of expected) {
    assert.ok(
      item.at !== undefined || item.range !== undefined,
      "Position expectation is required",
    );
    const { at, range, ...fields } = item;
    const index = remaining.findIndex((value) => {
      const { at: actualText, range: actualRange, ...actualFields } = value;
      return (
        equal(fields, actualFields) &&
        (at === undefined || at === actualText) &&
        (range === undefined || equal(range, actualRange))
      );
    });
    assert.ok(
      index >= 0,
      `Incorrect source position or fact: ${JSON.stringify(item)}`,
    );
    remaining.splice(index, 1);
  }
}
export async function checkLanguageConformance(
  module: LanguageModule,
  fixtures: readonly ConformanceFixture[],
  expected: ConformanceExpectations,
): Promise<void> {
  const registry = new LanguageRegistry([module]);
  assert.ok(fixtures.length, "Provide a sample project");
  assert.ok(
    expected.links.some(
      (link) => link.target === null && !link.candidates?.length,
    ),
    "Provide an unresolved-link control",
  );
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-graph-conformance-"));
  let store: SqliteGraphStore | undefined;
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
      if (fixture.context)
        assert.ok(
          module.contextFiles?.some((pattern) =>
            matchesPattern(fixture.path, pattern),
          ),
          "Context fixture must be declared",
        );
      else {
        assert.equal(
          registry.claim(fixture.path),
          module,
          "Fixture must be claimed",
        );
        if (module.parse) {
          const first = await module.parse({
            path: fixture.path,
            text: fixture.text,
          });
          validateResult(fixture.text, first);
          assert.deepEqual(
            await module.parse({ path: fixture.path, text: fixture.text }),
            first,
            "Parsing must be deterministic",
          );
        }
      }
      await mkdir(dirname(join(root, fixture.path)), { recursive: true });
      await writeFile(join(root, fixture.path), fixture.text);
    }
    store = new SqliteGraphStore(
      join(scratch, "graph.sqlite"),
      "conformance-project",
    );
    const report = await indexProject(root, registry, store);
    assert.equal(
      report.indexed,
      fixtures.filter((fixture) => !fixture.context).length,
    );
    assert.deepEqual(report.analysisErrors, []);
    assert.deepEqual(report.resolutionErrors, []);
    for (const fixture of fixtures.filter((fixture) => !fixture.context))
      assert.equal(
        store.getFile(fixture.path)!.result.status,
        fixture.status ?? "clean",
      );
    const symbols = store.findSymbols();
    const links = store.links();
    const selector = (id: string | null) => {
      const symbol = symbols.find((symbol) => symbol.id === id);
      return symbol
        ? { file: symbol.file, name: symbol.name, kind: symbol.kind }
        : null;
    };
    const candidateSet = (values: unknown[]) =>
      [...values].sort((a, b) =>
        compare(JSON.stringify(canonical(a)), JSON.stringify(canonical(b))),
      );
    const location = (file: string, range: SourceRange) => ({
      range,
      at: store!.getFile(file)!.text.slice(range.start, range.end),
    });
    checkPositions(
      symbols.map((symbol) => ({
        file: symbol.file,
        name: symbol.name,
        kind: symbol.kind,
        identity: symbol.identity,
        ...location(symbol.file, symbol.range),
      })),
      expected.symbols,
    );
    checkPositions(
      links.map((link) => {
        const source = selector(link.sourceId);
        return {
          file: link.file,
          kind: link.kind,
          targetName: link.targetName,
          source: source ? { name: source.name, kind: source.kind } : null,
          target: selector(link.targetId),
          candidates: candidateSet(
            link.candidates.map((candidate) => selector(candidate.id)),
          ),
          ...location(link.file, link.range),
        };
      }),
      expected.links.map((link) => ({
        ...link,
        candidates: candidateSet(link.candidates ?? []),
      })),
    );
    assert.equal(
      store.unresolved().length,
      expected.links.filter(
        (link) => link.target === null && !link.candidates?.length,
      ).length,
    );
    const repeat = await indexProject(root, registry, store);
    assert.equal(
      repeat.indexed,
      fixtures.filter((fixture) => fixture.status === "failed").length,
    );
    assert.deepEqual(store.findSymbols(), symbols);
    assert.deepEqual(store.links(), links);
    for (const file of store.files()) store.replaceFile(file);
    await indexProject(root, registry, store);
    assert.deepEqual(store.findSymbols(), symbols, "IDs survive replacement");
    assert.deepEqual(store.links(), links, "Resolution is deterministic");
    const exclusions = new Set<string>();
    for (const exclusion of expected.identityEditExclusions ?? []) {
      assert.ok(
        exclusion.reason.trim(),
        "Identity edit exclusion needs a reason",
      );
      assert.ok(
        fixtures.some(
          (fixture) => fixture.path === exclusion.file && !fixture.context,
        ) && !exclusions.has(exclusion.file),
        "Identity edit exclusion must name a unique source fixture",
      );
      exclusions.add(exclusion.file);
    }
    for (const fixture of fixtures) {
      if (fixture.context || exclusions.has(fixture.path)) continue;
      const text = fixture.text;
      let offset = text.startsWith("\uFEFF") ? 1 : 0;
      let blankLine = "\n";
      if (text.startsWith("#!", offset)) {
        const newline = /\r\n|[\r\n\u2028\u2029]/.exec(text.slice(offset));
        if (!newline) {
          await writeFile(join(root, fixture.path), `${text}\n\n`);
          continue;
        }
        offset += newline.index + newline[0].length;
        blankLine = newline[0];
      }
      await writeFile(
        join(root, fixture.path),
        `${text.slice(0, offset)}${blankLine}${text.slice(offset)}`,
      );
    }
    const edited = await indexProject(root, registry, store);
    assert.deepEqual(edited.analysisErrors, []);
    assert.deepEqual(edited.resolutionErrors, []);
    assert.deepEqual(
      store.findSymbols().map((symbol) => symbol.id),
      symbols.map((symbol) => symbol.id),
      "IDs survive an edit above every symbol",
    );
  } finally {
    store?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
