import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { compare, fileFacts, validateResult } from "./identity.js";
import { decideLink, resolutionFacts } from "./analysis.js";
import type {
  ContextFile,
  GraphStorage,
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
  constructor(path: string, projectId?: string) {
    this.db = new DatabaseSync(path);
    try {
      this.db.exec(`PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS graph_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
      this.db
        .prepare("INSERT OR IGNORE INTO graph_meta VALUES ('schema','2')")
        .run();
      if (
        this.db.prepare("SELECT value FROM graph_meta WHERE key='schema'").get()
          ?.value !== "2"
      )
        throw Error("Unsupported graph schema; rebuild the index");
      this.db
        .exec(`CREATE TABLE IF NOT EXISTS graph_files(path TEXT PRIMARY KEY,body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS graph_contexts(path TEXT PRIMARY KEY,body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS graph_symbols(id TEXT PRIMARY KEY,file TEXT NOT NULL REFERENCES graph_files(path) ON DELETE CASCADE,name TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS graph_links(id TEXT PRIMARY KEY,file TEXT NOT NULL REFERENCES graph_files(path) ON DELETE CASCADE,source TEXT REFERENCES graph_symbols(id) ON DELETE CASCADE,target TEXT REFERENCES graph_symbols(id) ON DELETE SET NULL,kind TEXT NOT NULL,body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS graph_candidates(link TEXT NOT NULL REFERENCES graph_links(id) ON DELETE CASCADE,symbol TEXT NOT NULL REFERENCES graph_symbols(id) ON DELETE CASCADE,PRIMARY KEY(link,symbol));
        CREATE INDEX IF NOT EXISTS graph_symbol_name ON graph_symbols(name);
        CREATE INDEX IF NOT EXISTS graph_symbol_file ON graph_symbols(file);
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
      .map((row) => JSON.parse(row.body as string) as GraphFile)
      .sort((a, b) => compare(a.path, b.path));
  }
  getFile(path: string): GraphFile | undefined {
    const row = this.db
      .prepare("SELECT body FROM graph_files WHERE path=?")
      .get(path);
    return row ? (JSON.parse(row.body as string) as GraphFile) : undefined;
  }
  contexts(): ContextFile[] {
    return this.db
      .prepare("SELECT body FROM graph_contexts ORDER BY path")
      .all()
      .map((row) => JSON.parse(row.body as string) as ContextFile)
      .sort((a, b) => compare(a.path, b.path));
  }
  replaceContexts(files: readonly ContextFile[]): void {
    const sorted = [...files].sort((a, b) => compare(a.path, b.path));
    if (JSON.stringify(this.contexts()) === JSON.stringify(sorted)) return;
    this.transaction(() => {
      this.db.exec("DELETE FROM graph_contexts");
      const insert = this.db.prepare("INSERT INTO graph_contexts VALUES (?,?)");
      for (const file of sorted) insert.run(file.path, JSON.stringify(file));
    });
  }
  replaceFile(file: GraphFile): void {
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
          "INSERT INTO graph_files VALUES (?,?) ON CONFLICT(path) DO UPDATE SET body=excluded.body",
        )
        .run(file.path, JSON.stringify(file));
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
      .prepare("INSERT INTO graph_links VALUES (?,?,?,?,?,?)")
      .run(
        link.id,
        link.file,
        link.sourceId,
        link.targetId,
        link.kind,
        JSON.stringify(link),
      );
    for (const candidate of link.candidates)
      this.db
        .prepare("INSERT INTO graph_candidates VALUES (?,?)")
        .run(link.id, candidate.id);
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
    const statuses = new Map(
      this.files().map((file) => [file.path, file.result.status]),
    );
    return this.db
      .prepare(
        `SELECT body FROM graph_symbols ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY id`,
      )
      .all(...values)
      .map((row) => {
        const symbol = JSON.parse(row.body as string) as GraphSymbol;
        return { ...symbol, status: statuses.get(symbol.file)! };
      });
  }
  links(): GraphLink[] {
    const symbols = new Map(
      this.findSymbols().map((symbol) => [symbol.id, symbol]),
    );
    const statuses = new Map(
      this.files().map((file) => [file.path, file.result.status]),
    );
    const candidates = new Map<string, string[]>();
    for (const row of this.db
      .prepare("SELECT link,symbol FROM graph_candidates ORDER BY link,symbol")
      .all()) {
      const values = candidates.get(row.link as string) ?? [];
      values.push(row.symbol as string);
      candidates.set(row.link as string, values);
    }
    return this.db
      .prepare("SELECT body,target FROM graph_links ORDER BY id")
      .all()
      .map((row) => {
        const link = JSON.parse(row.body as string) as GraphLink;
        const options = (candidates.get(link.id) ?? []).map((id) => ({
          id,
          status: symbols.get(id)!.status,
        }));
        const targetId = row.target as string | null;
        return {
          ...link,
          targetId,
          targetStatus: targetId ? symbols.get(targetId)!.status : null,
          sourceStatus: statuses.get(link.file)!,
          candidates: options,
          resolution: targetId
            ? "resolved"
            : options.length
              ? "ambiguous"
              : "unresolved",
        };
      });
  }
  outgoing(id: string, kind?: string): GraphLink[] {
    return this.links().filter(
      (link) =>
        link.sourceId === id && (kind === undefined || link.kind === kind),
    );
  }
  incoming(id: string, kind?: string): GraphLink[] {
    return this.links().filter(
      (link) =>
        (link.targetId === id ||
          link.candidates.some((candidate) => candidate.id === id)) &&
        (kind === undefined || link.kind === kind),
    );
  }
  unresolved(): GraphLink[] {
    return this.links().filter((link) => link.resolution === "unresolved");
  }
  ambiguous(): GraphLink[] {
    return this.links().filter((link) => link.resolution === "ambiguous");
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
          .prepare("INSERT INTO graph_candidates VALUES (?,?)")
          .run(link.id, candidate.id);
    }
  }
  resolveLinks(resolutions: readonly LinkResolution[]): void {
    const current = this.links();
    const symbols = this.findSymbols();
    const decisions = new Map<string, LinkResolution>();
    for (const item of resolutions) {
      if (
        decisions.has(item.linkId) ||
        !current.some((link) => link.id === item.linkId)
      )
        throw Error("Invalid or duplicate link resolution");
      decisions.set(item.linkId, item);
    }
    const desired = current.map((link) =>
      decideLink(link, decisions.get(link.id), symbols),
    );
    if (JSON.stringify(current) !== JSON.stringify(desired))
      this.transaction(() => this.writeTargets(current, desired));
  }
  replaceAnalysis(module: string, result: ResolutionResult): void {
    const current = this.links().filter((link) => link.module === module);
    const desired = resolutionFacts(
      this.projectId,
      module,
      result,
      this.files(),
      this.findSymbols(),
      current,
    );
    if (JSON.stringify(current) === JSON.stringify(desired)) return;
    this.transaction(() => {
      const wanted = new Map(desired.map((link) => [link.id, link]));
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
          !current.some(
            (old) =>
              old.id === link.id &&
              JSON.stringify(old) === JSON.stringify(link),
          )
        )
          this.insertLink(link);
      this.writeTargets(current, desired);
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
      symbols: [...visited].sort(compare).map((key) => symbols.get(key)!),
      links: [...links.values()].sort((a, b) => compare(a.id, b.id)),
    };
  }
  close(): void {
    this.db.close();
  }
}
