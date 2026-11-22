// SPDX-License-Identifier: MIT
/**
 * C-45: an index session, for a process that indexes the same project more
 * than once (an MCP server, Studio, a resident index process). It owns the
 * language modules, loaded once, and state a module may keep from one index
 * run to the next. Nothing it keeps decides a result unless it is proved
 * still valid:
 *
 * - A module reads kept state by name with a validity key it computes from
 *   its own inputs (content hashes, its settings). A value set under another
 *   key is not returned.
 * - The session's state belongs to one project, store and configuration (the
 *   module ids, versions and claims, and the index settings), and to the
 *   store as the session's last run completed it. When a run begins, the
 *   session compares the store's completion record with the one it recorded
 *   after its last completed run. Every graph write by anyone deletes that
 *   record (C-22, C-27), and a record written by another completed run
 *   proves the store equals a cold index of the inputs it records. If the
 *   record differs, or the project, store or configuration does, everything
 *   kept is dropped.
 * - Values set during a run are kept only if the run completes (its
 *   completion record is written). A run that fails, is aborted or is taken
 *   over keeps nothing it set, and the session drops what it had.
 * - Each module keeps at most `maxValuesPerModule` names; setting another
 *   drops the oldest. `drop()` releases everything.
 *
 * The session holds no store connection or lock between runs: every run is
 * an ordinary index run with its own ownership checks.
 */
import { discoverLanguages, type LanguageRegistry } from "./registry.js";

/** A module's view of the state kept for it. */
export interface KeptState {
  /** The value kept under `name` by the last completed run, if it was kept with `key`. */
  get(name: string, key: string): unknown;
  /** Keeps `value` under `name` and `key` from the end of this run, if the run completes. */
  set(name: string, key: string, value: unknown): void;
}
interface Kept {
  key: string;
  value: unknown;
}
/** The project, store and configuration a session's kept state belongs to. */
export interface SessionScope {
  root: string;
  store: string;
  projectId: string;
  configuration: unknown;
  settings: unknown;
}

export class IndexSession {
  /** True when the session was given a registry (tests): no production shortcut applies. */
  readonly injectedRegistry: boolean;
  private loaded: Promise<LanguageRegistry> | undefined;
  private scopeKey: string | undefined;
  private completion: string | undefined;
  private readonly kept = new Map<string, Map<string, Kept>>();
  private readonly maxValues: number;
  /** Module discoveries, runs begun, and times something kept was dropped. */
  readonly counts = { loads: 0, runs: 0, dropped: 0 };

  constructor(
    options: { registry?: LanguageRegistry; maxValuesPerModule?: number } = {},
  ) {
    this.injectedRegistry = !!options.registry;
    if (options.registry) this.loaded = Promise.resolve(options.registry);
    this.maxValues = options.maxValuesPerModule ?? 4;
  }
  /** The language modules, discovered once per session. */
  registry(): Promise<LanguageRegistry> {
    if (!this.loaded) {
      this.counts.loads++;
      this.loaded = discoverLanguages();
    }
    return this.loaded;
  }
  /** Releases everything kept. */
  drop(): void {
    if (this.kept.size || this.scopeKey !== undefined) this.counts.dropped++;
    this.kept.clear();
    this.scopeKey = undefined;
    this.completion = undefined;
  }
  /**
   * Begins a run on `scope`, given the completion record's fingerprint found
   * when the run began (null when there is none). Everything kept is dropped
   * unless both match what the session recorded after its last completed run.
   */
  beginRun(scope: SessionScope, completion: string | null): SessionRun {
    this.counts.runs++;
    const scopeKey = JSON.stringify(scope);
    if (
      this.scopeKey !== scopeKey ||
      completion === null ||
      this.completion !== completion
    )
      this.drop();
    return new SessionRun(this, scopeKey);
  }
  /** @internal */
  read(module: string, name: string, key: string): unknown {
    const entry = this.kept.get(module)?.get(name);
    return entry && entry.key === key ? entry.value : undefined;
  }
  /** @internal */
  commit(
    scopeKey: string,
    completion: string,
    pending: ReadonlyMap<string, ReadonlyMap<string, Kept>>,
  ): void {
    if (this.scopeKey !== undefined && this.scopeKey !== scopeKey) this.drop();
    for (const [module, values] of pending) {
      const map = this.kept.get(module) ?? new Map<string, Kept>();
      for (const [name, entry] of values) {
        map.delete(name);
        map.set(name, entry);
        while (map.size > this.maxValues) map.delete(map.keys().next().value!);
      }
      this.kept.set(module, map);
    }
    this.scopeKey = scopeKey;
    this.completion = completion;
  }
}

/** One index run of a session: what modules read and set during it. */
export class SessionRun {
  private readonly pending = new Map<string, Map<string, Kept>>();
  private settled = false;
  constructor(
    private readonly session: IndexSession,
    private readonly scopeKey: string,
  ) {}
  /** The kept state of one module, namespaced by its id and version. */
  kept(id: string, version: string): KeptState {
    const module = `${id}\u0000${version}`;
    return {
      get: (name, key) => {
        const own = this.pending.get(module)?.get(name);
        if (own) return own.key === key ? own.value : undefined;
        return this.session.read(module, name, key);
      },
      set: (name, key, value) => {
        if (this.settled) return;
        const map = this.pending.get(module) ?? new Map<string, Kept>();
        map.set(name, { key, value });
        this.pending.set(module, map);
      },
    };
  }
  /** The run completed with this completion record: its values are kept. */
  complete(completion: string): void {
    if (this.settled) return;
    this.settled = true;
    this.session.commit(this.scopeKey, completion, this.pending);
    this.pending.clear();
  }
  /** The run did not complete: nothing it set is kept, nor what was kept before. */
  abandon(): void {
    if (this.settled) return;
    this.settled = true;
    this.pending.clear();
    this.session.drop();
  }
}
