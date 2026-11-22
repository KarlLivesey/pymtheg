// SPDX-License-Identifier: MIT
import type { DatabaseSync, StatementSync } from "node:sqlite";
import {
  closeWriteAheadLog,
  isDatabaseFile,
  openDatabase,
  openWriteAheadLog,
} from "../storage/local.js";
import { randomUUID } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { totalmem } from "node:os";
import { compare, fileFacts, validateResult } from "./identity.js";
import { LinkDecider, resolutionFacts } from "./analysis.js";
import { count } from "./work.js";
import type {
  ContextFile,
  GraphStorage,
  FailedFile,
  GraphFile,
  GraphLibrary,
  GraphLink,
  GraphSymbol,
  SymbolQuery,
  SymbolReference,
  ValidatedAnalysis,
  LinkResolution,
  Neighbourhood,
  ResolutionResult,
  ResolutionFile,
} from "./types.js";

export class SqliteGraphStore implements GraphStorage {
  private readonly db: DatabaseSync;
  readonly projectId: string;
  /** files, getFile, filesAt, findSymbols, links and moduleLinks decode fresh records every call. */
  readonly independentReads = true as const;
  private readonly decodedContexts = new Map<string, ContextFile>();
  /** " INDEXED BY graph_file_status" when that covering index exists, else "".
   * Link reads join graph_files only for status, which is stored after the whole
   * file body; without the covering index SQLite walks every body's overflow pages.
   * The planner does not choose the index on its own, so link reads name it.
   * Read-only opens of a graph written before the index existed keep the plain plan. */
  private fileStatusIndex = "";
  /** This writable connection uses a write-ahead log (see openWriteAheadLog). */
  private writeAheadLog = false;
  /** A writable connection's file, until its first graph write chooses the journal. */
  private path: string | undefined;
  /** A SQLite version a test supplies instead of the engine's own. */
  private readonly sqliteVersion: string | undefined;
  /**
   * Before the first graph write: commits without a sync on a local disk
   * (C-6). Trust comes only from the completion record: every write after it
   * deletes it (the triggers made at open) and it is written last, with a full sync.
   * A store cut short is some prefix of its commits, so it is either the
   * previous completed state or reports incomplete; the next run repairs it.
   * Chosen at the first write, not at open: a query that writes nothing
   * leaves the file's bytes and journal mode as they were.
   */
  private beforeWrite(): void {
    if (this.path === undefined || this.db.isTransaction) return;
    this.writeAheadLog =
      this.sqliteVersion === undefined
        ? openWriteAheadLog(this.db, this.path)
        : openWriteAheadLog(this.db, this.path, this.sqliteVersion);
    this.path = undefined;
  }
  /**
   * Known to have library targets (schema 4). A graph never returns to
   * schema 3, so once true it stays true; a writable store migrates on open.
   */
  private libraryKnown = false;
  /**
   * Whether this database has library targets. Until that is known, it is
   * asked inside the read that uses it: a reader opened on a schema-3 graph
   * that another connection migrates sees one database state per read, never
   * a count of library links beside rows read without them.
   */
  private libraryTable(): boolean {
    return (this.libraryKnown ||= !!this.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='graph_library_targets'",
      )
      .get());
  }
  /** One read snapshot for several statements, unless one is open or not needed. */
  private snapshot<T>(read: () => T): T {
    return this.libraryKnown || this.db.isTransaction
      ? read()
      : this.readCommandSnapshot(read);
  }
  /** A clean context file (manifest or lockfile) in the snapshot. */
  private cleanContext(path: string): boolean {
    return (
      this.db
        .prepare(
          "SELECT json_extract(body,'$.status') AS status FROM graph_contexts WHERE path=?",
        )
        .get(path)?.status === "clean"
    );
  }
  private findFileStatusIndex(): void {
    this.fileStatusIndex = this.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='index' AND name='graph_file_status'",
      )
      .get()
      ? " INDEXED BY graph_file_status"
      : "";
  }
  /**
   * Every read decodes a fresh, independent record. Decoded files are never
   * kept: a whole-graph cache held every source text and parse result for
   * the life of the store (C-2).
   */
  private decodeFile(body: string): GraphFile {
    count("store.fileRecordsDecoded");
    count("store.fileRecordBytesDecoded", Buffer.byteLength(body));
    return JSON.parse(body) as GraphFile;
  }
  constructor(
    path: string,
    projectId?: string,
    options: { readOnly?: boolean; sqliteVersion?: string } = {},
  ) {
    this.sqliteVersion = options.sqliteVersion;
    this.db = countStatements(
      openDatabase(path, { readOnly: options.readOnly ?? false }),
      (rows) => (this.rowsWritten += rows),
    );
    try {
      if (options.readOnly) {
        const schema = this.db
          .prepare("SELECT value FROM graph_meta WHERE key='schema'")
          .get()?.value;
        // Schema 3 (0.1.0) has no library targets; it reads as having none.
        if (schema !== "3" && schema !== "4")
          throw Error("Unsupported graph schema; rebuild the index");
        const saved = this.db
          .prepare("SELECT value FROM graph_meta WHERE key='project'")
          .get()?.value;
        if (
          typeof saved !== "string" ||
          (projectId !== undefined && saved !== projectId)
        )
          throw Error(
            "Graph belongs to a different project or has no identity",
          );
        this.projectId = saved;
        this.findFileStatusIndex();
        this.libraryKnown = schema === "4";
        return;
      }
      this.path = path;
      // Connection-local and allocated as pages are touched. Use at most
      // 1/64 of available system/container memory, with a 64 MiB ceiling.
      // Keep explicit SQLite defaults and the standard cache on readers.
      const memory = Math.min(
        totalmem(),
        process.constrainedMemory() || Infinity,
      );
      const cacheKiB = Math.min(64 * 1024, Math.floor(memory / (64 * 1024)));
      if (
        cacheKiB > 2000 &&
        this.db.prepare("PRAGMA cache_size").get()?.cache_size === -2000
      )
        this.db.exec(`PRAGMA cache_size=-${cacheKiB}`);
      this.db.exec("PRAGMA foreign_keys=ON");
      // No turnstile for a database in memory or named by a URI: only one
      // connection writes it, and the name is no path beside it.
      if (isDatabaseFile(path)) this.turnstileFile = `${path}-turnstile`;
      // C-37: an open that finds its schema and identity in place writes
      // nothing, so a query opened writable takes no write lock. Otherwise
      // the schema work passes the turnstile like any other write.
      const inPlace =
        this.schemaCurrent() &&
        !!this.db.prepare("SELECT 1 FROM graph_meta WHERE key='project'").get();
      const entered = !inPlace && this.enterTurnstile();
      try {
        if (inPlace) {
          this.findFileStatusIndex();
          this.libraryKnown = true;
        } else {
          this.db.exec(
            "CREATE TABLE IF NOT EXISTS graph_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
          );
          this.db
            .prepare("INSERT OR IGNORE INTO graph_meta VALUES ('schema','4')")
            .run();
          const schema = this.db
            .prepare("SELECT value FROM graph_meta WHERE key='schema'")
            .get()?.value;
          if (schema !== "3" && schema !== "4")
            throw Error("Unsupported graph schema; rebuild the index");
          // Schema 3 (0.1.0) differs only by the library-target table and the
          // triggers that derive resolution. Its rows stay valid unchanged: none
          // has a library target. Migrate in place instead of re-indexing.
          if (schema === "3")
            this.transaction(() => {
              this.db.exec(`DROP TRIGGER IF EXISTS graph_target_changed;
              DROP TRIGGER IF EXISTS graph_candidate_removed;
              UPDATE graph_meta SET value='4' WHERE key='schema';`);
              this.db.exec(libraryTables);
            });
          this.db.exec(graphTables);
          this.findFileStatusIndex();
          this.libraryKnown = true;
          // Path-only markers from early W2-M builds have unknown provenance. Adding
          // nullable columns makes them cache misses until a successful parse stamps them.
          const markerColumns = new Set(
            this.db
              .prepare("PRAGMA table_info(graph_parse_failures)")
              .all()
              .map((row) => row.name),
          );
          if (
            ["hash", "module", "version"].some(
              (name) => !markerColumns.has(name),
            )
          )
            this.transaction(() => {
              for (const name of ["hash", "module", "version"])
                if (!markerColumns.has(name))
                  this.db.exec(
                    `ALTER TABLE graph_parse_failures ADD COLUMN ${name} TEXT`,
                  );
            });
          this.installInvalidationTriggers();
          this.db
            .prepare("INSERT OR IGNORE INTO graph_meta VALUES ('project',?)")
            .run(projectId ?? randomUUID());
        }
      } finally {
        if (entered) this.leaveTurnstile();
      }
      this.projectId = this.db
        .prepare("SELECT value FROM graph_meta WHERE key='project'")
        .get()!.value as string;
      if (projectId !== undefined && projectId !== this.projectId)
        throw Error("Graph belongs to a different project");
    } catch (error) {
      this.turnstile?.close();
      this.db.close();
      throw error;
    }
  }
  /**
   * C-37: the turnstile, a lock-only database beside the store. Every write
   * of this store takes it before it asks for the write lock and leaves it
   * once it has the lock, and a batch is begun the same way. A writer waiting
   * for the write lock therefore holds the turnstile, so the batching run
   * cannot begin its next batch: the waiter gets the write lock when the
   * current batch commits. SQLite's own file lock is the turnstile, so it
   * works across processes and is released when its holder dies. Undefined
   * until first needed; null where it cannot be opened, and then no batch
   * forms (each write commits on its own).
   */
  private turnstile: DatabaseSync | null | undefined;
  private turnstileFile: string | undefined;
  private turnstileDepth = 0;
  private openTurnstile(): DatabaseSync | null {
    if (this.turnstileFile === undefined) return null;
    if (this.turnstile === undefined)
      try {
        this.turnstile = openDatabase(this.turnstileFile);
        // SQLite opens a file it cannot write read-only, and a lock taken
        // through it does not exclude another writer: no turnstile then.
        accessSync(this.turnstileFile, constants.W_OK);
      } catch {
        this.turnstile?.close();
        this.turnstile = null;
      }
    return this.turnstile;
  }
  private enterTurnstile(): boolean {
    // Only a connection that writes through the write-ahead log can batch,
    // so only it takes turns: with a rollback journal every write commits
    // alone, as before C-37, and taking the turnstile would only add a lock
    // to each write. A connection fixes its journal at its first write
    // (beforeWrite), which every caller makes before it gets here, and keeps
    // it for its life, so it never holds the turnstile under one journal
    // and asks for it under another.
    if (!this.writeAheadLog || !this.openTurnstile()) return false;
    if (this.turnstileDepth === 0) this.turnstile!.exec("BEGIN IMMEDIATE");
    this.turnstileDepth++;
    return true;
  }
  private leaveTurnstile(): void {
    if (--this.turnstileDepth === 0) this.turnstile!.exec("ROLLBACK");
  }
  /** Whether a writable open would find nothing to create or migrate. */
  private schemaCurrent(): boolean {
    try {
      const schema = this.db
        .prepare("SELECT value FROM graph_meta WHERE key='schema'")
        .get()?.value;
      const names = new Set(
        this.db
          .prepare("SELECT name FROM sqlite_master")
          .all()
          .map((row) => row.name),
      );
      const columns = new Set(
        this.db
          .prepare("PRAGMA table_info(graph_parse_failures)")
          .all()
          .map((row) => row.name),
      );
      return (
        schema === "4" &&
        graphObjects.every((name) => names.has(name)) &&
        names.has("graph_index_dirty_graph_files_INSERT") &&
        ["hash", "module", "version"].every((name) => columns.has(name))
      );
    } catch {
      return false;
    }
  }
  private installInvalidationTriggers(): void {
    if (
      this.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='graph_index_dirty_graph_files_INSERT' AND type='trigger'",
        )
        .get()
    )
      return;
    // Upgrade the command-only triggers together. Both receipts belong to
    // the graph itself, so writes through another connection invalidate them too.
    const ddl = [];
    for (const table of [
      "graph_files",
      "graph_contexts",
      "graph_symbols",
      "graph_links",
      "graph_candidates",
      "graph_library_targets",
      "graph_parse_failures",
    ])
      for (const event of ["INSERT", "UPDATE", "DELETE"])
        ddl.push(`DROP TRIGGER IF EXISTS graph_command_dirty_${table}_${event};
          CREATE TRIGGER IF NOT EXISTS graph_index_dirty_${table}_${event}
          AFTER ${event} ON ${table}
          WHEN EXISTS(SELECT 1 FROM graph_meta WHERE key='command-complete')
            OR EXISTS(SELECT 1 FROM graph_meta WHERE key='analysis-complete') BEGIN
            DELETE FROM graph_meta WHERE key IN ('command-complete','analysis-complete'); END;`);
    this.db.exec(`BEGIN IMMEDIATE;\n${ddl.join("\n")}\nCOMMIT;`);
  }
  /**
   * Statements for one write operation, each prepared once and reused for
   * every row (C-2). A statement prepared per row holds native memory, with
   * this schema's triggers compiled in, that V8 does not see, so it is not
   * freed promptly: hundreds of thousands per module write grew RSS by
   * gigabytes.
   */
  private writer(): (sql: string) => StatementSync {
    const statements = new Map<string, StatementSync>();
    return (sql) => {
      let statement = statements.get(sql);
      if (!statement) statements.set(sql, (statement = this.db.prepare(sql)));
      return statement;
    };
  }
  /**
   * This connection's index run (C-22): its identifier, the store's data
   * version when it began, whether it takes over a mark found then, and
   * whether its own mark is written yet.
   */
  private indexRun:
    | { state: "idle" }
    | {
        state: "pending" | "written";
        id: string;
        /** The data version after its last commit (or at its beginning). */
        version: number;
        takeOver: boolean;
        completed: ReadonlyMap<string, string>;
        /** Another connection committed between two of its commits. */
        interleaved: boolean;
      } = {
    state: "idle",
  };
  /**
   * C-37: rows a batched write may add before it commits, counted as the
   * direct changes each write statement reports (the rows it inserts,
   * updates or deletes itself). Rows that triggers and cascades change are
   * not counted, so a batch holds more rows than its budget: on restic a
   * resolution batch cut at 50,000 direct changes held about 93,000 rows
   * as SQLite's total_changes() counts them. A cold cli/cli index on disk
   * took 224.5 s committing each file and 128.7 s in batches of 50,000
   * (with checkpoints every 100,000 pages); 20,000 was measured slower.
   * Tests lower it to put batch boundaries inside small fixtures.
   */
  static writeBatchRows = 50_000;
  /** Inside writeBatch: writes share one transaction until the budget is met. */
  private batching = false;
  /** The count of rows written (rowsWritten) when the open batch began. */
  private batchOpen: number | undefined;
  /**
   * C-37: runs `action` with its graph writes grouped into transactions of
   * about writeBatchRows rows (each one write, so a batch can end up to one
   * write over). A batch is one commit: the run's ownership checks, mark and
   * data-version bookkeeping happen at its BEGIN and COMMIT, as for any
   * other commit. Each batch begins through the turnstile, so a writer that
   * is waiting stops the next batch from beginning: it waits for at most the
   * batch in progress. A write
   * that fails undoes the open batch with it: the store is then the state
   * after the run's earlier commits, as after a crash, and the run's mark
   * (from its first commit) makes the next run redo the work. Savepoints
   * per write would keep the others, but made each link insert inside them
   * several times slower (C-37 measurements). A batch only forms
   * under the write-ahead log, where readers are never blocked, and with a
   * turnstile; otherwise each write commits on its own as before (C-6). The
   * open batch commits when `action` ends, also when it throws; then an
   * error of that commit does not replace the action's own.
   */
  async writeBatch<T>(action: () => Promise<T>): Promise<T> {
    if (this.batching) return await action();
    this.batching = true;
    let failed = false;
    try {
      return await action();
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      this.batching = false;
      if (this.batchOpen !== undefined)
        try {
          this.commitTransaction();
        } catch (error) {
          if (!failed) throw error;
        }
    }
  }
  /**
   * Rows written by this connection's statements, as SQLite reports each
   * statement's direct changes (rows changed by triggers and cascades are
   * not among them), summed
   * as the statements run, so counting a batch takes no SQL of its own.
   */
  private rowsWritten = 0;
  private totalChanges(): number {
    return this.rowsWritten;
  }
  /**
   * Undoes the open write transaction. SQLite may already have rolled it
   * back itself (a full disk, an I/O error); then there is nothing to undo,
   * and the error that caused it is the one the caller reports.
   */
  private rollback(): void {
    this.batchOpen = undefined;
    if (this.db.isTransaction)
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // The original error is reported.
      }
  }
  /** A write that fails before it reaches SQL undoes the open batch too. */
  private failedWrite(): void {
    if (this.batchOpen !== undefined) this.rollback();
  }
  private transaction(action: () => void): void {
    if (this.batchOpen !== undefined) return this.batchedWrite(action);
    this.beforeWrite();
    const entered = this.enterTurnstile();
    // C-35: the invalidation triggers write, so each graph write statement in
    // a transaction keeps a statement journal. SQLite keeps it in a temporary
    // file once it outgrows a small buffer, which cost hundreds of
    // microseconds per row: a cold restic index spent 50 of 64 s in SQL in
    // memory-backed storage, 12 s with these journals in memory. SQLite
    // chooses where they go when the write transaction begins, so temporary
    // storage is in memory only for the BEGIN. Sorts, which would otherwise
    // be held in memory whole, keep their temporary files. A statement
    // journal only undoes one statement and is never used to recover from a
    // crash; it holds at most the pages one statement changes.
    try {
      this.db.exec("PRAGMA temp_store=MEMORY");
      try {
        this.db.exec("BEGIN IMMEDIATE");
      } catch (error) {
        this.db.exec("PRAGMA temp_store=DEFAULT");
        throw error;
      }
    } finally {
      if (entered) this.leaveTurnstile();
    }
    try {
      this.db.exec("PRAGMA temp_store=DEFAULT");
      const run = this.indexRun;
      // Every commit of an index run first proves, under the write lock,
      // that no other run has written since it began: its first commit that
      // no other connection has committed at all since it began reading;
      // each later one that the mark is still its own. Otherwise it writes
      // nothing more.
      if (run.state === "pending") {
        if (
          this.commandDataVersion() !== run.version ||
          (!run.takeOver && this.indexRunMark() !== undefined)
        )
          throw new GraphIndexTakenOver();
        this.db
          .prepare(
            "INSERT INTO graph_meta VALUES ('index-run',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          )
          .run(run.id);
        this.db
          .prepare(
            "DELETE FROM graph_meta WHERE key IN ('command-complete','analysis-complete')",
          )
          .run();
      } else if (run.state === "written") {
        if (this.indexRunMark() !== run.id) throw new GraphIndexTakenOver();
        // A writer that is not an index run: this run's result is no longer
        // its own, so it publishes no completion.
        if (this.commandDataVersion() !== run.version) run.interleaved = true;
      }
    } catch (error) {
      this.rollback();
      throw error;
    }
    if (this.batching && this.writeAheadLog && this.turnstile) {
      this.batchOpen = this.totalChanges();
      return this.batchedWrite(action);
    }
    try {
      action();
    } catch (error) {
      this.rollback();
      throw error;
    }
    this.commitTransaction();
  }
  /** One write inside the open batch, then its commit once the budget is met. */
  private batchedWrite(action: () => void): void {
    try {
      action();
    } catch (error) {
      this.rollback();
      throw error;
    }
    if (
      this.totalChanges() - this.batchOpen! >=
      SqliteGraphStore.writeBatchRows
    )
      this.commitTransaction();
  }
  /** Commits the open write transaction and records it for the run. */
  private commitTransaction(): void {
    this.batchOpen = undefined;
    const run = this.indexRun;
    try {
      // Read under the write lock, before the commit: this connection's own
      // commit does not change it, another connection's later one does.
      const version =
        run.state === "idle" ? undefined : this.commandDataVersion();
      this.db.exec("COMMIT");
      if (run.state !== "idle") {
        run.state = "written";
        run.version = version!;
      }
    } catch (error) {
      this.rollback();
      throw error;
    }
  }
  private indexRunMark(): string | undefined {
    return this.db
      .prepare("SELECT value FROM graph_meta WHERE key='index-run'")
      .get()?.value as string | undefined;
  }
  files(): GraphFile[] {
    // One stored body at a time: never every body string and its decoding at once.
    const files: GraphFile[] = [];
    for (const row of this.db
      .prepare("SELECT body FROM graph_files ORDER BY path")
      .iterate())
      files.push(this.decodeFile(row.body as string));
    return files.sort((a, b) => compare(a.path, b.path));
  }
  filesAt(paths: readonly string[]): GraphFile[] {
    const select = this.db.prepare("SELECT body FROM graph_files WHERE path=?");
    const files: GraphFile[] = [];
    for (const path of [...new Set(paths)].sort(compare)) {
      const row = select.get(path);
      if (row) files.push(this.decodeFile(row.body as string));
    }
    return files;
  }
  resolutionFiles(linkKinds: readonly string[]): ResolutionFile[] {
    return this.db
      .prepare(
        `SELECT path,status,body ->> '$.module' AS module,
      body -> '$.result.data' AS facts,body -> '$.result.diagnostics' AS diagnostics,
      (SELECT json_group_array(json(value) ORDER BY key)
       FROM json_each(f.body,'$.result.links')
       WHERE value ->> '$.kind' IN (SELECT value FROM json_each(?))) AS links
      FROM graph_files f ORDER BY path`,
      )
      .all(JSON.stringify(linkKinds))
      .map((row) => {
        const diagnostics = row.diagnostics as string;
        const links = row.links as string;
        const facts = typeof row.facts === "string" ? row.facts : undefined;
        count("store.resolutionFileProjectionRows");
        count(
          "store.resolutionFileProjectionBytes",
          Buffer.byteLength(diagnostics) +
            Buffer.byteLength(links) +
            Buffer.byteLength(facts ?? ""),
        );
        return {
          path: row.path as string,
          module: row.module as string,
          result: {
            status: row.status as ResolutionFile["result"]["status"],
            diagnostics: JSON.parse(
              diagnostics,
            ) as ResolutionFile["result"]["diagnostics"],
            links: JSON.parse(links) as ResolutionFile["result"]["links"],
            ...(facts === undefined ? {} : { data: JSON.parse(facts) }),
          },
        };
      });
  }
  /** Path, module and status of every stored file, without decoding records. */
  fileSummaries(): {
    path: string;
    module: string;
    status: GraphFile["result"]["status"];
    hash: string;
    version: string;
  }[] {
    return this.db
      .prepare(
        `SELECT path,status,json_extract(body,'$.module') AS module,
          json_extract(body,'$.hash') AS hash,json_extract(body,'$.version') AS version
        FROM graph_files ORDER BY path`,
      )
      .all()
      .map((row) => ({
        path: row.path as string,
        module: row.module as string,
        status: row.status as GraphFile["result"]["status"],
        hash: row.hash as string,
        version: row.version as string,
      }))
      .sort((a, b) => compare(a.path, b.path));
  }
  getFile(path: string): GraphFile | undefined {
    const row = this.db
      .prepare("SELECT body FROM graph_files WHERE path=?")
      .get(path);
    return row ? this.decodeFile(row.body as string) : undefined;
  }
  contexts(): ContextFile[] {
    const bodies = this.db
      .prepare("SELECT body FROM graph_contexts ORDER BY path")
      .all()
      .map((row) => row.body as string);
    const retained = new Set(bodies);
    for (const body of this.decodedContexts.keys())
      if (!retained.has(body)) this.decodedContexts.delete(body);
    return bodies
      .map((body) => {
        let file = this.decodedContexts.get(body);
        if (!file) {
          file = JSON.parse(body) as ContextFile;
          this.decodedContexts.set(body, file);
        }
        return structuredClone(file);
      })
      .sort((a, b) => compare(a.path, b.path));
  }
  replaceContexts(files: readonly ContextFile[]): void {
    const previous = new Map(
      this.contexts().map((file) => [file.path, JSON.stringify(file)]),
    );
    const desired = new Map(
      files.map((file) => [file.path, JSON.stringify(file)]),
    );
    if (desired.size !== files.length) throw Error("Duplicate context file");
    const changed = [...desired].filter(
      ([path, body]) => previous.get(path) !== body,
    );
    const removed = [...previous.keys()].filter((path) => !desired.has(path));
    if (!changed.length && !removed.length) return;
    this.transaction(() => {
      const remove = this.db.prepare("DELETE FROM graph_contexts WHERE path=?");
      const insert = this.db.prepare(
        "INSERT INTO graph_contexts VALUES (?,?) ON CONFLICT(path) DO UPDATE SET body=excluded.body",
      );
      for (const path of removed) remove.run(path);
      for (const [path, body] of changed) insert.run(path, body);
    });
  }
  isParseFailure(path: string): boolean {
    return !!this.db
      .prepare(
        `SELECT p.path FROM graph_parse_failures p JOIN graph_files f ON f.path=p.path
        WHERE p.path=? AND f.status='failed'
        AND p.hash=json_extract(f.body,'$.hash')
        AND p.module=json_extract(f.body,'$.module')
        AND p.version=json_extract(f.body,'$.version')
        AND coalesce(json_extract(f.body,'$.result.failureKind'),'content')='content'`,
      )
      .get(path);
  }
  failedFiles(): FailedFile[] {
    return this.db
      .prepare(
        "SELECT body FROM graph_files WHERE status='failed' ORDER BY path",
      )
      .all()
      .map((row) => {
        const file = this.decodeFile(row.body as string);
        const first = file.result.diagnostics[0]!;
        return {
          path: file.path,
          language: file.module,
          reason: first.message,
          ...(first.range === undefined ? {} : { range: first.range }),
        };
      })
      .sort((a, b) => compare(a.path, b.path));
  }
  replaceFile(file: GraphFile, parseFailure = false): void {
    let facts: ReturnType<typeof fileFacts>;
    try {
      this.validateFile(file);
      facts = fileFacts(this.projectId, file);
    } catch (error) {
      this.failedWrite();
      throw error;
    }
    const sql = this.writer();
    count("store.filesWritten");
    count("store.symbolRowsWritten", facts.symbols.length);
    this.transaction(() => {
      count(
        "store.linkRowsDeleted",
        Number(
          sql("DELETE FROM graph_links WHERE file=?").run(file.path).changes,
        ),
      );
      sql(
        "INSERT INTO graph_files VALUES (?,?,?) ON CONFLICT(path) DO UPDATE SET body=excluded.body,status=excluded.status",
      ).run(file.path, JSON.stringify(file), file.result.status);
      sql("DELETE FROM graph_parse_failures WHERE path=?").run(file.path);
      if (
        parseFailure &&
        file.result.status === "failed" &&
        file.result.failureKind !== "transient"
      )
        sql(
          "INSERT INTO graph_parse_failures (path,hash,module,version) VALUES (?,?,?,?)",
        ).run(file.path, file.hash, file.module, file.version);
      const insert = sql(
        "INSERT INTO graph_symbols VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,body=excluded.body",
      );
      for (const symbol of facts.symbols)
        insert.run(
          symbol.id,
          file.path,
          symbol.name,
          symbol.kind,
          JSON.stringify(symbol),
        );
      const retained = new Set(facts.symbols.map((symbol) => symbol.id));
      for (const row of sql("SELECT id FROM graph_symbols WHERE file=?").all(
        file.path,
      ))
        if (!retained.has(row.id as string))
          sql("DELETE FROM graph_symbols WHERE id=?").run(row.id!);
      if (file.result.status === "failed")
        for (const symbol of facts.symbols) {
          sql("UPDATE graph_links SET target=NULL WHERE target=?").run(
            symbol.id,
          );
          sql("DELETE FROM graph_candidates WHERE symbol=?").run(symbol.id);
        }
      for (const link of facts.links) this.insertLink(link, sql);
    });
  }
  private validateFile(file: GraphFile): void {
    if (
      !file.path ||
      file.path.startsWith("/") ||
      file.path.includes("\\") ||
      file.path
        .split("/")
        .some((part) => !part || part === "." || part === "..")
    )
      throw Error("Expected project-relative POSIX path");
    validateResult(file.text, file.result);
  }
  private insertLink(
    link: GraphLink,
    sql: (sql: string) => StatementSync,
  ): void {
    count("store.linkRowsInserted");
    sql("INSERT INTO graph_links VALUES (?,?,?,?,?,?,?,?,?)").run(
      link.id,
      link.file,
      link.sourceId,
      link.targetId,
      link.kind,
      JSON.stringify(link),
      link.module,
      link.origin,
      link.resolution,
    );
    for (const candidate of link.candidates)
      sql("INSERT INTO graph_candidates VALUES (?,?,?)").run(
        link.id,
        candidate.id,
        link.kind,
      );
    this.insertLibraries(link, sql);
  }
  private insertLibraries(
    link: GraphLink,
    sql: (sql: string) => StatementSync,
  ): void {
    for (const library of link.libraries ?? [])
      sql("INSERT INTO graph_library_targets VALUES (?,?,?,?,?,?,?,?,?,?)").run(
        link.id,
        library.id,
        link.resolution === "library" ? "target" : "candidate",
        link.kind,
        library.ecosystem,
        library.unit,
        library.symbol ?? null,
        library.version ?? null,
        library.versionSource ?? null,
        library.evidence,
      );
  }
  removeFile(path: string): void {
    count("store.filesRemoved");
    const remove = () =>
      this.db.prepare("DELETE FROM graph_files WHERE path=?").run(path);
    // A write of an index run carries or checks its mark.
    if (this.indexRun.state !== "idle") this.transaction(remove);
    else {
      this.beforeWrite();
      const entered = this.enterTurnstile();
      try {
        remove();
      } finally {
        if (entered) this.leaveTurnstile();
      }
    }
  }
  findSymbols(query: SymbolQuery = {}): GraphSymbol[] {
    const conditions: string[] = [];
    const values: string[] = [];
    for (const key of ["name", "kind", "file"] as const)
      if (query[key] !== undefined) {
        conditions.push(`${key}=?`);
        values.push(query[key]);
      }
    return this.db
      .prepare(
        `SELECT body FROM graph_symbols ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY id`,
      )
      .all(...values)
      .map((row) => JSON.parse(row.body as string) as GraphSymbol);
  }
  symbolReferences(ids: ReadonlySet<string>): SymbolReference[] {
    if (!ids.size) return [];
    return this.db
      .prepare(
        `SELECT id,file,json_extract(body,'$.key') AS key,
      json_extract(body,'$.status') AS status FROM graph_symbols
      WHERE id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify([...ids]))
      .map((row) => ({
        id: row.id as string,
        file: row.file as string,
        key: row.key as string,
        status: row.status as SymbolReference["status"],
      }));
  }
  private selectLinks(
    where = "",
    values: string[] = [],
    limit?: number,
  ): GraphLink[] {
    // The capability check and the read describe one database state.
    return this.snapshot(() =>
      this.db
        .prepare(
          `SELECT l.body,l.target,f.status AS sourceStatus,tf.status AS targetStatus,
      (SELECT json_group_array(json_object('id',id,'status',status)) FROM
        (SELECT c.symbol AS id,cf.status AS status FROM graph_candidates c
         JOIN graph_symbols cs ON cs.id=c.symbol JOIN graph_files cf${this.fileStatusIndex} ON cf.path=cs.file
         WHERE c.link=l.id ORDER BY c.symbol)) AS candidates${
           this.libraryTable()
             ? `,
      (SELECT json_group_array(json_object('id',id,'role',role,'ecosystem',ecosystem,'unit',unit,
        'symbol',symbol,'version',version,'versionSource',version_source,'evidence',evidence)) FROM
        (SELECT * FROM graph_library_targets WHERE link=l.id ORDER BY id)) AS libraries`
             : ""
         }
      FROM graph_links l JOIN graph_files f${this.fileStatusIndex} ON f.path=l.file
      LEFT JOIN graph_symbols ts ON ts.id=l.target LEFT JOIN graph_files tf${this.fileStatusIndex} ON tf.path=ts.file
      ${where ? `WHERE ${where}` : ""} ORDER BY l.id${limit === undefined ? "" : ` LIMIT ${limit}`}`,
        )
        .all(...values)
        .map((row) => {
          const link = JSON.parse(row.body as string) as GraphLink;
          const candidates = JSON.parse(
            row.candidates as string,
          ) as GraphLink["candidates"];
          const targetId = row.target as string | null;
          const stored = row.libraries
            ? (JSON.parse(row.libraries as string) as (Record<
                keyof GraphLibrary,
                string | null
              > & { role: string })[])
            : [];
          const libraries = stored.map(
            ({ role: _role, symbol, version, versionSource, ...item }) =>
              ({
                id: item.id,
                ecosystem: item.ecosystem,
                unit: item.unit,
                ...(symbol === null ? {} : { symbol }),
                ...(version === null ? {} : { version, versionSource }),
                evidence: item.evidence,
              }) as GraphLibrary,
          );
          const result: GraphLink = {
            ...link,
            targetId,
            targetStatus: (row.targetStatus ??
              null) as GraphLink["targetStatus"],
            sourceStatus: row.sourceStatus as GraphLink["sourceStatus"],
            candidates,
            resolution: targetId
              ? "resolved"
              : candidates.length ||
                  stored.some((item) => item.role === "candidate")
                ? "ambiguous"
                : stored.length
                  ? "library"
                  : "unresolved",
          };
          delete result.libraries;
          if (libraries.length) result.libraries = libraries;
          return result;
        }),
    );
  }
  links(): GraphLink[] {
    return this.selectLinks();
  }
  /** One module's parsed links, as links() reports them. */
  moduleLinks(module: string): GraphLink[] {
    return this.selectLinks("l.module=? AND l.origin='parse'", [module]);
  }
  outgoing(id: string, kind?: string): GraphLink[] {
    return this.selectLinks(
      `l.source=?${kind === undefined ? "" : " AND l.kind=?"}`,
      kind === undefined ? [id] : [id, kind],
    );
  }
  incoming(id: string, kind?: string): GraphLink[] {
    const filter = kind === undefined ? "" : " AND kind=?";
    return this.selectLinks(
      `l.id IN (SELECT id FROM graph_links WHERE target=?${filter} UNION SELECT link FROM graph_candidates WHERE symbol=?${filter})`,
      kind === undefined ? [id, id] : [id, kind, id, kind],
    );
  }
  unresolved(): GraphLink[] {
    return this.selectLinks("l.resolution='unresolved'");
  }
  ambiguous(): GraphLink[] {
    return this.selectLinks("l.resolution='ambiguous'");
  }
  /**
   * Project links whose target, or one of whose candidates, is library unit
   * `unit` (any ecosystem), or exactly symbol `symbol` in it.
   */
  libraryUses(unit: string, symbol: string | undefined, limit: number) {
    this.queryLimit(limit);
    return this.snapshot(() =>
      !this.libraryTable()
        ? []
        : this.selectLinks(
            `l.id IN (SELECT link FROM graph_library_targets WHERE unit=?${symbol === undefined ? "" : " AND symbol=?"})`,
            symbol === undefined ? [unit] : [unit, symbol],
            limit,
          ),
    );
  }
  /** Whether any link targets library unit `unit` of this ecosystem. */
  hasLibraryUnit(unit: string, ecosystem: string): boolean {
    return this.snapshot(
      () =>
        this.libraryTable() &&
        !!this.db
          .prepare(
            "SELECT 1 FROM graph_library_targets WHERE unit=? AND ecosystem=? LIMIT 1",
          )
          .get(unit, ecosystem),
    );
  }
  /** Exact counts of the same links as libraryUses, by class. */
  libraryUseCounts(
    unit: string,
    symbol: string | undefined,
  ): { library: number; candidateSet: number } {
    return this.snapshot(() => {
      if (!this.libraryTable()) return { library: 0, candidateSet: 0 };
      const row = this.db
        .prepare(
          `SELECT COUNT(DISTINCT CASE WHEN role='target' THEN link END) AS library,
          COUNT(DISTINCT CASE WHEN role='candidate' THEN link END) AS candidateSet
        FROM graph_library_targets WHERE unit=?${symbol === undefined ? "" : " AND symbol=?"}`,
        )
        .get(...(symbol === undefined ? [unit] : [unit, symbol]))!;
      return {
        library: Number(row.library),
        candidateSet: Number(row.candidateSet),
      };
    });
  }
  private writeTargets(
    current: readonly GraphLink[],
    desired: readonly GraphLink[],
    sql: (sql: string) => StatementSync,
    write: (step: () => void) => void,
  ): void {
    const byId = new Map(current.map((link) => [link.id, link]));
    for (const link of desired)
      write(() => {
        const before = byId.get(link.id);
        if (before && before.data !== link.data)
          sql("UPDATE graph_links SET body=? WHERE id=?").run(
            JSON.stringify(link),
            link.id,
          );
        // An unresolved link has no target rows. The library insert triggers
        // the class update, so there are no old relationships to clear.
        if (
          before?.resolution === "unresolved" &&
          link.resolution === "library"
        ) {
          this.insertLibraries(link, sql);
          return;
        }
        if (
          before?.targetId === link.targetId &&
          JSON.stringify(before.candidates.map((item) => item.id)) ===
            JSON.stringify(link.candidates.map((item) => item.id)) &&
          before.resolution === link.resolution &&
          JSON.stringify(before.libraries ?? []) ===
            JSON.stringify(link.libraries ?? [])
        )
          return;
        count("store.linkTargetsRewritten");
        sql("UPDATE graph_links SET target=? WHERE id=?").run(
          link.targetId,
          link.id,
        );
        sql("DELETE FROM graph_candidates WHERE link=?").run(link.id);
        for (const candidate of link.candidates)
          sql("INSERT INTO graph_candidates VALUES (?,?,?)").run(
            link.id,
            candidate.id,
            link.kind,
          );
        if (before?.libraries || link.libraries) {
          sql("DELETE FROM graph_library_targets WHERE link=?").run(link.id);
          this.insertLibraries(link, sql);
        }
      });
  }
  /**
   * C-37: a write of many rows, one module's resolution, as steps of one
   * link each. Inside a batch scope (under the write-ahead log, with the
   * turnstile) each step is one write of the batches, which commit at the
   * row budget, so no transaction of a run holds the write lock for more
   * than about one batch. Otherwise every step shares one transaction, as
   * before.
   */
  private inSteps(writes: (write: (step: () => void) => void) => void): void {
    this.beforeWrite();
    if (this.batching && this.writeAheadLog && this.openTurnstile())
      writes((step) => this.transaction(step));
    else this.transaction(() => writes((step) => step()));
  }
  resolveLinks(resolutions: readonly LinkResolution[]): void {
    const current = this.links();
    const decider = new LinkDecider(this.findSymbols(), (path) =>
      this.cleanContext(path),
    );
    const linkIds = new Set(current.map((link) => link.id));
    const decisions = new Map<string, LinkResolution>();
    for (const item of resolutions) {
      if (decisions.has(item.linkId) || !linkIds.has(item.linkId))
        throw Error("Invalid or duplicate link resolution");
      decisions.set(item.linkId, item);
    }
    const desired = current.map((link) =>
      decider.decide(link, decisions.get(link.id)),
    );
    if (!sameLinks(current, desired)) {
      const sql = this.writer();
      this.inSteps((write) => this.writeTargets(current, desired, sql, write));
    }
  }
  replaceAnalysis(
    module: string,
    result: ResolutionResult,
    validated?: ValidatedAnalysis,
  ): void {
    if (validated)
      return this.writeAnalysis(validated.current, validated.desired);
    const current = this.analysisLinks(module);
    const desired = resolutionFacts(
      this.projectId,
      module,
      result,
      (path) => {
        const row = this.db
          .prepare("SELECT body FROM graph_files WHERE path=?")
          .get(path);
        return row ? this.decodeFile(row.body as string) : undefined;
      },
      this.findSymbols(),
      current,
      (path) => this.cleanContext(path),
    );
    this.writeAnalysis(current, desired);
  }
  /** Every link of one module, parsed and added, as links() reports them. */
  analysisLinks(module: string): GraphLink[] {
    return this.selectLinks("l.module=?", [module]);
  }
  // Unary + keeps SQLite from scanning the module index for a path lookup.
  private static linksAt =
    "l.file IN (SELECT value FROM json_each(?)) AND +l.module=?";
  analysisLinksAt(module: string, paths: ReadonlySet<string>): GraphLink[] {
    return this.selectLinks(SqliteGraphStore.linksAt, [
      JSON.stringify([...paths]),
      module,
    ]);
  }
  /**
   * One module's parsed links as a resolver receives them: unresolved, with
   * no target, candidates or library targets, so none of those rows is read.
   * Each is the record moduleLinks() returns, with those fields cleared.
   */
  moduleInputLinks(module: string): GraphLink[] {
    return this.selectModuleInputLinks("l.module=?", [module]);
  }
  moduleInputLinksAt(module: string, paths: ReadonlySet<string>): GraphLink[] {
    return this.selectModuleInputLinks(SqliteGraphStore.linksAt, [
      JSON.stringify([...paths]),
      module,
    ]);
  }
  private selectModuleInputLinks(where: string, values: string[]): GraphLink[] {
    return this.db
      .prepare(
        `SELECT l.body,f.status AS sourceStatus FROM graph_links l JOIN graph_files f${this.fileStatusIndex} ON f.path=l.file
        WHERE ${where} AND l.origin='parse' ORDER BY l.id`,
      )
      .all(...values)
      .map((row) => {
        const { libraries: _previous, ...link } = JSON.parse(
          row.body as string,
        ) as GraphLink;
        void _previous;
        return {
          ...link,
          targetId: null,
          targetStatus: null,
          sourceStatus: row.sourceStatus as GraphLink["sourceStatus"],
          candidates: [],
          resolution: "unresolved" as const,
        };
      });
  }
  /** Writes only the rows of `desired` that differ from `current`. */
  private writeAnalysis(
    current: readonly GraphLink[],
    desired: readonly GraphLink[],
  ): void {
    count("store.linksCompared", current.length);
    if (sameLinks(current, desired)) return;
    const sql = this.writer();
    this.inSteps((write) => {
      const wanted = new Map(desired.map((link) => [link.id, link]));
      const previous = new Map(current.map((link) => [link.id, link]));
      for (const link of current)
        if (
          link.origin === "analysis" &&
          (!wanted.has(link.id) ||
            JSON.stringify(link) !== JSON.stringify(wanted.get(link.id)))
        )
          write(() => {
            count("store.linkRowsDeleted");
            sql("DELETE FROM graph_links WHERE id=?").run(link.id);
          });
      for (const link of desired)
        if (
          link.origin === "analysis" &&
          JSON.stringify(previous.get(link.id)) !== JSON.stringify(link)
        )
          write(() => this.insertLink(link, sql));
      this.writeTargets(
        current,
        desired.filter((link) => link.origin === "parse"),
        sql,
        write,
      );
    });
  }
  neighbourhood(id: string, depth: number, kind?: string): Neighbourhood {
    if (!Number.isInteger(depth) || depth < 0 || depth > 100)
      throw Error("Depth must be an integer from 0 to 100");
    const symbolById = this.db.prepare(
      "SELECT body FROM graph_symbols WHERE id=?",
    );
    if (!symbolById.get(id)) return { symbols: [], links: [] };
    const filter = kind === undefined ? "" : " AND kind=?";
    const incident = this.db
      .prepare(`SELECT id FROM graph_links WHERE source=?${filter}
      UNION SELECT id FROM graph_links WHERE target=?${filter}
      UNION SELECT link AS id FROM graph_candidates WHERE symbol=?${filter}`);
    const visited = new Set([id]);
    const links = new Map<string, GraphLink>();
    let frontier = [id];
    for (let level = 0; level < depth && frontier.length; level++) {
      const next: string[] = [];
      for (const current of frontier)
        for (const row of incident.all(
          ...(kind === undefined
            ? [current, current, current]
            : [current, kind, current, kind, current, kind]),
        )) {
          const linkId = row.id as string;
          if (links.has(linkId)) continue;
          const link = this.selectLinks("l.id=?", [linkId])[0]!;
          links.set(link.id, link);
          for (const endpoint of [
            link.sourceId,
            link.targetId,
            ...link.candidates.map((candidate) => candidate.id),
          ])
            if (endpoint !== null && !visited.has(endpoint)) {
              visited.add(endpoint);
              next.push(endpoint);
            }
        }
      frontier = next;
    }
    return {
      symbols: [...visited]
        .sort(compare)
        .map(
          (key) =>
            JSON.parse(symbolById.get(key)!.body as string) as GraphSymbol,
        ),
      links: [...links.values()].sort((a, b) => compare(a.id, b.id)),
    };
  }
  readCommandSnapshot<T>(read: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = read();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  graphCommandState(): unknown {
    try {
      // An index run that did not finish leaves no complete graph (C-22).
      const row = this.db
        .prepare(
          "SELECT value FROM graph_meta WHERE key='command-complete' AND NOT EXISTS(SELECT 1 FROM graph_meta WHERE key='index-run')",
        )
        .get();
      return row ? JSON.parse(row.value as string) : null;
    } catch {
      return null;
    }
  }
  /**
   * C-33: the completion record and the analysis completion record, read
   * in one snapshot without writing. Null when a writable connection would
   * first change the file (an older schema, or a missing table, index,
   * column or trigger) or the read fails, for example on a lock.
   */
  verifiedCommandState(): {
    state: unknown;
    analysis: ReadonlyMap<string, string>;
    analysisRecorded: boolean;
  } | null {
    try {
      this.db.exec("BEGIN");
      try {
        if (!this.schemaCurrent()) return null;
        return {
          state: this.graphCommandState(),
          analysis: this.readCompletedAnalysis(),
          analysisRecorded: !!this.db
            .prepare("SELECT 1 FROM graph_meta WHERE key='analysis-complete'")
            .get(),
        };
      } finally {
        this.db.exec("COMMIT");
      }
    } catch {
      return null;
    }
  }
  invalidateGraphCommandState(): void {
    // Nothing to remove is no write (C-6).
    if (
      !this.db
        .prepare("SELECT 1 FROM graph_meta WHERE key='command-complete'")
        .get()
    )
      return;
    this.beforeWrite();
    const entered = this.enterTurnstile();
    try {
      this.db
        .prepare("DELETE FROM graph_meta WHERE key='command-complete'")
        .run();
    } finally {
      if (entered) this.leaveTurnstile();
    }
  }
  /**
   * C-22: whether an index run began writing and did not finish. Its writes
   * may have replaced some files' records and not others.
   */
  unfinishedIndexRun(): boolean {
    return this.indexRunMark() !== undefined;
  }
  /**
   * Begins an index run with its own identifier. Its mark is written in the
   * same commit as its first write, with the completion record's removal,
   * so a run that writes nothing leaves the file as it was, and any write of
   * the run that survives a crash has the mark with it. A mark already there
   * belongs to a run that did not finish or is still running: this run
   * takes it over at once (that run then writes nothing more) and returns
   * true, and must treat everything as changed.
   */
  beginIndexRun(): boolean {
    // The journal is chosen first: nothing this run does after the baseline
    // below changes the data version except its own commits (C-22).
    this.beforeWrite();
    // The baseline and the mark are one read snapshot.
    let version: number;
    let takeOver: boolean;
    let completed: ReadonlyMap<string, string>;
    this.db.exec("BEGIN");
    try {
      version = this.commandDataVersion();
      takeOver = this.unfinishedIndexRun();
      completed = takeOver ? new Map() : this.readCompletedAnalysis();
    } finally {
      this.db.exec("COMMIT");
    }
    this.indexRun = {
      state: "pending",
      id: randomUUID(),
      version,
      takeOver,
      completed,
      interleaved: false,
    };
    if (!takeOver) return false;
    this.transaction(() => {});
    return true;
  }
  private readCompletedAnalysis(): ReadonlyMap<string, string> {
    const row = this.db
      .prepare("SELECT value FROM graph_meta WHERE key='analysis-complete'")
      .get();
    if (typeof row?.value === "string") {
      try {
        const entries: unknown = JSON.parse(row.value);
        if (
          Array.isArray(entries) &&
          entries.every(
            (entry) =>
              Array.isArray(entry) &&
              entry.length === 2 &&
              entry.every((part) => typeof part === "string"),
          )
        )
          return new Map<string, string>(entries);
      } catch {
        // A malformed receipt cannot prove reuse.
      }
    }
    return new Map();
  }
  completedAnalysis(): ReadonlyMap<string, string> {
    return this.indexRun.state === "idle" ? new Map() : this.indexRun.completed;
  }
  /** Clears the mark and records completed decisions if the run still owns the store. */
  finishIndexRun(
    incomplete = false,
    completed: ReadonlyMap<string, string> = new Map(),
  ): void {
    const run = this.indexRun;
    try {
      if (incomplete && run.state !== "idle") this.transaction(() => {});
      // A run another connection wrote into keeps its mark: the next run
      // redoes everything.
      if (!incomplete && run.state === "written")
        this.transaction(() => {
          if (run.interleaved) return;
          this.db.prepare("DELETE FROM graph_meta WHERE key='index-run'").run();
          if (completed.size)
            this.db
              .prepare("INSERT INTO graph_meta VALUES ('analysis-complete',?)")
              .run(
                JSON.stringify(
                  [...completed].sort(([a], [b]) => compare(a, b)),
                ),
              );
        });
      // What the run read and wrote is current while no other connection
      // commits after the version taken under its last write lock (or at
      // its beginning if it wrote nothing); the completion checks it under
      // its own write lock.
      if (run.state !== "idle")
        this.finishedVersion =
          incomplete || run.interleaved ? Number.NaN : run.version;
    } finally {
      this.indexRun = { state: "idle" };
    }
  }
  /**
   * The data version at which this connection's last finished run was
   * current. A completion record is written only while it still is (C-22).
   */
  private finishedVersion: number | undefined;
  private finishedRunCurrent(): boolean {
    return (
      this.finishedVersion === undefined ||
      this.commandDataVersion() === this.finishedVersion
    );
  }
  commandDataVersion(): number {
    return Number(this.db.prepare("PRAGMA data_version").get()!.data_version);
  }
  completeGraphCommandState(state: unknown, expectedVersion?: number): boolean {
    // An index that changed nothing writes nothing (C-6): the same record,
    // over the same data and with no run unfinished, is left as it is.
    const body = JSON.stringify(state);
    const same = this.db
      .prepare(
        "SELECT 1 FROM graph_meta WHERE key='command-complete' AND value=? AND NOT EXISTS(SELECT 1 FROM graph_meta WHERE key='index-run')",
      )
      .get(body);
    if (
      same &&
      this.finishedRunCurrent() &&
      (expectedVersion === undefined ||
        this.commandDataVersion() === expectedVersion)
    )
      return true;
    this.beforeWrite();
    let written = false;
    // The completion record is durable when this returns: its commit is
    // synced, and with it every earlier commit in the log.
    const sync = Number(
      this.db.prepare("PRAGMA synchronous").get()!.synchronous,
    );
    this.db.exec("PRAGMA synchronous=FULL");
    try {
      // Lock publication so another connection cannot commit between validation and publication.
      this.transaction(() => {
        if (
          !this.finishedRunCurrent() ||
          (expectedVersion !== undefined &&
            this.commandDataVersion() !== expectedVersion)
        ) {
          // Another connection committed after the run's last write: what
          // is stored is no longer only the run's. Marked unfinished, in the
          // same locked transaction, so the next run redoes everything
          // (C-22).
          this.db
            .prepare(
              "INSERT INTO graph_meta VALUES ('index-run','interleaved') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            )
            .run();
          return;
        }
        this.db
          .prepare(
            "INSERT INTO graph_meta VALUES ('command-complete',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          )
          .run(JSON.stringify(state));
        written = true;
      });
    } finally {
      this.db.exec(`PRAGMA synchronous=${sync}`);
    }
    return written;
  }
  /** Command preflight reads metadata without returning source text or parse facts. */
  fileInventory(path?: string) {
    return this.db
      .prepare(
        `SELECT path,status,json_extract(body,'$.hash') AS hash,
      json_extract(body,'$.module') AS module,json_extract(body,'$.version') AS version,
      json_extract(body,'$.result.failureKind') AS failureKind,
      json_extract(body,'$.result.diagnostics[0]') AS diagnostic
      FROM graph_files ${path === undefined ? "" : "WHERE path=?"} ORDER BY path`,
      )
      .all(...(path === undefined ? [] : [path]))
      .map((row) => ({
        path: row.path as string,
        hash: row.hash as string,
        module: row.module as string,
        version: row.version as string,
        status: row.status as GraphFile["result"]["status"],
        failureKind: row.failureKind as string | null,
        diagnostic:
          row.diagnostic === null
            ? null
            : (JSON.parse(
                row.diagnostic as string,
              ) as GraphFile["result"]["diagnostics"][number]),
        cacheable:
          row.status === "failed" && this.isParseFailure(row.path as string),
      }));
  }
  contextInventory() {
    return this.db
      .prepare(
        `SELECT path,json_extract(body,'$.hash') AS hash,
      json_extract(body,'$.status') AS status,json_extract(body,'$.diagnostics[0]') AS diagnostic,
      json_extract(body,'$.dependency') AS dependency
      FROM graph_contexts ORDER BY path`,
      )
      .all()
      .map((row) => ({
        path: row.path as string,
        hash: row.hash as string,
        status: row.status as ContextFile["status"],
        ...(typeof row.dependency === "string" && {
          dependency: JSON.parse(row.dependency) as NonNullable<
            ContextFile["dependency"]
          >,
        }),
        diagnostic:
          row.diagnostic === null
            ? null
            : (JSON.parse(
                row.diagnostic as string,
              ) as ContextFile["diagnostics"][number]),
      }));
  }
  counts() {
    const count = (table: string, where = "") =>
      Number(
        this.db.prepare(`SELECT count(*) AS n FROM ${table} ${where}`).get()!.n,
      );
    // Every class from one database state.
    return this.snapshot(() => ({
      files: count("graph_files"),
      symbols: count("graph_symbols"),
      links: count("graph_links"),
      failed: count("graph_files", "WHERE status='failed'"),
      partial: count("graph_files", "WHERE status='partial'"),
      unresolved: count("graph_links", "WHERE resolution='unresolved'"),
      ambiguous: count("graph_links", "WHERE resolution='ambiguous'"),
      library: count("graph_links", "WHERE resolution='library'"),
    }));
  }
  getSymbol(id: string): GraphSymbol | undefined {
    const row = this.db
      .prepare("SELECT body FROM graph_symbols WHERE id=?")
      .get(id);
    return row ? (JSON.parse(row.body as string) as GraphSymbol) : undefined;
  }
  searchSymbols(
    text: string,
    limit: number,
    caseSensitive = false,
  ): GraphSymbol[] {
    this.queryLimit(limit);
    const name = caseSensitive ? "name" : "lower(name)";
    const identity = caseSensitive
      ? "json_extract(body,'$.identity')"
      : "lower(json_extract(body,'$.identity'))";
    const needle = caseSensitive ? "?" : "lower(?)";
    return this.db
      .prepare(
        `SELECT body FROM graph_symbols
      WHERE instr(${name},${needle})>0 OR instr(${identity},${needle})>0
      ORDER BY CASE WHEN json_extract(body,'$.data.anonymous') THEN 1 ELSE 0 END,
        CASE WHEN ${name}=${needle} OR ${identity}=${needle} THEN 0
        WHEN instr(${name},${needle})=1 OR instr(${identity},${needle})=1 THEN 1 ELSE 2 END,
        COALESCE(json_extract(body,'$.data.scoped'),0),
        ${name},name,file,kind,id LIMIT ?`,
      )
      .all(text, text, text, text, text, text, limit)
      .map((row) => JSON.parse(row.body as string) as GraphSymbol);
  }
  fileSnapshot(path: string): { text: string; hash: string } | undefined {
    const row = this.db
      .prepare(
        "SELECT json_extract(body,'$.text') AS text,json_extract(body,'$.hash') AS hash FROM graph_files WHERE path=?",
      )
      .get(path);
    return row
      ? { text: row.text as string, hash: row.hash as string }
      : undefined;
  }
  symbolsAt(
    file: string,
    start: number,
    end: number,
    point: boolean,
  ): GraphSymbol[] {
    const first = "json_extract(body,'$.range.start')",
      last = "json_extract(body,'$.range.end')";
    return this.db
      .prepare(
        `SELECT body FROM graph_symbols WHERE file=? AND
      ${point ? `(${first}<=? AND ${last}>? OR ${first}=${last} AND ${first}=?)` : `(${first}<? AND ${last}>? OR ${first}=${last} AND ${first}>=? AND ${first}<?)`}
      ORDER BY id`,
      )
      .all(file, ...(point ? [start, start, start] : [end, start, start, end]))
      .map((row) => JSON.parse(row.body as string) as GraphSymbol);
  }
  hasFile(path: string): boolean {
    return !!this.db
      .prepare("SELECT path FROM graph_files WHERE path=?")
      .get(path);
  }
  namedSymbols(name: string, limit: number): GraphSymbol[] {
    this.queryLimit(limit);
    return this.db
      .prepare(
        `SELECT body FROM graph_symbols WHERE name=? OR json_extract(body,'$.identity')=?
         ORDER BY COALESCE(json_extract(body,'$.data.scoped'),0),file,id LIMIT ?`,
      )
      .all(name, name, limit)
      .map((row) => JSON.parse(row.body as string) as GraphSymbol);
  }
  symbolsForFile(path: string, limit: number): GraphSymbol[] {
    this.queryLimit(limit);
    return this.db
      .prepare(
        // Generated symbols (a language's `data.anonymous`) after named ones.
        `SELECT body FROM graph_symbols WHERE file=?
         ORDER BY CASE WHEN json_extract(body,'$.data.anonymous') THEN 1 ELSE 0 END,
           COALESCE(json_extract(body,'$.data.scoped'),0),id LIMIT ?`,
      )
      .all(path, limit)
      .map((row) => JSON.parse(row.body as string) as GraphSymbol);
  }
  private queryLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10001)
      throw Error("Invalid graph query limit");
  }
  linksForFile(path: string, limit?: number): GraphLink[] {
    if (limit !== undefined) this.queryLimit(limit);
    return this.selectLinks("l.file=?", [path], limit);
  }
  callLinks(
    id: string,
    direction: "incoming" | "outgoing",
    limit: number,
  ): GraphLink[] {
    this.queryLimit(limit);
    return direction === "outgoing"
      ? this.selectLinks("l.source=? AND l.kind='calls'", [id], limit)
      : this.selectLinks(
          "l.id IN (SELECT id FROM graph_links WHERE target=? AND kind='calls' UNION SELECT link FROM graph_candidates WHERE symbol=? AND kind='calls')",
          [id, id],
          limit,
        );
  }
  /** Exact counts of a symbol's incoming calls by class, the same rows as
   * callLinks(id, "incoming"): definite (a target) and candidate set (no
   * target, with candidates). Counting only; no link bodies are decoded. */
  incomingCallCounts(id: string): { definite: number; candidateSet: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(CASE WHEN l.target IS NOT NULL THEN 1 END) AS definite,
          COUNT(CASE WHEN l.target IS NULL AND EXISTS(SELECT 1 FROM graph_candidates c WHERE c.link=l.id) THEN 1 END) AS candidateSet
        FROM graph_links l WHERE l.id IN (SELECT id FROM graph_links WHERE target=? AND kind='calls' UNION SELECT link FROM graph_candidates WHERE symbol=? AND kind='calls')`,
      )
      .get(id, id)!;
    return {
      definite: Number(row.definite),
      candidateSet: Number(row.candidateSet),
    };
  }
  /** Stream only unresolved call rows with a relevant spelling or explicit target hint.
   * SQL is a broad prefilter; the caller must classify the stored evidence. */
  *unresolvedCallHints(target: GraphSymbol): Generator<GraphLink> {
    const rows = this.db.prepare(`SELECT id FROM graph_links
      WHERE module=? AND kind='calls' AND resolution='unresolved' AND
      (instr(json_extract(body,'$.targetName'),?)>0 OR instr(body,?)>0 OR EXISTS(
        SELECT 1 FROM json_each(graph_links.body,'$.data.targets') hint
        WHERE CASE WHEN hint.type='object' THEN json_extract(hint.value,'$.file') END=?
          AND CASE WHEN hint.type='object' THEN json_extract(hint.value,'$.key') END=?)) ORDER BY id`);
    for (const row of rows.iterate(
      target.module,
      target.name,
      target.id,
      target.file,
      target.key,
    ))
      yield this.selectLinks("l.id=?", [row.id as string])[0]!;
  }
  close(): void {
    try {
      // A writable connection that wrote nothing but found a log left by a
      // killed run still leaves the store at rest (C-6): a healthy store is
      // not touched.
      if (
        !this.writeAheadLog &&
        this.path !== undefined &&
        this.db.isOpen &&
        this.db.prepare("PRAGMA journal_mode").get()?.journal_mode === "wal"
      )
        this.beforeWrite();
      // The last connection checkpoints the log into the database (synced)
      // and the store is left with a rollback journal, as at rest before C-6.
      if (this.writeAheadLog && this.db.isOpen) closeWriteAheadLog(this.db);
    } finally {
      this.turnstile?.close();
      this.db.close();
    }
  }
}

/** Compare one persisted row at a time: never allocate a module-sized JSON string. */
function sameLinks(a: readonly GraphLink[], b: readonly GraphLink[]): boolean {
  return (
    a.length === b.length &&
    a.every((link, i) => JSON.stringify(link) === JSON.stringify(b[i]))
  );
}

/** Resolution derived from the stored target, candidates and library rows. */
const resolutionOf = (link: string, target: string) => `CASE
  WHEN ${target} IS NOT NULL THEN 'resolved'
  WHEN EXISTS(SELECT 1 FROM graph_candidates WHERE link=${link})
    OR EXISTS(SELECT 1 FROM graph_library_targets WHERE link=${link} AND role='candidate') THEN 'ambiguous'
  WHEN EXISTS(SELECT 1 FROM graph_library_targets WHERE link=${link}) THEN 'library'
  ELSE 'unresolved' END`;
/**
 * Library targets (schema 4): one row per link and target. role 'target' is
 * the link's only target (resolution 'library'); 'candidate' is a member of a
 * candidate set. Rows of their own so uses of a unit or symbol are one index read.
 */
const libraryTables = `CREATE TABLE IF NOT EXISTS graph_library_targets(link TEXT NOT NULL REFERENCES graph_links(id) ON DELETE CASCADE,
  id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('target','candidate')),kind TEXT NOT NULL,
  ecosystem TEXT NOT NULL,unit TEXT NOT NULL,symbol TEXT,version TEXT,version_source TEXT,evidence TEXT NOT NULL,PRIMARY KEY(link,id));
  CREATE INDEX IF NOT EXISTS graph_library_unit ON graph_library_targets(unit,symbol,link);
  CREATE INDEX IF NOT EXISTS graph_library_id ON graph_library_targets(id,link);
  CREATE TRIGGER IF NOT EXISTS graph_target_changed AFTER UPDATE OF target ON graph_links
  WHEN OLD.target IS NOT NEW.target BEGIN
    UPDATE graph_links SET resolution=${resolutionOf("NEW.id", "NEW.target")} WHERE id=NEW.id;
  END;
  CREATE TRIGGER IF NOT EXISTS graph_candidate_added AFTER INSERT ON graph_candidates BEGIN
    UPDATE graph_links SET resolution='ambiguous' WHERE id=NEW.link AND target IS NULL AND resolution!='ambiguous';
  END;
  CREATE TRIGGER IF NOT EXISTS graph_candidate_removed AFTER DELETE ON graph_candidates BEGIN
    UPDATE graph_links SET resolution=${resolutionOf("OLD.link", "target")}
      WHERE id=OLD.link AND resolution IS NOT ${resolutionOf("OLD.link", "target")};
  END;
  CREATE TRIGGER IF NOT EXISTS graph_library_added AFTER INSERT ON graph_library_targets BEGIN
    UPDATE graph_links SET resolution=${resolutionOf("NEW.link", "target")}
      WHERE id=NEW.link AND resolution IS NOT ${resolutionOf("NEW.link", "target")};
  END;
  CREATE TRIGGER IF NOT EXISTS graph_library_removed AFTER DELETE ON graph_library_targets BEGIN
    UPDATE graph_links SET resolution=${resolutionOf("OLD.link", "target")}
      WHERE id=OLD.link AND resolution IS NOT ${resolutionOf("OLD.link", "target")};
  END;`;

/** Every table, index and trigger a writable connection creates when missing. */
const graphTables = `CREATE TABLE IF NOT EXISTS graph_files(path TEXT PRIMARY KEY,body TEXT NOT NULL,status TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS graph_parse_failures(path TEXT PRIMARY KEY REFERENCES graph_files(path) ON DELETE CASCADE,hash TEXT,module TEXT,version TEXT);
  CREATE TABLE IF NOT EXISTS graph_contexts(path TEXT PRIMARY KEY,body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS graph_symbols(id TEXT PRIMARY KEY,file TEXT NOT NULL REFERENCES graph_files(path) ON DELETE CASCADE,name TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS graph_links(id TEXT PRIMARY KEY,file TEXT NOT NULL REFERENCES graph_files(path) ON DELETE CASCADE,source TEXT REFERENCES graph_symbols(id) ON DELETE CASCADE,target TEXT REFERENCES graph_symbols(id) ON DELETE SET NULL,kind TEXT NOT NULL,body TEXT NOT NULL,module TEXT NOT NULL,origin TEXT NOT NULL,resolution TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS graph_candidates(link TEXT NOT NULL REFERENCES graph_links(id) ON DELETE CASCADE,symbol TEXT NOT NULL REFERENCES graph_symbols(id) ON DELETE CASCADE,kind TEXT NOT NULL,PRIMARY KEY(link,symbol));
  CREATE INDEX IF NOT EXISTS graph_symbol_name ON graph_symbols(name,id);
  CREATE INDEX IF NOT EXISTS graph_symbol_identity ON graph_symbols(json_extract(body,'$.identity'),file,id);
  CREATE INDEX IF NOT EXISTS graph_symbol_name_kind ON graph_symbols(name,kind,id);
  CREATE INDEX IF NOT EXISTS graph_symbol_name_file ON graph_symbols(name,file,id);
  CREATE INDEX IF NOT EXISTS graph_symbol_name_kind_file ON graph_symbols(name,kind,file,id);
  CREATE INDEX IF NOT EXISTS graph_symbol_kind_file ON graph_symbols(kind,file,id);
  CREATE INDEX IF NOT EXISTS graph_symbol_file ON graph_symbols(file,id);
  CREATE INDEX IF NOT EXISTS graph_symbol_kind ON graph_symbols(kind,id);
  CREATE INDEX IF NOT EXISTS graph_link_file ON graph_links(file);
  CREATE INDEX IF NOT EXISTS graph_link_module ON graph_links(module);
  CREATE INDEX IF NOT EXISTS graph_link_resolution ON graph_links(resolution);
  CREATE INDEX IF NOT EXISTS graph_candidate_symbol ON graph_candidates(symbol,kind,link);
  ${libraryTables}
  CREATE INDEX IF NOT EXISTS graph_link_source ON graph_links(source,kind);
  CREATE INDEX IF NOT EXISTS graph_link_target ON graph_links(target,kind);
  CREATE INDEX IF NOT EXISTS graph_file_status ON graph_files(path,status);`;
const graphObjects = [
  ...graphTables.matchAll(
    /CREATE (?:TABLE|INDEX|TRIGGER) IF NOT EXISTS (\w+)/g,
  ),
].map((match) => match[1]!);

/**
 * Counts every SQL statement this connection executes (C-22 observation:
 * `store.sqlStatements`). The statements and their results are unchanged.
 */
function countStatements(
  db: DatabaseSync,
  written: (rows: number) => void,
): DatabaseSync {
  const prepare = db.prepare.bind(db);
  const exec = db.exec.bind(db);
  db.exec = (sql: string) => {
    count("store.sqlStatements");
    return exec(sql);
  };
  db.prepare = ((sql: string, ...rest: unknown[]) => {
    const statement = (prepare as (...args: unknown[]) => StatementSync)(
      sql,
      ...rest,
    );
    for (const method of ["run", "get", "all", "iterate"] as const) {
      const original = statement[method].bind(statement) as (
        ...args: unknown[]
      ) => unknown;
      (statement as unknown as Record<string, unknown>)[method] =
        method === "run"
          ? (...args: unknown[]) => {
              count("store.sqlStatements");
              const result = original(...args) as { changes: number | bigint };
              written(Number(result.changes));
              return result;
            }
          : (...args: unknown[]) => {
              count("store.sqlStatements");
              return original(...args);
            };
    }
    return statement;
  }) as DatabaseSync["prepare"];
  return db;
}

/**
 * Another graph index run started on the same store and took it over (C-22):
 * this run stopped before writing anything more.
 */
export class GraphIndexTakenOver extends Error {
  /** As MCP and other callers present it: another writer, retry later. */
  readonly code = "concurrent-update";
  readonly retryable = true;
  readonly action =
    "Wait for the other graph index run to finish, then retry if its result is not complete. No complete answer is claimed.";
  constructor() {
    super(
      "Another graph index run started on this store and took it over (or the store changed while this run was reading it); this run stopped without writing more. Run `pymtheg graph index` again if the other run did not finish.",
    );
    this.name = "GraphIndexTakenOver";
  }
}
