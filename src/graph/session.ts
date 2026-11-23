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
 * - The completion record is compared twice: when the run begins, and
 *   again as the run's ownership baseline read it (`confirm`), in the same
 *   snapshot as the data version and mark its ownership checks start from.
 *   A run by another process that completes between the two is caught by
 *   the second; one after it, by the run's own ownership checks. Nothing
 *   kept is readable before `confirm`.
 * - A confirmed run takes what was kept: a module reads it, and only what
 *   the run `set`s again (or anew) is kept after it. A module must treat a
 *   kept value as immutable, or `set` the value it changed; a value changed
 *   in place and not set again is not kept, so a violation is forgotten
 *   rather than carried into a later run.
 * - Values set during a run are kept only if the run completes (its
 *   completion record is written). A run that fails, is aborted or is taken
 *   over keeps nothing it set, and the session drops what it had.
 * - Each module keeps at most `maxValuesPerModule` names; setting another
 *   drops the oldest. The session bounds kept state by count, not by
 *   bytes: an embedder must bound the memory of the process (the MCP server
 *   ends a worker whose resting heap exceeds its bound, C-48).
 *   `drop()` releases everything.
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
  /**
   * @internal Confirms a run against the completion record its baseline
   * read: drops everything unless it is the one the last completed run
   * recorded, then hands what was kept to the run.
   */
  take(completion: string | null): Map<string, Map<string, Kept>> {
    if (completion === null || this.completion !== completion) this.drop();
    const taken = new Map(this.kept);
    this.kept.clear();
    return taken;
  }
  /** @internal */
  commit(
    scopeKey: string,
    completion: string,
    pending: ReadonlyMap<string, ReadonlyMap<string, Kept>>,
  ): void {
    if (this.scopeKey !== undefined && this.scopeKey !== scopeKey) this.drop();
    this.kept.clear();
    for (const [module, values] of pending) {
      const map = new Map<string, Kept>();
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
  /** What was kept, once `confirm` has proved it; nothing before. */
  private taken: Map<string, Map<string, Kept>> | undefined;
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
        const entry = this.taken?.get(module)?.get(name);
        return entry && entry.key === key ? entry.value : undefined;
      },
      set: (name, key, value) => {
        if (this.settled) return;
        const map = this.pending.get(module) ?? new Map<string, Kept>();
        map.set(name, { key, value });
        this.pending.set(module, map);
      },
    };
  }
  /**
   * The completion record as the run's ownership baseline read it (null for
   * none). Until this is called nothing kept is readable; called again, it
   * changes nothing.
   */
  confirm(completion: string | null): void {
    if (this.settled || this.taken) return;
    this.taken = this.session.take(completion);
  }
  /** The run completed with this completion record: its values are kept. */
  complete(completion: string): void {
    if (this.settled) return;
    this.settled = true;
    this.session.commit(this.scopeKey, completion, this.pending);
    this.pending.clear();
    this.taken = undefined;
  }
  /** The run did not complete: nothing it set is kept, nor what was kept before. */
  abandon(): void {
    if (this.settled) return;
    this.settled = true;
    this.pending.clear();
    this.taken = undefined;
    this.session.drop();
  }
}
