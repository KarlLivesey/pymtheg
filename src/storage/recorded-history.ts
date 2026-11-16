// SPDX-License-Identifier: MIT
/** Additive shared identities and immutable change receipts. No archive migration or sync. */
import { randomUUID, createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ArchitectureIndex } from "../architecture/schema.js";
export interface Origin {
  machine: string;
  actor: string;
  author: string;
}
export interface HistoryWriter {
  origin: Origin;
  now: () => string;
}
export interface SharedRecord {
  id: string;
  kind: string;
  key: string;
  hash: string | null;
  previous?: string;
}
export interface RecordedChange {
  id: string;
  sequence: number;
  origin: Origin;
  time: string;
  checkpoint: string | null;
  changes: { record: string; before: string | null; after: string | null }[];
}
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Logical commit sequence first, then origin and random change ID; timestamps never order changes. */
export function compareRecordedChanges(
  a: RecordedChange,
  b: RecordedChange,
): number {
  return (
    a.sequence - b.sequence ||
    compare(a.origin.machine, b.origin.machine) ||
    compare(a.origin.actor, b.origin.actor) ||
    compare(a.id, b.id)
  );
}
export function initializeRecordedHistory(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS shared_record_ids(kind TEXT,key TEXT,id TEXT NOT NULL UNIQUE,hash TEXT,PRIMARY KEY(kind,key));
    CREATE TABLE IF NOT EXISTS shared_record_lineage(id TEXT PRIMARY KEY,kind TEXT NOT NULL,key TEXT NOT NULL,previous TEXT);
    CREATE TABLE IF NOT EXISTS recorded_changes(id TEXT PRIMARY KEY,sequence INTEGER NOT NULL,body TEXT NOT NULL);`);
}
export function recordedHistoryBytes(db: DatabaseSync): number {
  if (
    !db
      .prepare("SELECT name FROM sqlite_master WHERE name='recorded_changes'")
      .get()
  )
    return 0;
  const lineageBytes = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE name='shared_record_lineage'",
    )
    .get()
    ? Number(
        db
          .prepare(
            "SELECT coalesce(sum(length(CAST(id||kind||key||coalesce(previous,'') AS BLOB))),0) AS n FROM shared_record_lineage",
          )
          .get()!.n,
      )
    : 0;
  return (
    lineageBytes +
    Number(
      db
        .prepare(
          "SELECT coalesce(sum(length(CAST(body AS BLOB))),0) AS n FROM recorded_changes",
        )
        .get()!.n,
    ) +
    Number(
      db
        .prepare(
          "SELECT coalesce(sum(length(CAST(kind||key||id||coalesce(hash,'') AS BLOB))),0) AS n FROM shared_record_ids",
        )
        .get()!.n,
    )
  );
}
export function exportRecordedHistory(db: DatabaseSync) {
  if (
    !db
      .prepare("SELECT name FROM sqlite_master WHERE name='recorded_changes'")
      .get()
  )
    return {
      schema: "pymtheg.recorded-history/v1" as const,
      records: [] as SharedRecord[],
      changes: [] as RecordedChange[],
    };
  const records = db
    .prepare("SELECT id,kind,key,hash FROM shared_record_ids ORDER BY id")
    .all() as unknown as SharedRecord[];
  if (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name='shared_record_lineage'",
      )
      .get()
  ) {
    const byId = new Map(records.map((record) => [record.id, record]));
    for (const row of db
      .prepare("SELECT id,kind,key,previous FROM shared_record_lineage")
      .all()) {
      const record = byId.get(String(row.id)) ?? {
        id: String(row.id),
        kind: String(row.kind),
        key: String(row.key),
        hash: null,
      };
      if (row.previous !== null) record.previous = String(row.previous);
      if (!byId.has(record.id)) records.push(record);
    }
    records.sort((a, b) => compare(a.id, b.id));
  }
  const changes = db
    .prepare("SELECT body FROM recorded_changes")
    .all()
    .map((row) => JSON.parse(String(row.body)) as RecordedChange)
    .sort(compareRecordedChanges);
  return { schema: "pymtheg.recorded-history/v1" as const, records, changes };
}
/** All writes require the feature's existing transaction, so rollback includes receipts and IDs. */
export class RecordedHistory {
  constructor(
    private db: DatabaseSync,
    private writer: HistoryWriter,
    private quota: () => void,
  ) {
    if (Object.keys(writer.origin).sort().join() !== "actor,author,machine")
      throw Error("Invalid history origin");
    for (const value of Object.values(writer.origin))
      if (typeof value !== "string" || !value.trim() || value.length > 200)
        throw Error("Invalid history origin");
    this.writer = { ...writer, origin: { ...writer.origin } };
  }
  now(): string {
    const time = this.writer.now();
    if (typeof time !== "string" || !Number.isFinite(Date.parse(time)))
      throw Error("Invalid recorded change time");
    return time;
  }
  record(kind: string, key: string, value: unknown, checkpoint: string | null) {
    this.commit(
      [[kind, key, value === null ? null : digest(value)]],
      checkpoint,
      false,
    );
  }
  capture(index: ArchitectureIndex, checkpoint: string, time: string) {
    const records: [string, string, string][] = index.documents.map((d) => [
      "document",
      d.path,
      d.hash,
    ]);
    for (const entity of index.entities)
      records.push([
        "entity",
        JSON.stringify([entity.document, entity.id]),
        digest(entity),
      ]);
    const duplicates = new Map<string, number>();
    for (const edge of index.edges) {
      const key = JSON.stringify([
        edge.document,
        edge.from,
        edge.to || edge.targetName,
        edge.kind,
      ]);
      const ordinal = duplicates.get(key) ?? 0;
      duplicates.set(key, ordinal + 1);
      records.push(["link", JSON.stringify([key, ordinal]), digest(edge)]);
    }
    records.push(["checkpoint", checkpoint, index.id]);
    this.commit(records, checkpoint, true, time);
  }
  private commit(
    values: [string, string, string | null][],
    checkpoint: string | null,
    replace: boolean,
    time?: string,
  ) {
    if (!this.db.isTransaction)
      throw Error("Recorded changes require a transaction");
    const previous = new Map(
      this.db
        .prepare("SELECT * FROM shared_record_ids")
        .all()
        .map((row) => [
          JSON.stringify([row.kind, row.key]),
          row as unknown as SharedRecord,
        ]),
    );
    const deltas: RecordedChange["changes"] = [];
    const retained = new Set<string>();
    const put = this.db.prepare(
      "INSERT INTO shared_record_ids VALUES(?,?,?,?) ON CONFLICT(kind,key) DO UPDATE SET id=excluded.id,hash=excluded.hash",
    );
    for (const [kind, key, hash] of values) {
      const token = JSON.stringify([kind, key]);
      if (retained.has(token)) continue;
      retained.add(token);
      const before = previous.get(token);
      if (before?.hash === hash || (!before && hash === null)) continue;
      const id = before && before.hash !== null ? before.id : randomUUID();
      if (before && before.hash === null) {
        this.db
          .prepare(
            "INSERT OR IGNORE INTO shared_record_lineage VALUES(?,?,?,NULL)",
          )
          .run(before.id, kind, key);
        this.db
          .prepare("INSERT INTO shared_record_lineage VALUES(?,?,?,?)")
          .run(id, kind, key, before.id);
      }
      put.run(kind, key, id, hash);
      deltas.push({ record: id, before: before?.hash ?? null, after: hash });
    }
    if (replace)
      for (const [token, record] of previous)
        if (
          ["document", "entity", "link"].includes(record.kind) &&
          record.hash !== null &&
          !retained.has(token)
        ) {
          this.db
            .prepare("UPDATE shared_record_ids SET hash=NULL WHERE id=?")
            .run(record.id);
          deltas.push({ record: record.id, before: record.hash, after: null });
        }
    if (!deltas.length) return;
    const sequence = Number(
      this.db
        .prepare(
          "SELECT coalesce(max(sequence),0)+1 AS n FROM recorded_changes",
        )
        .get()!.n,
    );
    if (!Number.isSafeInteger(sequence))
      throw Error("Recorded change sequence exhausted");
    const change: RecordedChange = {
      id: randomUUID(),
      sequence,
      origin: this.writer.origin,
      time: time ?? this.now(),
      checkpoint,
      changes: deltas.sort((a, b) => compare(a.record, b.record)),
    };
    this.db
      .prepare("INSERT INTO recorded_changes VALUES(?,?,?)")
      .run(change.id, sequence, JSON.stringify(change));
    this.quota();
  }
}
