import type { DatabaseSync } from "node:sqlite";
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
  private readonly decodedFiles = new Map<
    string,
    { body: string; file: GraphFile }
  >();
  private readonly fileBodies = new Map<string, string>();
  private readonly decodedContexts = new Map<string, ContextFile>();
  private decodeFile(body: string): GraphFile {
    const parsed = this.decodedFiles.get(body);
    if (parsed) return structuredClone(parsed.file);
    const file = JSON.parse(body) as GraphFile;
    // Only the current captured record for a path is retained.
    const previous = this.fileBodies.get(file.path);
    if (previous !== undefined) this.decodedFiles.delete(previous);
    this.fileBodies.set(file.path, body);
    this.decodedFiles.set(body, { body, file });
    return structuredClone(file);
  }
  constructor(path: string, projectId?: string) {
    this.db = openDatabase(path);
    try {
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
        CREATE TABLE IF NOT EXISTS graph_parse_failures(path TEXT PRIMARY KEY REFERENCES graph_files(path) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS graph_contexts(path TEXT PRIMARY KEY,body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS graph_symbols(id TEXT PRIMARY KEY,file TEXT NOT NULL REFERENCES graph_files(path) ON DELETE CASCADE,name TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS graph_links(id TEXT PRIMARY KEY,file TEXT NOT NULL REFERENCES graph_files(path) ON DELETE CASCADE,source TEXT REFERENCES graph_symbols(id) ON DELETE CASCADE,target TEXT REFERENCES graph_symbols(id) ON DELETE SET NULL,kind TEXT NOT NULL,body TEXT NOT NULL,module TEXT NOT NULL,origin TEXT NOT NULL,resolution TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS graph_candidates(link TEXT NOT NULL REFERENCES graph_links(id) ON DELETE CASCADE,symbol TEXT NOT NULL REFERENCES graph_symbols(id) ON DELETE CASCADE,kind TEXT NOT NULL,PRIMARY KEY(link,symbol));
        CREATE INDEX IF NOT EXISTS graph_symbol_name ON graph_symbols(name,id);
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
        CREATE INDEX IF NOT EXISTS graph_link_target ON graph_links(target,kind);`);
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
    return this.db
      .prepare("SELECT body FROM graph_files ORDER BY path")
      .all()
      .map((row) => this.decodeFile(row.body as string))
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
      .prepare("SELECT path FROM graph_parse_failures WHERE path=?")
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
    this.transaction(() => {
      this.db.prepare("DELETE FROM graph_links WHERE file=?").run(file.path);
      this.db
        .prepare(
          "INSERT INTO graph_files VALUES (?,?,?) ON CONFLICT(path) DO UPDATE SET body=excluded.body,status=excluded.status",
        )
        .run(file.path, JSON.stringify(file), file.result.status);
      this.db
        .prepare("DELETE FROM graph_parse_failures WHERE path=?")
        .run(file.path);
      if (
        parseFailure &&
        file.result.status === "failed" &&
        file.result.failureKind !== "transient"
      )
        this.db
          .prepare("INSERT INTO graph_parse_failures VALUES (?)")
          .run(file.path);
      const insert = this.db.prepare(
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
      for (const row of this.db
        .prepare("SELECT id FROM graph_symbols WHERE file=?")
        .all(file.path))
        if (!retained.has(row.id as string))
          this.db.prepare("DELETE FROM graph_symbols WHERE id=?").run(row.id!);
      if (file.result.status === "failed")
        for (const symbol of facts.symbols) {
          this.db
            .prepare("UPDATE graph_links SET target=NULL WHERE target=?")
            .run(symbol.id);
          this.db
            .prepare("DELETE FROM graph_candidates WHERE symbol=?")
            .run(symbol.id);
        }
      for (const link of facts.links) this.insertLink(link);
    });
  }
  private insertLink(link: GraphLink): void {
    this.db
      .prepare("INSERT INTO graph_links VALUES (?,?,?,?,?,?,?,?,?)")
      .run(
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
      this.db
        .prepare("INSERT INTO graph_candidates VALUES (?,?,?)")
        .run(link.id, candidate.id, link.kind);
  }
  removeFile(path: string): void {
    this.db.prepare("DELETE FROM graph_files WHERE path=?").run(path);
    const body = this.fileBodies.get(path);
    if (body !== undefined) this.decodedFiles.delete(body);
    this.fileBodies.delete(path);
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
  private selectLinks(where = "", values: string[] = []): GraphLink[] {
    return this.db
      .prepare(
        `SELECT l.body,l.target,f.status AS sourceStatus,tf.status AS targetStatus,
      (SELECT json_group_array(json_object('id',id,'status',status)) FROM
        (SELECT c.symbol AS id,cf.status AS status FROM graph_candidates c
         JOIN graph_symbols cs ON cs.id=c.symbol JOIN graph_files cf ON cf.path=cs.file
         WHERE c.link=l.id ORDER BY c.symbol)) AS candidates
      FROM graph_links l JOIN graph_files f ON f.path=l.file
      LEFT JOIN graph_symbols ts ON ts.id=l.target LEFT JOIN graph_files tf ON tf.path=ts.file
      ${where ? `WHERE ${where}` : ""} ORDER BY l.id`,
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
      this.db
        .prepare("UPDATE graph_links SET target=? WHERE id=?")
        .run(link.targetId, link.id);
      this.db.prepare("DELETE FROM graph_candidates WHERE link=?").run(link.id);
      for (const candidate of link.candidates)
        this.db
          .prepare("INSERT INTO graph_candidates VALUES (?,?,?)")
          .run(link.id, candidate.id, link.kind);
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
      this.transaction(() => this.writeTargets(current, desired));
  }
  replaceAnalysis(module: string, result: ResolutionResult): void {
    const current = this.selectLinks("l.module=?", [module]);
    const desired = resolutionFacts(
      this.projectId,
      module,
      result,
      this.files(),
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
          this.db.prepare("DELETE FROM graph_links WHERE id=?").run(link.id);
      for (const link of desired)
        if (
          link.origin === "analysis" &&
          JSON.stringify(previous.get(link.id)) !== JSON.stringify(link)
        )
          this.insertLink(link);
      this.writeTargets(
        current,
        desired.filter((link) => link.origin === "parse"),
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
