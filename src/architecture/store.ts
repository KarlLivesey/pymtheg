// SPDX-License-Identifier: MIT
import { sharedSourceLabel, sharedProjectPath } from "../storage/paths.js";
import {
  RecordedHistory,
  initializeRecordedHistory,
  exportRecordedHistory,
  recordedHistoryBytes,
  type HistoryWriter,
} from "../storage/recorded-history.js";
import { localHistoryWriter } from "../storage/writer.js";
import { storageDirectory, openDatabase } from "../storage/local.js";
import {
  acknowledgementSchema,
  mergeAcknowledgement,
  withdrawalEvents,
  type Acknowledgement,
} from "./acknowledgements.js";
import { compareText } from "../shared/order.js";
import { revisionSchema as importRevisionSchema } from "./schema.js";
import { branchReview } from "./branches.js";
import { architectureLimits } from "./limits.js";
import {
  validateHistory,
  documentSetHash,
  validateParentGraph,
  historySchema,
} from "./history.js";
import { indexInWorker } from "./runner.js";
import { ArchitectureConflict } from "./import-merge.js";
import {
  excludedDirectory,
  documentSkipReason,
  recordSkipped,
  skippedDocuments,
  type DocumentSelection,
} from "./import-policy.js";
import { decodeUtf8 } from "../shared/text.js";
import {
  architectureDraftSchema,
  architectureDraftViewSchema,
} from "./draft.js";
import {
  mkdir,
  realpath,
  lstat,
  chmod,
  readFile,
  readdir,
  stat,
  mkdtemp,
  writeFile,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { hash } from "../shared/identity.js";
import { resolve, join, relative } from "node:path";
import type { DatabaseSync as Database } from "node:sqlite";
import {
  architectureIndexVersion,
  indexArchitecture,
  indexSchema,
  documentSchema,
  type ArchitectureDocument,
  type ArchitectureIndex,
} from "./model.js";
const checkpointStorageBytes = (
  label: string,
  source: string,
  created: string,
  id: string,
  snapshot: string,
) =>
  Buffer.byteLength(label + source + created + id + snapshot) +
  Buffer.byteLength(id) +
  8;
const legacyAcknowledgement = (
  tip: string,
  against: string,
): Acknowledgement => ({
  id: hash("legacy-review:" + tip + ":" + against),
  against,
});

export class ArchitectureStore {
  private recorded?: RecordedHistory;
  private projectRoot = "";
  private closed = false;
  private readAbort = new AbortController();
  private readTasks = new Set<Promise<ArchitectureIndex | null>>();
  private cache = new Map<string, ArchitectureIndex>();
  private constructor(
    private db: Database,
    private readOnly = false,
    private snapshotDirectory?: string,
    private snapshotSource?: { path: string; hash: string },
    private storageVersion = 7,
  ) {}
  static async open(
    root: string,
    options: { readOnly?: boolean; writer?: HistoryWriter } = {},
  ) {
    const dir = storageDirectory(root, "planning", !options.readOnly);
    if (!options.readOnly)
      await mkdir(dir, { mode: 0o700, recursive: false }).catch((e) => {
        if (e.code !== "EEXIST") throw e;
      });
    if ((await realpath(dir)) !== dir)
      throw Error("Architecture storage cannot be a symbolic link");
    if (!options.readOnly) await chmod(dir, 0o700);
    const file = join(dir, "architecture.sqlite");
    for (const path of [file, file + "-wal", file + "-shm"])
      try {
        const s = await lstat(path);
        if (!s.isFile() || s.isSymbolicLink())
          throw Error("Architecture storage must contain regular files");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    let databaseFile = file,
      snapshotDirectory: string | undefined,
      snapshotSource: { path: string; hash: string } | undefined;
    // Closed WAL-format backups need sidecars even for ordinary read-only opens.
    // Freeze those bytes in our own temporary workspace, never mutate the backup.
    if (options.readOnly) {
      const header = await readFile(file);
      if (header[18] === 2) {
        try {
          if ((await stat(file + "-wal")).size > 0)
            throw Error(
              "Legacy architecture has an active WAL journal. Close its writer and checkpoint it before opening this backup read-only.",
            );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        snapshotDirectory = await mkdtemp(
          join(tmpdir(), "pym-architecture-read-"),
        );
        const copy = join(snapshotDirectory, "snapshot.sqlite");
        try {
          await writeFile(copy, header, { mode: 0o600 });
        } catch (error) {
          rmSync(snapshotDirectory, { recursive: true, force: true });
          throw error;
        }
        databaseFile = "file:" + copy + "?immutable=1";
        snapshotSource = {
          path: file,
          hash: createHash("sha256").update(header).digest("hex"),
        };
      }
    }
    const db = openDatabase(databaseFile, {
      readOnly: options.readOnly ?? false,
    });
    try {
      db.function("pym_lower", { deterministic: true }, (value) =>
        typeof value === "string" ? value.toLowerCase() : null,
      );
      const version = db.prepare("PRAGMA user_version").get()?.user_version;
      if (
        version !== 0 &&
        version !== 1 &&
        version !== 2 &&
        version !== 3 &&
        version !== 4 &&
        version !== 5 &&
        version !== 6 &&
        version !== 7
      )
        throw Error("Unsupported architecture storage version");
      if (options.readOnly)
        return new ArchitectureStore(
          db,
          true,
          snapshotDirectory,
          snapshotSource,
          Number(version),
        );
      db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;");
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(
          "CREATE TABLE IF NOT EXISTS revisions (id TEXT PRIMARY KEY,label TEXT NOT NULL,created TEXT NOT NULL,source TEXT NOT NULL,index_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY,text TEXT NOT NULL); CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);",
        );
        if (version === 1) {
          db.exec(
            "INSERT OR IGNORE INTO blobs SELECT hash,text FROM documents; ALTER TABLE documents RENAME TO legacy_documents; CREATE TABLE documents (revision TEXT NOT NULL,path TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(revision,path)); INSERT INTO documents SELECT revision,path,hash FROM legacy_documents; DROP TABLE legacy_documents;",
          );
        } else
          db.exec(
            "CREATE TABLE IF NOT EXISTS documents (revision TEXT NOT NULL,path TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(revision,path));",
          );
        db.exec(
          "CREATE TABLE IF NOT EXISTS authoring_draft (key TEXT PRIMARY KEY,version INTEGER NOT NULL,json TEXT); CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY,snapshot TEXT NOT NULL REFERENCES revisions(id),label TEXT NOT NULL,created TEXT NOT NULL,source TEXT NOT NULL);",
        );
        if (Number(version) < 3)
          db.exec(
            "INSERT OR IGNORE INTO checkpoints SELECT id,id,label,created,source FROM revisions;",
          );
        db.exec(
          "CREATE TABLE IF NOT EXISTS checkpoint_log (ordinal INTEGER PRIMARY KEY AUTOINCREMENT, checkpoint TEXT NOT NULL UNIQUE REFERENCES checkpoints(id));",
        );
        if (Number(version) < 4) {
          db.exec(
            "INSERT INTO checkpoint_log(checkpoint) SELECT id FROM checkpoints ORDER BY rowid",
          );
          db.exec(
            "UPDATE revisions SET index_json=json_object('indexVersion',0,'id',id)",
          );
        }
        db.exec(
          "CREATE TABLE IF NOT EXISTS checkpoint_parents (checkpoint TEXT PRIMARY KEY REFERENCES checkpoints(id),parent TEXT REFERENCES checkpoints(id));",
        );
        db.exec(
          "CREATE TABLE IF NOT EXISTS checkpoint_reviews (checkpoint TEXT NOT NULL REFERENCES checkpoints(id),against TEXT NOT NULL REFERENCES checkpoints(id),PRIMARY KEY(checkpoint,against));",
        );
        db.exec(
          "CREATE TABLE IF NOT EXISTS acknowledgement_records (id TEXT PRIMARY KEY,checkpoint TEXT NOT NULL REFERENCES checkpoints(id),against TEXT NOT NULL REFERENCES checkpoints(id),record TEXT NOT NULL);",
        );
        if (Number(version) < 7)
          for (const row of db
            .prepare("SELECT checkpoint,against FROM checkpoint_reviews")
            .all()) {
            const record = legacyAcknowledgement(
              String(row.checkpoint),
              String(row.against),
            );
            db.prepare(
              "INSERT OR IGNORE INTO acknowledgement_records VALUES(?,?,?,?)",
            ).run(
              record.id,
              String(row.checkpoint),
              String(row.against),
              JSON.stringify(record),
            );
          }
        initializeRecordedHistory(db);
        // R1-D: additive shared table for planning-record → code-symbol links.
        db.exec(
          "CREATE TABLE IF NOT EXISTS code_links (id TEXT PRIMARY KEY,key TEXT NOT NULL,body TEXT NOT NULL,removed INTEGER NOT NULL DEFAULT 0);",
        );
        db.exec("PRAGMA user_version=7; COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      await chmod(file, 0o600);
      const store = new ArchitectureStore(db);
      store.projectRoot = root;
      store.recorded = new RecordedHistory(
        db,
        options.writer ?? localHistoryWriter(root),
        () => {
          if (store.retainedBytes() > architectureLimits.retainedBytes)
            throw Error("Recorded history exceeds retained-content quota");
        },
      );
      return store;
    } catch (e) {
      db.close();
      if (snapshotDirectory)
        rmSync(snapshotDirectory, { recursive: true, force: true });
      throw e;
    }
  }
  async snapshotChanged() {
    if (!this.snapshotSource) return false;
    try {
      if ((await stat(this.snapshotSource.path + "-wal")).size > 0) return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return (
      createHash("sha256")
        .update(await readFile(this.snapshotSource.path))
        .digest("hex") !== this.snapshotSource.hash
    );
  }
  private version() {
    return Number(
      this.db.prepare("PRAGMA user_version").get()?.user_version ??
        this.storageVersion,
    );
  }
  private snapshotId(id: string): string | null {
    if (this.version() < 3) return id;
    const value = this.db
      .prepare("SELECT snapshot FROM checkpoints WHERE id=?")
      .get(id)?.snapshot;
    return typeof value === "string" ? value : null;
  }
  private retainedBytes() {
    return (
      recordedHistoryBytes(this.db) +
      Number(
        this.db
          .prepare(
            "SELECT coalesce(sum(length(CAST(text AS BLOB))),0) AS n FROM blobs",
          )
          .get()?.n ?? 0,
      ) +
      Number(
        this.db
          .prepare(
            "SELECT coalesce(sum(length(CAST(index_json AS BLOB))),0) AS n FROM revisions",
          )
          .get()?.n ?? 0,
      ) +
      Number(
        this.db
          .prepare(
            "SELECT coalesce(sum(length(CAST(label AS BLOB))+length(CAST(source AS BLOB))+length(created)+length(id)+length(snapshot)),0) AS n FROM checkpoints",
          )
          .get()?.n ?? 0,
      ) +
      Number(
        this.db
          .prepare(
            "SELECT coalesce(sum(length(checkpoint)+8),0) AS n FROM checkpoint_log",
          )
          .get()?.n ?? 0,
      ) +
      Number(
        this.db
          .prepare(
            "SELECT coalesce(sum(length(checkpoint)+length(against)),0) AS n FROM checkpoint_reviews",
          )
          .get()?.n ?? 0,
      ) +
      Number(
        this.db
          .prepare(
            "SELECT coalesce(sum(length(checkpoint)+coalesce(length(parent),0)),0) AS n FROM checkpoint_parents",
          )
          .get()?.n ?? 0,
      ) +
      (this.version() >= 7
        ? Number(
            this.db
              .prepare(
                "SELECT coalesce(sum(length(CAST(record AS BLOB))+length(id)+length(checkpoint)+length(against)),0) AS n FROM acknowledgement_records",
              )
              .get()?.n ?? 0,
          )
        : 0)
    );
  }
  /** Read-only byte accounting using the same blob identity as save. */
  contentStorage(documents: readonly ArchitectureDocument[]) {
    const exists = this.db.prepare("SELECT hash FROM blobs WHERE hash=?");
    const unique = new Map(documents.map((d) => [hash(d.text), d.text]));
    let newBytes = 0,
      reusedBytes = 0,
      newParts = 0,
      reusedParts = 0;
    for (const [key, text] of unique) {
      const bytes = Buffer.byteLength(text);
      if (exists.get(key)) {
        reusedBytes += bytes;
        reusedParts++;
      } else {
        newBytes += bytes;
        newParts++;
      }
    }
    return { newBytes, reusedBytes, newParts, reusedParts };
  }
  save(
    label: string,
    source: string,
    documents: ArchitectureDocument[],
    prepared?: ArchitectureIndex,
    expectedRevision?: string | null,
    options: { skipUnchanged?: boolean } = {},
  ) {
    if (this.readOnly)
      throw new ArchitectureConflict("This architecture is open read-only.");
    if (!label.trim() || label.length > 160)
      throw Error("Choose a revision name of 1–160 characters");
    source = sharedSourceLabel(this.projectRoot, source);
    for (const document of documents)
      if (sharedProjectPath(this.projectRoot, document.path) !== document.path)
        throw Error("Use project-relative shared document paths");
    const supplied = prepared ?? indexArchitecture(documents);
    let snapshotId = supplied.snapshotHash ?? supplied.id;
    const { snapshotHash: discarded, ...snapshotFields } = supplied;
    const index = { ...snapshotFields, id: snapshotId };
    // The source documents are authoritative. Persist a tiny rebuild marker,
    // not another multi-megabyte derived projection for every small edit.
    const hashes = new Map(index.documents.map((d) => [d.path, d.hash]));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const active =
        this.db.prepare("SELECT value FROM meta WHERE key='active'").get()
          ?.value ?? null;
      if (expectedRevision !== undefined && active !== expectedRevision)
        throw new ArchitectureConflict(
          "The current architecture changed since this operation began. This operation did not replace the saved version. Refresh the current revision before retrying.",
        );
      if (typeof active === "string") {
        const current = this.db
          .prepare("SELECT snapshot FROM checkpoints WHERE id=?")
          .get(active)?.snapshot;
        if (typeof current === "string" && current !== snapshotId) {
          const previous = this.db
            .prepare("SELECT path,hash FROM documents WHERE revision=?")
            .all(current)
            .map((d) => ({ path: String(d.path), hash: String(d.hash) }));
          if (documentSetHash(previous) === documentSetHash(index.documents)) {
            snapshotId = current;
            index.id = current;
          }
        }
        if (options.skipUnchanged && current === snapshotId) {
          this.db.exec("COMMIT");
          return this.presentIndex(
            active,
            snapshotId,
            index,
            documentSetHash(index.documents),
          );
        }
      }
      if (
        Number(
          this.db.prepare("SELECT count(*) AS n FROM checkpoints").get()?.n ??
            0,
        ) >= architectureLimits.maxRevisions
      )
        throw Error(
          "Architecture has 10,000 retained checkpoints. Existing history was preserved.",
        );
      const projectionMarker = JSON.stringify({
        indexVersion: 0,
        id: snapshotId,
        contentHash: documentSetHash(index.documents),
      });
      const existing = this.db
        .prepare("SELECT id FROM revisions WHERE id=?")
        .get(snapshotId);
      const existingBlob = this.db.prepare(
        "SELECT hash FROM blobs WHERE hash=?",
      );
      const novel = new Map(
        existing
          ? []
          : documents
              .filter((d) => !existingBlob.get(hashes.get(d.path)!))
              .map((d) => [hashes.get(d.path)!, d.text]),
      );
      const created = this.recorded!.now(),
        id = hash("checkpoint:" + randomUUID());
      const additional =
        [...novel.values()].reduce(
          (n, text) => n + Buffer.byteLength(text),
          existing ? 0 : Buffer.byteLength(projectionMarker),
        ) +
        checkpointStorageBytes(label, source, created, id, snapshotId) +
        Buffer.byteLength(id + (active ?? ""));
      if (this.retainedBytes() + additional > architectureLimits.retainedBytes)
        throw Error(
          "Architecture retained-content limit reached (512 MiB). Existing revisions remain readable and exportable; nothing was deleted.",
        );
      if (!existing) {
        const blob = this.db.prepare("INSERT INTO blobs VALUES(?,?)");
        for (const [key, text] of novel) blob.run(key, text);
        this.db
          .prepare("INSERT INTO revisions VALUES(?,?,?,?,?)")
          .run(snapshotId, label, created, source, projectionMarker);
        const put = this.db.prepare("INSERT INTO documents VALUES(?,?,?)");
        for (const document of documents)
          put.run(snapshotId, document.path, hashes.get(document.path)!);
      }
      this.db
        .prepare("INSERT INTO checkpoints VALUES(?,?,?,?,?)")
        .run(id, snapshotId, label, created, source);
      this.db
        .prepare("INSERT INTO checkpoint_log(checkpoint) VALUES(?)")
        .run(id);
      this.db
        .prepare("INSERT INTO checkpoint_parents VALUES(?,?)")
        .run(id, active);
      this.db
        .prepare(
          "INSERT INTO meta VALUES('active',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(id);
      this.recorded!.capture(index, id, created);
      this.db.exec("COMMIT");
      return this.presentIndex(
        id,
        snapshotId,
        index,
        documentSetHash(index.documents),
      );
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  activeRevisionId(): string | null {
    const active = this.db
      .prepare("SELECT value FROM meta WHERE key='active'")
      .get()?.value;
    return typeof active === "string" ? active : null;
  }
  revisions(includeRecords = true) {
    const rows = this.db
      .prepare(
        this.version() >= 5
          ? "SELECT c.id,c.label,c.created,c.source,c.snapshot AS snapshotHash,p.checkpoint AS lineageKnown,p.parent AS parentId FROM checkpoints c JOIN checkpoint_log l ON l.checkpoint=c.id LEFT JOIN checkpoint_parents p ON p.checkpoint=c.id ORDER BY l.ordinal DESC"
          : this.version() >= 4
            ? "SELECT c.id,c.label,c.created,c.source,c.snapshot AS snapshotHash FROM checkpoints c JOIN checkpoint_log l ON l.checkpoint=c.id ORDER BY l.ordinal DESC"
            : this.version() >= 3
              ? "SELECT id,label,created,source,snapshot AS snapshotHash FROM checkpoints ORDER BY rowid DESC"
              : "SELECT id,label,created,source,id AS snapshotHash FROM revisions ORDER BY created DESC,id",
      )
      .all();
    const reviews = new Map<string, string[]>();
    if (this.version() >= 6)
      for (const row of this.db
        .prepare(
          "SELECT checkpoint,against FROM checkpoint_reviews ORDER BY checkpoint,against",
        )
        .all()) {
        const list = reviews.get(String(row.checkpoint)) ?? [];
        list.push(String(row.against));
        reviews.set(String(row.checkpoint), list);
      }
    const records = new Map<string, Acknowledgement[]>();
    if (this.version() >= 7 && includeRecords)
      for (const row of this.db
        .prepare(
          "SELECT checkpoint,record FROM acknowledgement_records ORDER BY id",
        )
        .all()) {
        const list = records.get(String(row.checkpoint)) ?? [];
        list.push(acknowledgementSchema.parse(JSON.parse(String(row.record))));
        records.set(String(row.checkpoint), list);
      }
    const recordCounts = new Map<string, number>();
    if (this.version() >= 7 && !includeRecords)
      for (const row of this.db
        .prepare(
          "SELECT checkpoint,count(*) AS n FROM acknowledgement_records WHERE json_extract(record,'$.compatibilityOnly') IS NOT 1 GROUP BY checkpoint",
        )
        .all())
        recordCounts.set(String(row.checkpoint), Number(row.n));
    if (this.version() === 6 && !includeRecords)
      for (const [checkpoint, pairs] of reviews)
        recordCounts.set(checkpoint, pairs.length);
    return rows.map(({ lineageKnown, parentId, ...row }) =>
      importRevisionSchema.parse({
        ...row,
        ...(lineageKnown ? { parentId } : {}),
        ...(!includeRecords
          ? { reviewRecordCount: recordCounts.get(String(row.id)) ?? 0 }
          : {}),
        ...(this.version() >= 7 && includeRecords
          ? { reviewRecords: records.get(String(row.id)) ?? [] }
          : {}),
        ...(reviews.has(String(row.id))
          ? { reviewedAgainst: reviews.get(String(row.id))! }
          : {}),
      }),
    );
  }
  reviewHistory(checkpoint: string, offset = 0, limit = 20) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50
    )
      throw Error("Choose a review page size from 1 to 50");
    if (this.version() < 6)
      return { items: [], total: 0, offset, nextOffset: null };
    if (this.version() === 6) {
      const total = Number(
        this.db
          .prepare(
            "SELECT count(*) AS n FROM checkpoint_reviews WHERE checkpoint=?",
          )
          .get(checkpoint)?.n ?? 0,
      );
      const items = this.db
        .prepare(
          "SELECT against FROM checkpoint_reviews WHERE checkpoint=? ORDER BY against LIMIT ? OFFSET ?",
        )
        .all(checkpoint, limit, offset)
        .map((row) => ({
          ...legacyAcknowledgement(checkpoint, String(row.against)),
          withdrawalCount: 0,
        }));
      return {
        items,
        total,
        offset,
        nextOffset: offset + limit < total ? offset + limit : null,
      };
    }
    const total = Number(
      this.db
        .prepare(
          "SELECT count(*) AS n FROM acknowledgement_records WHERE checkpoint=? AND json_extract(record,'$.compatibilityOnly') IS NOT 1",
        )
        .get(checkpoint)?.n ?? 0,
    );
    const items = this.db
      .prepare(
        "SELECT record FROM acknowledgement_records WHERE checkpoint=? AND json_extract(record,'$.compatibilityOnly') IS NOT 1 ORDER BY (json_extract(record,'$.withdrawal') IS NOT NULL),id LIMIT ? OFFSET ?",
      )
      .all(checkpoint, limit, offset)
      .map((row) => {
        const record = acknowledgementSchema.parse(
          JSON.parse(String(row.record)),
        );
        const { additionalWithdrawals: _extra, ...summary } = record;
        return { ...summary, withdrawalCount: withdrawalEvents(record).length };
      });
    return {
      items,
      total,
      offset,
      nextOffset: offset + limit < total ? offset + limit : null,
    };
  }
  withdrawalHistory(id: string, offset = 0, limit = 20) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50
    )
      throw Error("Choose a withdrawal page size from 1 to 50");
    if (this.version() < 7)
      throw new ArchitectureConflict(
        "This legacy store has no individual withdrawal records",
      );
    const row = this.db
      .prepare("SELECT record FROM acknowledgement_records WHERE id=?")
      .get(id);
    if (!row)
      throw new ArchitectureConflict("Branch acknowledgement not found");
    const items = withdrawalEvents(
      acknowledgementSchema.parse(JSON.parse(String(row.record))),
    );
    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      offset,
      nextOffset: offset + limit < items.length ? offset + limit : null,
    };
  }
  reviewBranch(
    tip: string,
    expectedActive: string,
    metadata: { reviewer?: string; reason?: string } = {},
  ) {
    if (this.readOnly)
      throw new ArchitectureConflict("This architecture is open read-only.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const active = this.db
        .prepare("SELECT value FROM meta WHERE key='active'")
        .get()?.value;
      if (active !== expectedActive)
        throw new ArchitectureConflict(
          "The current version changed. Review this branch against the new version.",
        );
      const candidates = branchReview(
        this.revisions(false).map((row) => importRevisionSchema.parse(row)),
        expectedActive,
      );
      const branch = candidates.find((branch) => branch.id === tip);
      if (!branch || branch.lineage !== "recorded")
        throw new ArchitectureConflict(
          "Choose a separate branch with recorded lineage. Unknown history cannot be classified as a conflicting branch.",
        );
      if (
        Number(
          this.db.prepare("SELECT count(*) AS n FROM checkpoint_reviews").get()
            ?.n,
        ) >= 10000 &&
        !branch.reviewed
      )
        throw Error("Branch review limit (10000) exceeded");
      if (this.retainedBytes() + 128 > architectureLimits.retainedBytes)
        throw Error("Retained-content quota exceeded");
      if (!branch.reviewed) {
        const record = acknowledgementSchema.parse({
          id: hash("review:" + randomUUID()),
          against: expectedActive,
          ...metadata,
          created: this.recorded!.now(),
        });
        if (
          Number(
            this.db
              .prepare("SELECT count(*) AS n FROM acknowledgement_records")
              .get()?.n,
          ) >= 10000
        )
          throw Error("Branch review record limit (10000) exceeded");
        if (
          this.retainedBytes() + Buffer.byteLength(JSON.stringify(record)) >
          architectureLimits.retainedBytes
        )
          throw Error("Retained-content quota exceeded");
        this.db
          .prepare("INSERT INTO acknowledgement_records VALUES(?,?,?,?)")
          .run(record.id, tip, expectedActive, JSON.stringify(record));
        this.recorded!.record(
          "acknowledgement",
          record.id,
          record,
          expectedActive,
        );
        this.db
          .prepare("INSERT OR IGNORE INTO checkpoint_reviews VALUES(?,?)")
          .run(tip, expectedActive);
      }
      this.db.exec("COMMIT");
      return { tip, against: expectedActive, reviewed: true };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  withdrawBranchReview(
    id: string,
    expectedActive: string,
    metadata: { reviewer?: string; reason?: string } = {},
  ) {
    if (this.readOnly)
      throw new ArchitectureConflict("This architecture is open read-only.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (
        this.db.prepare("SELECT value FROM meta WHERE key='active'").get()
          ?.value !== expectedActive
      )
        throw new ArchitectureConflict(
          "The current version changed. Review the acknowledgement again.",
        );
      const row = this.db
        .prepare(
          "SELECT checkpoint,record FROM acknowledgement_records WHERE id=?",
        )
        .get(id);
      if (!row)
        throw new ArchitectureConflict("Branch acknowledgement not found");
      const original = acknowledgementSchema.parse(
        JSON.parse(String(row.record)),
      );
      if (!original.withdrawal) {
        const withdrawal = { ...metadata, created: this.recorded!.now() },
          record = acknowledgementSchema.parse({ ...original, withdrawal });
        this.db
          .prepare("UPDATE acknowledgement_records SET record=? WHERE id=?")
          .run(JSON.stringify(record), id);
        this.recorded!.record("acknowledgement", id, record, expectedActive);
        // A legacy pair-only archive must not resurrect a withdrawn acknowledgement.
        const legacy = legacyAcknowledgement(
          String(row.checkpoint),
          original.against,
        );
        const existing = this.db
          .prepare("SELECT record FROM acknowledgement_records WHERE id=?")
          .get(legacy.id);
        if (!existing)
          this.db
            .prepare("INSERT INTO acknowledgement_records VALUES(?,?,?,?)")
            .run(
              legacy.id,
              String(row.checkpoint),
              legacy.against,
              JSON.stringify({
                ...legacy,
                withdrawal,
                compatibilityOnly: true,
              }),
            );
        else {
          const parsed = acknowledgementSchema.parse(
            JSON.parse(String(existing.record)),
          );
          if (!parsed.withdrawal)
            this.db
              .prepare("UPDATE acknowledgement_records SET record=? WHERE id=?")
              .run(JSON.stringify({ ...parsed, withdrawal }), legacy.id);
        }
        this.syncAcknowledgements();
      }
      if (
        Number(
          this.db
            .prepare("SELECT count(*) AS n FROM acknowledgement_records")
            .get()?.n,
        ) > 10000
      )
        throw Error("Branch review record limit (10000) exceeded");
      if (this.retainedBytes() > architectureLimits.retainedBytes)
        throw Error("Retained-content quota exceeded");
      this.db.exec("COMMIT");
      return { id, withdrawn: true };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private syncAcknowledgements() {
    let withdrawals = 0;
    this.db.exec("DELETE FROM checkpoint_reviews");
    for (const row of this.db
      .prepare("SELECT checkpoint,against,record FROM acknowledgement_records")
      .all()) {
      const record = acknowledgementSchema.parse(
        JSON.parse(String(row.record)),
      );
      withdrawals += withdrawalEvents(record).length;
      if (withdrawals > 10000)
        throw Error("Branch withdrawal limit (10000) exceeded");
      if (!record.withdrawal)
        this.db
          .prepare("INSERT OR IGNORE INTO checkpoint_reviews VALUES(?,?)")
          .run(String(row.checkpoint), String(row.against));
    }
  }
  private indexRecord(id?: string) {
    const chosen =
      id ??
      this.db.prepare("SELECT value FROM meta WHERE key='active'").get()?.value;
    if (typeof chosen !== "string") return null;
    const snapshot = this.snapshotId(chosen);
    if (!snapshot) return null;
    const row = this.db
      .prepare("SELECT index_json FROM revisions WHERE id=?")
      .get(snapshot);
    if (typeof row?.index_json !== "string") return null;
    return { chosen, snapshot, json: row.index_json };
  }
  private presentIndex(
    chosen: string,
    snapshot: string,
    index: ArchitectureIndex,
    expectedContentHash?: string,
  ): ArchitectureIndex {
    const canonical = documentSetHash(index.documents);
    if (expectedContentHash !== undefined) {
      if (canonical !== expectedContentHash)
        throw Error("Stored architecture document identity mismatch");
    } else if (canonical !== snapshot) {
      const legacy = hash(
        JSON.stringify(
          [...index.documents]
            .sort((a, b) => a.path.localeCompare(b.path))
            .map((d) => [d.path, d.hash]),
        ),
      );
      if (legacy !== snapshot)
        index.warnings.push(
          "Legacy snapshot ordering was not recorded. Individual document hashes were checked; the original snapshot checksum cannot be reconstructed in this locale. Re-export to retain a portable content checksum.",
        );
    }
    const view = { ...index, id: chosen, snapshotHash: snapshot };
    this.cache.set(chosen, view);
    while (this.cache.size > 3)
      this.cache.delete(this.cache.keys().next().value!);
    return structuredClone(view);
  }
  read(id?: string): ArchitectureIndex | null {
    const record = this.indexRecord(id);
    if (!record) return null;
    const cached = this.cache.get(record.chosen);
    if (cached) return structuredClone(cached);
    const raw = JSON.parse(record.json);
    const index =
      raw.indexVersion === architectureIndexVersion
        ? indexSchema.parse(raw)
        : indexArchitecture(
            this.db
              .prepare(
                "SELECT path FROM documents WHERE revision=? ORDER BY path",
              )
              .all(record.snapshot)
              .map((d) => this.document(record.chosen, String(d.path))),
          );
    return this.presentIndex(
      record.chosen,
      record.snapshot,
      index,
      raw.contentHash,
    );
  }
  async readAsync(id?: string): Promise<ArchitectureIndex | null> {
    const task = this.readInWorker(id);
    this.readTasks.add(task);
    try {
      return await task;
    } finally {
      this.readTasks.delete(task);
    }
  }
  private async readInWorker(id?: string): Promise<ArchitectureIndex | null> {
    if (this.closed || this.readAbort.signal.aborted)
      throw Error("Architecture reader is closed");
    const record = this.indexRecord(id);
    if (!record) return null;
    const cached = this.cache.get(record.chosen);
    if (cached) return structuredClone(cached);
    const raw = JSON.parse(record.json);
    const index =
      raw.indexVersion === architectureIndexVersion
        ? indexSchema.parse(raw)
        : await indexInWorker(
            this.db
              .prepare(
                "SELECT path FROM documents WHERE revision=? ORDER BY path",
              )
              .all(record.snapshot)
              .map((d) => this.document(record.chosen, String(d.path))),
            this.readAbort.signal,
          );
    return this.presentIndex(
      record.chosen,
      record.snapshot,
      index,
      raw.contentHash,
    );
  }
  async closeReadWorkers() {
    this.readAbort.abort();
    await Promise.allSettled([...this.readTasks]);
  }
  document(revision: string, path: string): ArchitectureDocument {
    const snapshot = this.snapshotId(revision);
    if (!snapshot) throw Error("Unknown architecture revision");
    const row = this.db
      .prepare(
        this.version() === 1
          ? "SELECT path,text,hash FROM documents WHERE revision=? AND path=?"
          : "SELECT path,blobs.text AS text,blobs.hash AS hash FROM documents JOIN blobs ON blobs.hash=documents.hash WHERE revision=? AND path=?",
      )
      .get(snapshot, path);
    if (!row) throw Error("Document is not in this architecture revision");
    if (typeof row.text !== "string" || hash(row.text) !== row.hash)
      throw Error("Stored architecture document is corrupt");
    return documentSchema.parse({ path: row.path, text: row.text });
  }
  export(revision: string) {
    const index = this.read(revision);
    if (!index) throw Error("Unknown architecture revision");
    const documents = index.documents.map((d) =>
      this.document(revision, d.path),
    );
    const actualHash = documentSetHash(
      documents.map((d) => ({ path: d.path, hash: hash(d.text) })),
    );
    if (actualHash !== documentSetHash(index.documents))
      throw Error("Stored architecture document identity mismatch");
    return {
      schema: "pymtheg.architecture-bundle/v3",
      contentHash: actualHash,
      revision: this.revisions().find((r) => r.id === revision),
      index,
      documents,
    };
  }
  exportRecordedHistory() {
    return exportRecordedHistory(this.db);
  }
  /** Stored code links (R1-D). Older or read-only stores without the table have none. */
  codeLinkRows(): {
    id: string;
    key: string;
    body: string;
    removed: boolean;
  }[] {
    if (
      !this.db
        .prepare("SELECT name FROM sqlite_master WHERE name='code_links'")
        .get()
    )
      return [];
    return this.db
      .prepare("SELECT id,key,body,removed FROM code_links ORDER BY rowid")
      .all()
      .map((row) => ({
        id: String(row.id),
        key: String(row.key),
        body: String(row.body),
        removed: Number(row.removed) === 1,
      }));
  }
  /** Adds, updates (value) or removes (null) the active code link under `key`, with a
   * recorded change in the same transaction. Re-adding a removed key gets a new
   * UUID with a `previous` reference (recorded-history rule). `onlyIfAbsent`
   * returns the existing active link instead of updating it. */
  writeCodeLink(
    key: string,
    value: Record<string, unknown> | null,
    onlyIfAbsent = false,
  ): { id: string; changed: boolean } {
    if (this.readOnly)
      throw new ArchitectureConflict("This architecture is open read-only.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const active = this.db
        .prepare("SELECT id,body FROM code_links WHERE key=? AND removed=0")
        .get(key);
      if (value === null && !active) throw Error("No active code link " + key);
      if (
        active &&
        (onlyIfAbsent || (value && JSON.stringify(value) === active.body))
      ) {
        this.db.exec("COMMIT");
        return { id: String(active.id), changed: false };
      }
      this.recorded!.record("code-link", key, value, this.activeRevisionId());
      let id: string;
      if (value === null) {
        id = String(active!.id);
        this.db.prepare("UPDATE code_links SET removed=1 WHERE id=?").run(id);
      } else {
        id = String(
          this.db
            .prepare(
              "SELECT id FROM shared_record_ids WHERE kind='code-link' AND key=?",
            )
            .get(key)!.id,
        );
        this.db
          .prepare(
            "INSERT INTO code_links(id,key,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,removed=0",
          )
          .run(id, key, JSON.stringify(value));
      }
      this.db.exec("COMMIT");
      return { id, changed: true };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  exportHistory() {
    const snapshots = this.db
      .prepare("SELECT id,index_json FROM revisions ORDER BY id")
      .all()
      .map((row) => {
        const documents = this.db
          .prepare("SELECT path,hash FROM documents WHERE revision=?")
          .all(String(row.id))
          .map((d) => ({ path: String(d.path), hash: String(d.hash) }))
          .sort((a, b) => compareText(a.path, b.path));
        const contentHash = documentSetHash(documents);
        const recorded: unknown = JSON.parse(String(row.index_json));
        if (
          recorded &&
          typeof recorded === "object" &&
          "contentHash" in recorded &&
          recorded.contentHash !== contentHash
        )
          throw Error("Stored architecture document identity mismatch");
        return { id: row.id, contentHash, documents };
      });
    const revisions = this.revisions().map(({ snapshotHash, ...row }) => ({
      ...row,
      snapshot: snapshotHash,
    }));
    const blobs = this.db
      .prepare(
        this.version() === 1
          ? "SELECT hash,text FROM documents GROUP BY hash"
          : "SELECT hash,text FROM blobs ORDER BY hash",
      )
      .all();
    const active = this.db
      .prepare("SELECT value FROM meta WHERE key='active'")
      .get()?.value;
    return validateHistory({
      schema: "pymtheg.architecture-history/v3",
      active,
      snapshots,
      revisions,
      blobs,
      draft: this.readDraft().draft,
    });
  }
  importHistory(raw: unknown, expectedActive?: string | null) {
    return this.commitValidatedHistory(validateHistory(raw), expectedActive);
  }
  /** The coordinator supplies an archive whose content was validated in its owned worker. */
  commitValidatedHistory(
    archive: import("zod").infer<typeof historySchema>,
    expectedActive?: string | null,
  ) {
    if (this.readOnly)
      throw new ArchitectureConflict("This architecture is open read-only.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.db
        .prepare("SELECT value FROM meta WHERE key='active'")
        .get()?.value;
      if (expectedActive !== undefined && (current ?? null) !== expectedActive)
        throw new ArchitectureConflict(
          "The current architecture changed. Preview the history archive again.",
        );
      const draft = this.readDraft().draft;
      if (
        draft &&
        archive.draft &&
        JSON.stringify(draft) !== JSON.stringify(archive.draft)
      )
        throw new ArchitectureConflict(
          "This workspace already has a different recovery draft. Finish or export it before importing history; neither draft was changed.",
        );
      const knownCheckpoint = this.db.prepare(
        "SELECT snapshot,label,created,source FROM checkpoints WHERE id=?",
      );
      const knownParent = this.db.prepare(
        "SELECT parent FROM checkpoint_parents WHERE checkpoint=?",
      );
      const reviewRows = new Set(
        this.db
          .prepare("SELECT checkpoint,against FROM checkpoint_reviews")
          .all()
          .map((row) => row.checkpoint + ":" + row.against),
      );
      let reviewBytes = 0;
      for (const checkpoint of archive.revisions)
        for (const against of checkpoint.reviewedAgainst ?? []) {
          const key = checkpoint.id + ":" + against;
          if (!reviewRows.has(key)) {
            reviewRows.add(key);
            reviewBytes += Buffer.byteLength(checkpoint.id + against);
          }
        }
      if (reviewRows.size > 10000)
        throw Error("Branch review limit (10000) exceeded");
      let lineageBytes = reviewBytes;
      let novelCheckpoints = 0;
      for (const checkpoint of archive.revisions) {
        const old = knownCheckpoint.get(checkpoint.id);
        if (
          old &&
          (old.snapshot !== checkpoint.snapshot ||
            old.label !== checkpoint.label ||
            old.created !== checkpoint.created ||
            old.source !== checkpoint.source)
        )
          throw new ArchitectureConflict(
            "A matching checkpoint has different metadata or content. Import into an empty workspace to preserve both histories.",
          );
        const lineage = knownParent.get(checkpoint.id);
        if (
          lineage &&
          checkpoint.parentId !== undefined &&
          lineage.parent !== checkpoint.parentId
        )
          throw new ArchitectureConflict(
            "A matching checkpoint has different parent history. Neither history was changed.",
          );
        if (!lineage && checkpoint.parentId !== undefined)
          lineageBytes += Buffer.byteLength(
            checkpoint.id + (checkpoint.parentId ?? ""),
          );
        if (!old) novelCheckpoints++;
      }
      const combinedParents = new Map<string, string | null | undefined>(
        this.db
          .prepare(
            "SELECT c.id,p.checkpoint,p.parent FROM checkpoints c LEFT JOIN checkpoint_parents p ON p.checkpoint=c.id",
          )
          .all()
          .map((row) => [
            String(row.id),
            row.checkpoint
              ? row.parent === null
                ? null
                : String(row.parent)
              : undefined,
          ]),
      );
      for (const checkpoint of archive.revisions) {
        if (
          !combinedParents.has(checkpoint.id) ||
          checkpoint.parentId !== undefined
        )
          combinedParents.set(checkpoint.id, checkpoint.parentId);
      }
      validateParentGraph(combinedParents);
      if (
        Number(
          this.db.prepare("SELECT count(*) AS n FROM checkpoints").get()?.n ??
            0,
        ) +
          novelCheckpoints >
        architectureLimits.maxRevisions
      )
        throw Error(
          "History import exceeds 10,000 checkpoints; existing history was preserved.",
        );
      const known = new Set(
        this.db
          .prepare("SELECT hash FROM blobs")
          .all()
          .map((row) => String(row.hash)),
      );
      const knownSnapshots = new Set(
        this.db
          .prepare("SELECT id FROM revisions")
          .all()
          .map((row) => String(row.id)),
      );
      for (const snapshot of archive.snapshots)
        if (knownSnapshots.has(snapshot.id)) {
          const stored = this.db
            .prepare("SELECT path,hash FROM documents WHERE revision=?")
            .all(snapshot.id)
            .map((d) => ({ path: String(d.path), hash: String(d.hash) }));
          if (documentSetHash(stored) !== snapshot.contentHash)
            throw new ArchitectureConflict(
              "A matching snapshot has different document content. Neither history was changed.",
            );
        }
      const additional =
        archive.blobs
          .filter((blob) => !known.has(blob.hash))
          .reduce((n, blob) => n + Buffer.byteLength(blob.text), 0) +
        archive.snapshots
          .filter((snapshot) => !knownSnapshots.has(snapshot.id))
          .reduce(
            (n, snapshot) =>
              n +
              Buffer.byteLength(
                JSON.stringify({
                  indexVersion: 0,
                  id: snapshot.id,
                  contentHash: snapshot.contentHash,
                }),
              ),
            0,
          ) +
        archive.revisions
          .filter((checkpoint) => !knownCheckpoint.get(checkpoint.id))
          .reduce(
            (n, checkpoint) =>
              n +
              checkpointStorageBytes(
                checkpoint.label,
                checkpoint.source,
                checkpoint.created,
                checkpoint.id,
                checkpoint.snapshot,
              ),
            0,
          );
      if (
        this.retainedBytes() + additional + lineageBytes >
        architectureLimits.retainedBytes
      )
        throw Error(
          "History import exceeds the retained-content quota; existing history was preserved.",
        );
      const putBlob = this.db.prepare(
          "INSERT OR IGNORE INTO blobs VALUES(?,?)",
        ),
        putSnapshot = this.db.prepare(
          "INSERT OR IGNORE INTO revisions VALUES(?,?,?,?,?)",
        ),
        putDocument = this.db.prepare(
          "INSERT OR IGNORE INTO documents VALUES(?,?,?)",
        ),
        putCheckpoint = this.db.prepare(
          "INSERT OR IGNORE INTO checkpoints VALUES(?,?,?,?,?)",
        );
      for (const blob of archive.blobs) putBlob.run(blob.hash, blob.text);
      for (const snapshot of archive.snapshots) {
        putSnapshot.run(
          snapshot.id,
          "",
          "",
          "",
          JSON.stringify({
            indexVersion: 0,
            id: snapshot.id,
            contentHash: snapshot.contentHash,
          }),
        );
        for (const document of snapshot.documents)
          putDocument.run(snapshot.id, document.path, document.hash);
      }
      // Portable archives list newest first; append oldest first to preserve that order.
      for (const checkpoint of [...archive.revisions].reverse()) {
        const inserted = putCheckpoint.run(
          checkpoint.id,
          checkpoint.snapshot,
          checkpoint.label,
          checkpoint.created,
          checkpoint.source,
        );
        if (Number(inserted.changes))
          this.db
            .prepare("INSERT INTO checkpoint_log(checkpoint) VALUES(?)")
            .run(checkpoint.id);
      }
      for (const checkpoint of archive.revisions)
        if (checkpoint.parentId !== undefined)
          this.db
            .prepare("INSERT OR IGNORE INTO checkpoint_parents VALUES(?,?)")
            .run(checkpoint.id, checkpoint.parentId);
      for (const checkpoint of archive.revisions) {
        const records =
          checkpoint.reviewRecords ??
          (checkpoint.reviewedAgainst ?? []).map((against) =>
            legacyAcknowledgement(checkpoint.id, against),
          );
        for (const record of records) {
          const existing = this.db
            .prepare(
              "SELECT checkpoint,record FROM acknowledgement_records WHERE id=?",
            )
            .get(record.id);
          if (existing && existing.checkpoint !== checkpoint.id)
            throw Error("Conflicting branch acknowledgement checkpoint");
          const merged = existing
            ? mergeAcknowledgement(
                acknowledgementSchema.parse(
                  JSON.parse(String(existing.record)),
                ),
                record,
              )
            : mergeAcknowledgement(record, record);
          this.db
            .prepare(
              "INSERT INTO acknowledgement_records VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record",
            )
            .run(
              merged.id,
              checkpoint.id,
              merged.against,
              JSON.stringify(merged),
            );
        }
      }
      if (
        Number(
          this.db
            .prepare("SELECT count(*) AS n FROM acknowledgement_records")
            .get()?.n,
        ) > 10000
      )
        throw Error("Branch review record limit (10000) exceeded");
      this.syncAcknowledgements();
      if (this.retainedBytes() > architectureLimits.retainedBytes)
        throw Error("Retained-content quota exceeded");
      if (!current)
        this.db
          .prepare("INSERT INTO meta VALUES('active',?)")
          .run(archive.active);
      if (!draft && archive.draft)
        this.db
          .prepare(
            "INSERT INTO authoring_draft VALUES('active',1,?) ON CONFLICT(key) DO UPDATE SET version=version+1,json=excluded.json",
          )
          .run(JSON.stringify(archive.draft));
      this.db.exec("COMMIT");
      return {
        importedRevisions: archive.revisions.length,
        active: current ?? archive.active,
        keptCurrent: !!current,
        recoveryDraftRetained: !!archive.draft,
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  search(revision: string, query: string) {
    return this.searchPage(revision, query).matches;
  }
  searchPage(revision: string, query: string, offset = 0, limit = 100) {
    if (!this.read(revision)) throw Error("Unknown architecture revision");
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw Error(
        "Search requires a nonnegative offset and a limit from 1 to 100",
      );
    if (!query.trim())
      return { total: 0, offset, limit, nextOffset: null, matches: [] };
    if (query.length > 256)
      throw Error("Search must be at most 256 characters");
    const source =
      this.version() === 1
        ? "documents"
        : "documents JOIN blobs ON blobs.hash=documents.hash";
    const where =
      "WHERE revision=? AND path NOT GLOB '.pymtheg*' AND (instr(pym_lower(path),pym_lower(?))>0 OR instr(pym_lower(text),pym_lower(?))>0)";
    const args = [this.snapshotId(revision)!, query, query];
    const total = Number(
      this.db
        .prepare(`SELECT count(*) AS total FROM ${source} ${where}`)
        .get(...args)!.total,
    );
    const matches = this.db
      .prepare(
        `SELECT path,text FROM ${source} ${where} ORDER BY path LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset)
      .map((row) => {
        const text = String(row.text),
          at = Math.max(0, text.toLowerCase().indexOf(query.toLowerCase()));
        return {
          path: String(row.path),
          snippet:
            (at > 80 ? "…" : "") + text.slice(Math.max(0, at - 80), at + 180),
        };
      });
    return {
      total,
      offset,
      limit,
      matches,
      nextOffset:
        offset + matches.length < total ? offset + matches.length : null,
    };
  }
  readDraft() {
    if (
      !this.db
        .prepare("SELECT name FROM sqlite_master WHERE name='authoring_draft'")
        .get()
    )
      return { version: 0, draft: null };
    const row = this.db
      .prepare("SELECT version,json FROM authoring_draft WHERE key='active'")
      .get();
    return architectureDraftViewSchema.parse(
      row
        ? {
            version: row.version,
            draft: row.json ? JSON.parse(String(row.json)) : null,
          }
        : { version: 0, draft: null },
    );
  }
  saveDraft(expectedVersion: number, raw: unknown) {
    if (this.readOnly)
      throw new ArchitectureConflict("This architecture is open read-only.");
    const draft = architectureDraftSchema.nullable().parse(raw);
    if (draft?.kind === "document")
      draft.document.path = sharedProjectPath(
        this.projectRoot,
        draft.document.path,
      );
    if (draft?.kind === "plan" && draft.target)
      draft.target.document = sharedProjectPath(
        this.projectRoot,
        draft.target.document,
      );
    const text = JSON.stringify(draft);
    if (Buffer.byteLength(text) > architectureLimits.documentBytes)
      throw Error("Architecture draft exceeds 16 MiB");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.readDraft();
      if (current.version !== expectedVersion)
        throw Error(
          "An architecture draft was changed in another session. Your local text is preserved; reload to review the other draft before replacing it.",
        );
      this.db
        .prepare(
          "INSERT INTO authoring_draft VALUES('active',?,?) ON CONFLICT(key) DO UPDATE SET version=excluded.version,json=excluded.json",
        )
        .run(expectedVersion + 1, text);
      if (JSON.stringify(current.draft) !== text)
        this.recorded!.record(
          "architecture-draft",
          "active",
          draft,
          this.activeRevisionId(),
        );
      this.db.exec("COMMIT");
      return { version: expectedVersion + 1, draft };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  storageStats() {
    const legacy = this.version() === 1;
    return {
      revisions: Number(
        this.db
          .prepare(
            this.version() >= 3
              ? "SELECT count(*) AS n FROM checkpoints"
              : "SELECT count(*) AS n FROM revisions",
          )
          .get()?.n ?? 0,
      ),
      snapshots: Number(
        this.db.prepare("SELECT count(*) AS n FROM revisions").get()?.n ?? 0,
      ),
      uniqueDocuments: Number(
        this.db
          .prepare(
            legacy
              ? "SELECT count(DISTINCT hash) AS n FROM documents"
              : "SELECT count(*) AS n FROM blobs",
          )
          .get()?.n ?? 0,
      ),
      uniqueBytes: Number(
        this.db
          .prepare(
            legacy
              ? "SELECT coalesce(sum(length(CAST(text AS BLOB))),0) AS n FROM (SELECT hash,text FROM documents GROUP BY hash)"
              : "SELECT coalesce(sum(length(CAST(text AS BLOB))),0) AS n FROM blobs",
          )
          .get()?.n ?? 0,
      ),
    };
  }
  close() {
    if (this.closed) return;
    this.readAbort.abort();
    this.db.close();
    this.closed = true;
    if (this.snapshotDirectory)
      rmSync(this.snapshotDirectory, { recursive: true, force: true });
  }
}
export async function readArchitectureFolder(
  input: string,
  selection: DocumentSelection = {},
) {
  selection.signal?.throwIfAborted();
  // Validate patterns before discovery, including an empty source.
  documentSkipReason("", selection);
  const root = await realpath(input).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT")
        throw Error(
          "The documentation source folder or file was not found. Check its current location; use --source-id when refreshing a moved source.",
        );
      throw error;
    }),
    documents: ArchitectureDocument[] = [],
    excluded: string[] = [],
    skipped = skippedDocuments(),
    singleFile = (await stat(root)).isFile();
  function skip(
    name: string,
    reason: Parameters<typeof recordSkipped>[2],
    kind: "file" | "directory" | "entry" = "file",
    legacyLabel?: string,
  ) {
    recordSkipped(skipped, name, reason, kind);
    // Special entries were never part of the saved legacy inventory.
    if (reason === "special-file") return;
    const label = {
      "unsupported-type": "outside text-document import formats",
      "outside-selection": "outside selected documentation scope",
      "generated-private": "generated/private directory",
      "symbolic-link": "symbolic link",
      "special-file": "special file",
      "too-large": "exceeds the 16 MiB document limit",
      excluded: "excluded",
    }[reason];
    excluded.push(name + " (" + (legacyLabel ?? label) + ")");
  }
  let bytes = 0;
  async function readDocument(path: string, name: string) {
    const reason = documentSkipReason(name, selection);
    if (reason) {
      skip(
        name,
        reason,
        "file",
        reason === "outside-selection" || reason === "excluded"
          ? "outside text-document import formats"
          : undefined,
      );
      return;
    }
    const before = await stat(path);
    if (before.size > architectureLimits.documentBytes) {
      recordSkipped(skipped, name, "too-large");
      throw Object.assign(Error(name + " exceeds the 16 MiB document limit"), {
        skipped,
      });
    }
    bytes += before.size;
    if (
      bytes > architectureLimits.snapshotBytes ||
      documents.length >= architectureLimits.maxDocuments - 1
    )
      throw Error("Architecture document import limit exceeded");
    const text = decodeUtf8(await readFile(path), name),
      after = await stat(path);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw Error(
        name + " changed during import; retry to capture a consistent file",
      );
    selection.signal?.throwIfAborted();
    documents.push({ path: name, text });
  }
  async function visit(dir: string) {
    selection.signal?.throwIfAborted();
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort(
      (a, b) => compareText(a.name, b.name),
    )) {
      selection.signal?.throwIfAborted();
      const path = join(dir, entry.name),
        name = relative(root, path);
      if (entry.isSymbolicLink()) {
        skip(name, "symbolic-link", "entry");
      } else if (entry.isDirectory()) {
        if (excludedDirectory(entry.name)) {
          skip(name, "generated-private", "directory");
          continue;
        }
        // Explicit includes can reach beyond the default directory predicate.
        // User excludes apply to files; walking preserves exact per-file counts.
        if (
          selection.include === undefined &&
          selection.directory?.(name) === false
        ) {
          skip(name, "outside-selection", "directory");
          continue;
        }
        await visit(path);
      } else if (entry.isFile()) {
        await readDocument(path, name);
      } else skip(name, "special-file", "entry");
    }
  }
  if (singleFile) await readDocument(root, root.split("/").at(-1)!);
  else if ((await stat(root)).isDirectory()) await visit(root);
  else skip(input.split("/").at(-1)!, "special-file", "entry");
  return { root, documents, excluded, skipped };
}
