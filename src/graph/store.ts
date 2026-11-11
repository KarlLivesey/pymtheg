import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { fileFacts, validateResult } from "./identity.js";
import type {
  GraphStorage,
  GraphFile,
  GraphLink,
  GraphSymbol,
  SymbolQuery,
  LinkResolution,
  Neighbourhood,
} from "./types.js";

export class SqliteGraphStore implements GraphStorage {
  private readonly db: DatabaseSync;
  readonly projectId: string;
  /** projectId is optional on first open (generated UUID); preserve it across machines for the same project. */
  constructor(path: string, projectId?: string) {
    this.db = new DatabaseSync(path);
    try {
      this.db.exec(`PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS graph_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS graph_files (path TEXT PRIMARY KEY, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS graph_symbols (id TEXT PRIMARY KEY, file TEXT NOT NULL REFERENCES graph_files(path) ON DELETE CASCADE, name TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS graph_links (id TEXT PRIMARY KEY, file TEXT NOT NULL REFERENCES graph_files(path) ON DELETE CASCADE, source TEXT REFERENCES graph_symbols(id) ON DELETE CASCADE, target TEXT REFERENCES graph_symbols(id) ON DELETE SET NULL, kind TEXT NOT NULL, body TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS graph_symbol_name ON graph_symbols(name);
        CREATE INDEX IF NOT EXISTS graph_symbol_file ON graph_symbols(file);
        CREATE INDEX IF NOT EXISTS graph_link_source ON graph_links(source,kind);
        CREATE INDEX IF NOT EXISTS graph_link_target ON graph_links(target,kind);`);
      this.db
        .prepare("INSERT OR IGNORE INTO graph_meta VALUES ('schema', '1')")
        .run();
      if (
        this.db.prepare("SELECT value FROM graph_meta WHERE key='schema'").get()
          ?.value !== "1"
      )
        throw Error("Unsupported graph schema");
      this.db
        .prepare("INSERT OR IGNORE INTO graph_meta VALUES ('project', ?)")
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
      .map((row) => JSON.parse(row.body as string) as GraphFile);
  }
  getFile(path: string): GraphFile | undefined {
    const row = this.db
      .prepare("SELECT body FROM graph_files WHERE path=?")
      .get(path);
    return row ? (JSON.parse(row.body as string) as GraphFile) : undefined;
  }
  replaceFile(file: GraphFile): void {
    if (
      !file.path ||
      file.path.startsWith("/") ||
      file.path.includes("\\") ||
      file.path.split("/").some((p) => !p || p === "." || p === "..")
    )
      throw Error("Expected project-relative POSIX path");
    validateResult(file.text, file.result);
    const facts = fileFacts(this.projectId, file);
    this.transaction(() => {
      this.db.prepare("DELETE FROM graph_links WHERE file=?").run(file.path);
      this.db
        .prepare(
          "INSERT INTO graph_files VALUES (?,?) ON CONFLICT(path) DO UPDATE SET body=excluded.body",
        )
        .run(file.path, JSON.stringify(file));
      const symbol = this.db.prepare(
        "INSERT INTO graph_symbols VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,body=excluded.body",
      );
      for (const value of facts.symbols)
        symbol.run(
          value.id,
          file.path,
          value.name,
          value.kind,
          JSON.stringify(value),
        );
      const retained = new Set(facts.symbols.map((symbol) => symbol.id));
      for (const row of this.db
        .prepare("SELECT id FROM graph_symbols WHERE file=?")
        .all(file.path)) {
        if (!retained.has(row.id as string))
          this.db.prepare("DELETE FROM graph_symbols WHERE id=?").run(row.id!);
        else if (file.result.status !== "clean")
          this.db
            .prepare("UPDATE graph_links SET target=NULL WHERE target=?")
            .run(row.id!);
      }
      const link = this.db.prepare(
        "INSERT INTO graph_links VALUES (?,?,?,?,?,?)",
      );
      for (const value of facts.links)
        link.run(
          value.id,
          file.path,
          value.sourceId,
          null,
          value.kind,
          JSON.stringify(value),
        );
    });
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
  private readLinks(where = "", values: string[] = []): GraphLink[] {
    return this.db
      .prepare(`SELECT body,target FROM graph_links ${where} ORDER BY id`)
      .all(...values)
      .map((row) => ({
        ...(JSON.parse(row.body as string) as GraphLink),
        targetId: row.target as string | null,
        resolution: row.target === null ? "unresolved" : "resolved",
      }));
  }
  links(): GraphLink[] {
    return this.readLinks();
  }
  outgoing(id: string, kind?: string): GraphLink[] {
    return this.readLinks(
      `WHERE source=?${kind === undefined ? "" : " AND kind=?"}`,
      kind === undefined ? [id] : [id, kind],
    );
  }
  incoming(id: string, kind?: string): GraphLink[] {
    return this.readLinks(
      `WHERE target=?${kind === undefined ? "" : " AND kind=?"}`,
      kind === undefined ? [id] : [id, kind],
    );
  }
  unresolved(): GraphLink[] {
    return this.readLinks("WHERE target IS NULL");
  }
  resolveLinks(resolutions: readonly LinkResolution[]): void {
    const seen = new Set<string>();
    const links = new Set(this.links().map((link) => link.id));
    const files = new Map(this.files().map((file) => [file.path, file]));
    const targets = new Set(
      this.findSymbols()
        .filter((symbol) => files.get(symbol.file)?.result.status === "clean")
        .map((symbol) => symbol.id),
    );
    for (const item of resolutions) {
      if (
        seen.has(item.linkId) ||
        !links.has(item.linkId) ||
        !targets.has(item.targetId)
      )
        throw Error("Invalid or duplicate link resolution");
      seen.add(item.linkId);
    }
    const desired = new Map(
      resolutions.map((item) => [item.linkId, item.targetId]),
    );
    const changed = this.links().filter(
      (link) => link.targetId !== (desired.get(link.id) ?? null),
    );
    if (!changed.length) return;
    this.transaction(() => {
      const update = this.db.prepare(
        "UPDATE graph_links SET target=? WHERE id=?",
      );
      for (const link of changed)
        update.run(desired.get(link.id) ?? null, link.id);
    });
  }
  neighbourhood(id: string, depth: number, kind?: string): Neighbourhood {
    if (!Number.isInteger(depth) || depth < 0 || depth > 100)
      throw Error("Depth must be an integer from 0 to 100");
    const symbols = new Map(
      this.findSymbols().map((symbol) => [symbol.id, symbol]),
    );
    if (!symbols.has(id)) return { symbols: [], links: [] };
    const visited = new Set([id]);
    const links = new Map<string, GraphLink>();
    let frontier = [id];
    for (let level = 0; level < depth && frontier.length; level++) {
      const next: string[] = [];
      for (const current of frontier)
        for (const link of [
          ...this.outgoing(current, kind),
          ...this.incoming(current, kind),
        ]) {
          links.set(link.id, link);
          for (const endpoint of [link.sourceId, link.targetId])
            if (endpoint !== null && !visited.has(endpoint)) {
              visited.add(endpoint);
              next.push(endpoint);
            }
        }
      frontier = next;
    }
    return {
      symbols: [...visited].sort().map((key) => symbols.get(key)!),
      links: [...links.values()].sort((a, b) => a.id.localeCompare(b.id)),
    };
  }
  close(): void {
    this.db.close();
  }
}
