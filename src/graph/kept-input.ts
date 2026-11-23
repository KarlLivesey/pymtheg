// SPDX-License-Identifier: MIT
/**
 * C-55: a module's decoded inputs kept between the runs of an index session
 * (see docs/changes/C-55.md). The indexer keeps, per stored path, what the
 * store's reads returned: the analysis records (`filesAt`), the resolver
 * projection (`resolutionFiles`) and the symbols. A later run re-reads only
 * the paths written since (the store's record of `replaceFile` and
 * `removeFile` calls) and assembles each input in the store's own order.
 *
 * Everything kept is deep-frozen before any module sees it: a module that
 * changes its input in place throws instead of changing kept state, and a
 * run that fails keeps nothing (C-45).
 */
import { compare } from "./identity.js";
import type { GraphFile, GraphSymbol, ResolutionFile } from "./types.js";
import { count } from "./work.js";

/** What is kept stops being kept above this many bytes of stored JSON. */
export const keptInputBytes = 128 * 1024 * 1024;
/** The name and key a module's kept inputs are stored under. */
export const KEPT_INPUT = "core:input";
export const keptInputKey = (id: string, version: string) =>
  JSON.stringify(["C-55", id, version]);

export interface KeptInput {
  /** Decoded analysis records by path, read before the analysis write. */
  readonly records: ReadonlyMap<string, GraphFile> | undefined;
  /** Paths written after the records were read (in that run). */
  readonly recordsStale: ReadonlySet<string>;
  /** Resolver projection rows by path, for the module's link kinds. */
  readonly projection: ReadonlyMap<string, ResolutionFile> | undefined;
  readonly projectionKinds: string;
  /** Every path's symbols. */
  readonly symbols: ReadonlyMap<string, readonly GraphSymbol[]> | undefined;
  /** Paths written after the resolver input was read (in that run). */
  readonly resolverStale: ReadonlySet<string>;
  /** Bytes of stored JSON the kept values were decoded from (estimated). */
  readonly bytes: number;
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/**
 * Builds a module's inputs from what was kept plus fresh reads of the
 * paths it cannot trust, and records what to keep at the end of the run.
 */
export class KeptInputs {
  records?: Map<string, GraphFile>;
  recordsMark?: number;
  projection?: Map<string, ResolutionFile>;
  projectionKinds = "";
  symbols?: Map<string, readonly GraphSymbol[]>;
  resolverMark?: number;
  private bytes = new Map<string, number>();
  constructor(
    private readonly previous: KeptInput | undefined,
    /** Paths written in this run before a read (from the run's start). */
    private readonly writtenThisRun: () => Set<string>,
  ) {}

  /** The analysis records of `paths` that are stored, in path order. */
  async analysisInput(
    paths: readonly string[],
    read: (paths: readonly string[]) => Promise<GraphFile[]>,
    mark: number,
  ): Promise<GraphFile[]> {
    const old = this.previous?.records;
    const stale = new Set([
      ...(this.previous?.recordsStale ?? []),
      ...this.writtenThisRun(),
    ]);
    const wanted = new Set(paths);
    const reread = old
      ? [...wanted].filter((path) => stale.has(path))
      : [...wanted];
    const fresh = await read(reread);
    const records = new Map<string, GraphFile>();
    if (old)
      for (const [path, file] of old)
        if (wanted.has(path) && !stale.has(path)) {
          records.set(path, file);
          this.bytes.set(`r:${path}`, this.previousBytes(`r:${path}`, file));
        }
    for (const file of fresh) {
      records.set(file.path, deepFreeze(file));
      this.bytes.set(`r:${file.path}`, size(file));
    }
    count("kept.input.recordsReused", records.size - fresh.length);
    count("kept.input.recordsRead", fresh.length);
    this.records = records;
    this.recordsMark = mark;
    return [...records.values()].sort((a, b) => compare(a.path, b.path));
  }

  /** The resolver projection (by path) and every symbol (by id). */
  async resolverInput(
    kinds: readonly string[] | undefined,
    reads: {
      allPaths: () => Promise<string[]>;
      projection?: (paths: readonly string[]) => Promise<ResolutionFile[]>;
      symbols: (
        paths: readonly string[],
      ) => Promise<Map<string, GraphSymbol[]>>;
    },
    mark: number,
  ): Promise<{ projection?: ResolutionFile[]; symbols: GraphSymbol[] }> {
    const previous = this.previous;
    const kindsKey = JSON.stringify(kinds ?? null);
    const stale = new Set([
      ...(previous?.resolverStale ?? []),
      ...this.writtenThisRun(),
    ]);
    const paths = await reads.allPaths();
    const keep = (path: string) => !stale.has(path);
    // Symbols: every stored path's.
    const oldSymbols = previous?.symbols;
    const symbolReads = paths.filter(
      (path) => !oldSymbols?.has(path) || !keep(path),
    );
    const freshSymbols = await reads.symbols(symbolReads);
    const symbols = new Map<string, readonly GraphSymbol[]>();
    let reusedSymbols = 0;
    for (const path of paths) {
      const fresh = freshSymbols.get(path);
      if (fresh) {
        symbols.set(path, deepFreeze(fresh));
        this.bytes.set(`s:${path}`, size(fresh));
      } else {
        const kept = oldSymbols!.get(path)!;
        symbols.set(path, kept);
        reusedSymbols += kept.length;
        this.bytes.set(`s:${path}`, this.previousBytes(`s:${path}`, kept));
      }
    }
    count("kept.input.symbolsReused", reusedSymbols);
    this.symbols = symbols;
    let projection: ResolutionFile[] | undefined;
    if (kinds && reads.projection) {
      const oldProjection =
        previous?.projectionKinds === kindsKey
          ? previous.projection
          : undefined;
      const projectionReads = paths.filter(
        (path) => !oldProjection?.has(path) || !keep(path),
      );
      const fresh = new Map(
        (await reads.projection(projectionReads)).map((row) => [row.path, row]),
      );
      const rows = new Map<string, ResolutionFile>();
      for (const path of paths) {
        const row = fresh.get(path);
        if (row) {
          rows.set(path, deepFreeze(row));
          this.bytes.set(`p:${path}`, size(row));
        } else if (oldProjection?.has(path)) {
          rows.set(path, oldProjection.get(path)!);
          this.bytes.set(
            `p:${path}`,
            this.previousBytes(`p:${path}`, oldProjection.get(path)),
          );
        }
      }
      count("kept.input.projectionReused", rows.size - fresh.size);
      this.projection = rows;
      this.projectionKinds = kindsKey;
      projection = [...rows.values()];
    }
    this.resolverMark = mark;
    return {
      ...(projection ? { projection } : {}),
      symbols: [...symbols.values()].flat().sort((a, b) => compare(a.id, b.id)),
    };
  }

  /**
   * Every stored file's record, for a resolver given no scope: this run's
   * analysis records where nothing has written them since they were read,
   * fresh reads for the rest (other modules' files, and files written
   * since), in the order `files()` returns them.
   */
  async allRecords(
    paths: readonly string[],
    read: (paths: readonly string[]) => Promise<GraphFile[]>,
    writtenSince: (mark: number) => Set<string>,
  ): Promise<GraphFile[]> {
    const records = this.records;
    const stale =
      this.recordsMark === undefined
        ? new Set<string>()
        : writtenSince(this.recordsMark);
    const usable = (path: string) =>
      records?.has(path) === true && !stale.has(path);
    const fresh = await read(paths.filter((path) => !usable(path)));
    count("kept.input.resolverRecordsReused", paths.filter(usable).length);
    return [
      ...paths.filter(usable).map((path) => records!.get(path)!),
      ...fresh.map((file) => deepFreeze(file)),
    ].sort((a, b) => compare(a.path, b.path));
  }

  private previousBytes(key: string, value: unknown): number {
    return previousSizes.get(this.previous!)?.get(key) ?? size(value);
  }

  /** What to keep after the run, given the paths written since each read. */
  result(writtenSince: (mark: number) => Set<string>): KeptInput | undefined {
    const total = [...this.bytes.values()].reduce((sum, n) => sum + n, 0);
    count("kept.input.bytes", total);
    if (total > keptInputBytes) return undefined;
    const kept: KeptInput = {
      records: this.records,
      recordsStale:
        this.recordsMark === undefined
          ? new Set()
          : writtenSince(this.recordsMark),
      projection: this.projection,
      projectionKinds: this.projectionKinds,
      symbols: this.symbols,
      resolverStale:
        this.resolverMark === undefined
          ? new Set()
          : writtenSince(this.resolverMark),
      bytes: total,
    };
    previousSizes.set(kept, new Map(this.bytes));
    return kept;
  }
}
/** Each kept value's per-entry sizes, so they are not measured again. */
const previousSizes = new WeakMap<KeptInput, Map<string, number>>();
