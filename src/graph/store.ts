// SPDX-License-Identifier: MIT
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { openDatabase } from "../storage/local.js";
import { randomUUID } from "node:crypto";
import { compare, fileFacts, validateResult } from "./identity.js";
import { LinkDecider, resolutionFacts } from "./analysis.js";
import type {
  ContextFile,
  GraphStorage,
  FailedFile,
  GraphFile,
  GraphLink,
  GraphSymbol,
  SymbolQuery,
  LinkResolution,
  Neighbourhood,
  ResolutionResult,
} from "./types.js";

export class SqliteGraphStore implements GraphStorage {
  private readonly db: DatabaseSync;
  readonly projectId: string;
  /** Every read decodes fresh records from storage; nothing is shared or cached. */
  readonly independentReads = true as const;
  private readonly decodedContexts = new Map<string, ContextFile>();
  /** " INDEXED BY graph_file_status" when that covering index exists, else "".
   * Link reads join graph_files only for status, which is stored after the whole
   * file body; without the covering index SQLite walks every body's overflow pages.
   * The planner does not choose the index on its own, so link reads name it.
   * Read-only opens of a graph written before the index existed keep the plain plan. */
  private fileStatusIndex = "";
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
    return JSON.parse(body) as GraphFile;
  }
  constructor(
    path: string,
    projectId?: string,
    options: { readOnly?: boolean } = {},
  ) {
    this.db = openDatabase(path, { readOnly: options.readOnly ?? false });
    try {
      if (options.readOnly) {
        if (
          this.db
            .prepare("SELECT value FROM graph_meta WHERE key='schema'")
            .get()?.value !== "3"
        )
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
        return;
      }
      this.db.exec(`PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS graph_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
      this.db
        .prepare("INSERT OR IGNORE INTO graph_meta VALUES ('schema','3')")
        .run();
      if (
        this.db.prepare("SELECT value FROM graph_meta WHERE key='schema'").get()
          ?.value !== "3"
      )
        throw Error("Unsupported graph schema; rebuild the index");
      this.db
        .exec(`CREATE TABLE IF NOT EXISTS graph_files(path TEXT PRIMARY KEY,body TEXT NOT NULL,status TEXT NOT NULL);
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
        CREATE TRIGGER IF NOT EXISTS graph_target_changed AFTER UPDATE OF target ON graph_links
        WHEN OLD.target IS NOT NEW.target BEGIN
          UPDATE graph_links SET resolution=CASE WHEN NEW.target IS NOT NULL THEN 'resolved'
            WHEN EXISTS(SELECT 1 FROM graph_candidates WHERE link=NEW.id) THEN 'ambiguous' ELSE 'unresolved' END WHERE id=NEW.id;
        END;
        CREATE TRIGGER IF NOT EXISTS graph_candidate_added AFTER INSERT ON graph_candidates BEGIN
          UPDATE graph_links SET resolution='ambiguous' WHERE id=NEW.link AND target IS NULL AND resolution!='ambiguous';
        END;
        CREATE TRIGGER IF NOT EXISTS graph_candidate_removed AFTER DELETE ON graph_candidates BEGIN
          UPDATE graph_links SET resolution=CASE WHEN target IS NOT NULL THEN 'resolved'
            WHEN EXISTS(SELECT 1 FROM graph_candidates WHERE link=OLD.link) THEN 'ambiguous' ELSE 'unresolved' END
            WHERE id=OLD.link AND resolution IS NOT CASE WHEN target IS NOT NULL THEN 'resolved'
            WHEN EXISTS(SELECT 1 FROM graph_candidates WHERE link=OLD.link) THEN 'ambiguous' ELSE 'unresolved' END;
        END;
        CREATE INDEX IF NOT EXISTS graph_link_source ON graph_links(source,kind);
        CREATE INDEX IF NOT EXISTS graph_link_target ON graph_links(target,kind);
        CREATE INDEX IF NOT EXISTS graph_file_status ON graph_files(path,status);`);
      this.findFileStatusIndex();
      // Path-only markers from early W2-M builds have unknown provenance. Adding
      // nullable columns makes them cache misses until a successful parse stamps them.
      const markerColumns = new Set(
        this.db
          .prepare("PRAGMA table_info(graph_parse_failures)")
          .all()
          .map((row) => row.name),
      );
      if (
        ["hash", "module", "version"].some((name) => !markerColumns.has(name))
      )
        this.transaction(() => {
          for (const name of ["hash", "module", "version"])
            if (!markerColumns.has(name))
              this.db.exec(
                `ALTER TABLE graph_parse_failures ADD COLUMN ${name} TEXT`,
              );
        });
      // Completion belongs to this database and is invalidated even by other API writers.
      for (const table of [
        "graph_files",
        "graph_contexts",
        "graph_symbols",
        "graph_links",
        "graph_candidates",
        "graph_parse_failures",
      ])
        for (const event of ["INSERT", "UPDATE", "DELETE"])
          this.db
            .exec(`CREATE TRIGGER IF NOT EXISTS graph_command_dirty_${table}_${event}
            AFTER ${event} ON ${table}
            WHEN EXISTS(SELECT 1 FROM graph_meta WHERE key='command-complete') BEGIN
              DELETE FROM graph_meta WHERE key='command-complete'; END;`);
      this.db
        .prepare("INSERT OR IGNORE INTO graph_meta VALUES ('project',?)")
        .run(projectId ?? randomUUID());
      this.projectId = this.db
        .prepare("SELECT value FROM graph_meta WHERE key='project'")
        .get()!.value as string;
      if (projectId !== undefined && projectId !== this.projectId)
        throw Error("Graph belongs to a different project");
    } catch (error) {
      this.db.close();
      throw error;
    }
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
  private transaction(action: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      action();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
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
  /** Path, module and status of every stored file, without decoding records. */
  fileSummaries(): {
    path: string;
    module: string;
    status: GraphFile["result"]["status"];
  }[] {
    return this.db
      .prepare(
        "SELECT path,json_extract(body,'$.module') AS module,status FROM graph_files ORDER BY path",
      )
      .all()
      .map((row) => ({
        path: row.path as string,
        module: row.module as string,
        status: row.status as GraphFile["result"]["status"],
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
    const facts = fileFacts(this.projectId, file);
    const sql = this.writer();
    this.transaction(() => {
      sql("DELETE FROM graph_links WHERE file=?").run(file.path);
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
  private insertLink(
    link: GraphLink,
    sql: (sql: string) => StatementSync,
  ): void {
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
  }
  removeFile(path: string): void {
    this.db.prepare("DELETE FROM graph_files WHERE path=?").run(path);
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
  private selectLinks(
    where = "",
    values: string[] = [],
    limit?: number,
  ): GraphLink[] {
    return this.db
      .prepare(
        `SELECT l.body,l.target,f.status AS sourceStatus,tf.status AS targetStatus,
      (SELECT json_group_array(json_object('id',id,'status',status)) FROM
        (SELECT c.symbol AS id,cf.status AS status FROM graph_candidates c
         JOIN graph_symbols cs ON cs.id=c.symbol JOIN graph_files cf${this.fileStatusIndex} ON cf.path=cs.file
         WHERE c.link=l.id ORDER BY c.symbol)) AS candidates
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
        return {
          ...link,
          targetId,
          targetStatus: (row.targetStatus ?? null) as GraphLink["targetStatus"],
          sourceStatus: row.sourceStatus as GraphLink["sourceStatus"],
          candidates,
          resolution: targetId
            ? "resolved"
            : candidates.length
              ? "ambiguous"
              : "unresolved",
        };
      });
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
  private writeTargets(
    current: readonly GraphLink[],
    desired: readonly GraphLink[],
    sql: (sql: string) => StatementSync,
  ): void {
    const byId = new Map(current.map((link) => [link.id, link]));
    for (const link of desired) {
      const before = byId.get(link.id);
      if (
        before?.targetId === link.targetId &&
        JSON.stringify(before.candidates.map((item) => item.id)) ===
          JSON.stringify(link.candidates.map((item) => item.id))
      )
        continue;
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
    }
  }
  resolveLinks(resolutions: readonly LinkResolution[]): void {
    const current = this.links();
    const decider = new LinkDecider(this.findSymbols());
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
    if (!sameLinks(current, desired))
      this.transaction(() =>
        this.writeTargets(current, desired, this.writer()),
      );
  }
  replaceAnalysis(module: string, result: ResolutionResult): void {
    const current = this.selectLinks("l.module=?", [module]);
    const sql = this.writer();
    const desired = resolutionFacts(
      this.projectId,
      module,
      result,
      (path) => {
        const row = sql("SELECT body FROM graph_files WHERE path=?").get(path);
        return row ? this.decodeFile(row.body as string) : undefined;
      },
      this.findSymbols(),
      current,
    );
    if (sameLinks(current, desired)) return;
    this.transaction(() => {
      const wanted = new Map(desired.map((link) => [link.id, link]));
      const previous = new Map(current.map((link) => [link.id, link]));
      for (const link of current)
        if (
          link.origin === "analysis" &&
          (!wanted.has(link.id) ||
            JSON.stringify(link) !== JSON.stringify(wanted.get(link.id)))
        )
          sql("DELETE FROM graph_links WHERE id=?").run(link.id);
      for (const link of desired)
        if (
          link.origin === "analysis" &&
          JSON.stringify(previous.get(link.id)) !== JSON.stringify(link)
        )
          this.insertLink(link, sql);
      this.writeTargets(
        current,
        desired.filter((link) => link.origin === "parse"),
        sql,
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
      const row = this.db
        .prepare("SELECT value FROM graph_meta WHERE key='command-complete'")
        .get();
      return row ? JSON.parse(row.value as string) : null;
    } catch {
      return null;
    }
  }
  invalidateGraphCommandState(): void {
    this.db
      .prepare("DELETE FROM graph_meta WHERE key='command-complete'")
      .run();
  }
  commandDataVersion(): number {
    return Number(this.db.prepare("PRAGMA data_version").get()!.data_version);
  }
  completeGraphCommandState(state: unknown, expectedVersion?: number): boolean {
    let written = false;
    // Lock publication so another connection cannot commit between validation and publication.
    this.transaction(() => {
      if (
        expectedVersion !== undefined &&
        this.commandDataVersion() !== expectedVersion
      )
        return;
      this.db
        .prepare(
          "INSERT INTO graph_meta VALUES ('command-complete',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(JSON.stringify(state));
      written = true;
    });
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
      json_extract(body,'$.status') AS status,json_extract(body,'$.diagnostics[0]') AS diagnostic
      FROM graph_contexts ORDER BY path`,
      )
      .all()
      .map((row) => ({
        path: row.path as string,
        hash: row.hash as string,
        status: row.status as ContextFile["status"],
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
    return {
      files: count("graph_files"),
      symbols: count("graph_symbols"),
      links: count("graph_links"),
      failed: count("graph_files", "WHERE status='failed'"),
      partial: count("graph_files", "WHERE status='partial'"),
      unresolved: count("graph_links", "WHERE resolution='unresolved'"),
      ambiguous: count("graph_links", "WHERE resolution='ambiguous'"),
    };
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
      ORDER BY CASE WHEN ${name}=${needle} OR ${identity}=${needle} THEN 0
        WHEN instr(${name},${needle})=1 OR instr(${identity},${needle})=1 THEN 1 ELSE 2 END,
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
        "SELECT body FROM graph_symbols WHERE name=? OR json_extract(body,'$.identity')=? ORDER BY file,id LIMIT ?",
      )
      .all(name, name, limit)
      .map((row) => JSON.parse(row.body as string) as GraphSymbol);
  }
  symbolsForFile(path: string, limit: number): GraphSymbol[] {
    this.queryLimit(limit);
    return this.db
      .prepare(
        "SELECT body FROM graph_symbols WHERE file=? ORDER BY id LIMIT ?",
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
    this.db.close();
  }
}

/** Compare one persisted row at a time: never allocate a module-sized JSON string. */
function sameLinks(a: readonly GraphLink[], b: readonly GraphLink[]): boolean {
  return (
    a.length === b.length &&
    a.every((link, i) => JSON.stringify(link) === JSON.stringify(b[i]))
  );
}
