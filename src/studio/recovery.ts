import { readRecipeFormDraft, type RecipeFormDraft } from "./recipes.js";
import {
  mkdir,
  realpath,
  stat,
  chmod,
  writeFile,
  readFile,
  lstat,
} from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync as Database } from "node:sqlite";
import { Ajv } from "ajv";
import { z } from "zod";
import { readInterfaceDraft, type InterfaceDraft } from "./interface-data.js";
import { readTypeDraft, type TypeDraft } from "./type-edit-data.js";
import { json } from "../shared/identity.js";
import { atomicWrite } from "../reporting/publish.js";
import { isCallableShape } from "./shapes.js";
import type { StudioRun } from "./protocol.js";
import { implementationDraftsSchema } from "./implementation-draft.js";
import { rangeDraftsSchema } from "./range-data.js";
import { operationDraftSchema } from "./operation-data.js";
import { declarationDraftSchema } from "./declaration-data.js";
const settingsSchema = z
  .object({
    seed: z.string().max(80),
    maxSteps: z.number().finite(),
    maxSamples: z.number().finite(),
    timeoutMs: z.number().finite(),
    scope: z.string().max(2 * 1024 * 1024),
  })
  .strict();
const draftSchema = z
  .object({
    path: z.string().min(1).max(4096),
    text: z.string().max(2 * 1024 * 1024),
    baseHash: z.string().nullable(),
  })
  .strict();
const contextSchema = z
  .object({
    file: z.string(),
    entry: z.string(),
    tab: z.string(),
    editorMode: z.enum(["text", "blocks"]).optional(),
    settings: settingsSchema,
    cursor: z.number().int().min(0).optional(),
    selectedRun: z.string().optional(),
    frozen: z.boolean().optional(),
    newDesign: z
      .custom<RecipeFormDraft>((v) => {
        try {
          readRecipeFormDraft(v);
          return true;
        } catch {
          return false;
        }
      }, "Invalid new-design draft")
      .nullable()
      .optional(),
    interfaceDraft: z
      .custom<InterfaceDraft>((v) => {
        try {
          readInterfaceDraft(v);
          return true;
        } catch {
          return false;
        }
      }, "Invalid unfinished interface form")
      .nullable()
      .optional(),
    implementationDrafts: implementationDraftsSchema.optional(),
    rangeDrafts: rangeDraftsSchema.optional(),
    declarationDraft: declarationDraftSchema.nullable().optional(),
    operationDraft: operationDraftSchema.nullable().optional(),
    typeDraft: z
      .custom<TypeDraft>((value) => {
        try {
          readTypeDraft(value);
          return true;
        } catch {
          return false;
        }
      }, "Invalid unfinished data-shape form")
      .nullable()
      .optional(),
  })
  .strict();
const workspaceSchema = z
  .object({
    drafts: z.array(draftSchema).max(128),
    context: contextSchema.nullable(),
  })
  .strict();
export type SavedWorkspace = z.infer<typeof workspaceSchema>;
export interface RecoveryView extends SavedWorkspace {
  revision: number;
  error: string | null;
  enabled: boolean;
}
export class RecoveryConflict extends Error {
  override name = "RecoveryConflict";
}
export class RecoveryStore {
  private constructor(
    private db: Database,
    private validateReport: (value: unknown) => boolean,
  ) {}
  static async openOrCreate(root: string): Promise<RecoveryStore> {
    const directory = resolve(root, ".pymtheg-studio");
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    return RecoveryStore.openExisting(root, directory);
  }
  private static async openExisting(root: string, directory: string) {
    const canonical = await realpath(directory);
    if (
      canonical !== directory ||
      relative(root, canonical).startsWith(".." + sep)
    )
      throw Error(
        "Recovery directory must be a real directory inside this project",
      );
    if (!(await stat(directory)).isDirectory())
      throw Error("Recovery path is not a directory");
    await chmod(directory, 0o700);
    const file = resolve(directory, "workspace.sqlite");
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink())
        throw Error("Recovery database must be a regular file");
      if (info.size > 128 * 1024 * 1024)
        throw Error("Recovery database exceeds 128 MiB");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    for (const suffix of ["-wal", "-shm"]) {
      try {
        if ((await lstat(file + suffix)).isSymbolicLink())
          throw Error("Recovery sidecar cannot be a symbolic link");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    await atomicWrite(resolve(directory, ".gitignore"), "*\n");
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(file);
    try {
      const version = db.prepare("PRAGMA user_version").get()?.user_version;
      if (version !== 0 && version !== 1)
        throw Error("Unsupported recovery database version");
      db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=0;",
      );
      db.exec(
        "CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS history (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL); PRAGMA user_version=1;",
      );
      await chmod(file, 0o600);
      const schema = JSON.parse(
        await readFile(
          fileURLToPath(
            new URL("../../docs/report.schema.json", import.meta.url),
          ),
          "utf8",
        ),
      ) as object;
      const validate = new Ajv({ strict: true }).compile(schema);
      return new RecoveryStore(db, validate);
    } catch (e) {
      db.close();
      throw e;
    }
  }
  read(): RecoveryView {
    const row = this.db
      .prepare("SELECT revision,payload FROM workspace WHERE id=1")
      .get();
    if (!row)
      return {
        revision: 0,
        drafts: [],
        context: null,
        error: null,
        enabled: true,
      };
    if (
      typeof row.payload !== "string" ||
      typeof row.revision !== "number" ||
      !Number.isSafeInteger(row.revision)
    )
      throw Error("Invalid recovery record");
    const workspace = workspaceSchema.parse(JSON.parse(row.payload) as unknown);
    return { ...workspace, revision: row.revision, error: null, enabled: true };
  }
  save(expectedRevision: number, value: unknown): RecoveryView {
    const parsed = workspaceSchema.parse(value),
      payload = json(parsed);
    if (Buffer.byteLength(payload) > 8 * 1024 * 1024)
      throw Error("Draft recovery exceeds 8 MiB");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.read();
      if (current.revision !== expectedRevision)
        throw new RecoveryConflict(
          "Draft recovery changed in another window or process. Your current buffer has been preserved.",
        );
      const revision = current.revision + 1;
      if (!Number.isSafeInteger(revision))
        throw Error("Recovery revision limit reached");
      this.db
        .prepare(
          "INSERT INTO workspace(id,revision,payload) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload",
        )
        .run(revision, payload);
      this.db.exec("COMMIT");
      return { ...parsed, revision, error: null, enabled: true };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  saveRun(run: StudioRun): void {
    const payload = json({ ...run, request: { ...run.request, buffers: {} } });
    if (Buffer.byteLength(payload) > 16 * 1024 * 1024)
      throw Error(
        "Run is too large for automatic history. Export its report to keep it.",
      );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO history(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
        )
        .run(run.id, payload);
      this.db.exec(
        "DELETE FROM history WHERE sequence NOT IN (SELECT sequence FROM history ORDER BY sequence DESC LIMIT 3)",
      );
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  runs(): StudioRun[] {
    return this.db
      .prepare("SELECT payload FROM history ORDER BY sequence DESC LIMIT 3")
      .all()
      .map((row) => {
        if (typeof row.payload !== "string") throw Error("Invalid saved run");
        const data: unknown = JSON.parse(row.payload);
        if (!data || typeof data !== "object") throw Error("Invalid saved run");
        const r = data as Record<string, unknown>;
        const span = z
          .object({
            file: z.string(),
            start: z.number().int().min(0),
            end: z.number().int().min(0),
          })
          .refine((v) => v.end >= v.start);
        const symbol = z.object({
          id: z.string(),
          name: z.string(),
          kind: z.string(),
          span,
          signature: z.string(),
          references: z.array(span).optional(),
          callable: z.custom(isCallableShape).optional(),
          machineDomains: z.record(z.string(), z.string()).optional(),
          states: z.array(z.string()).optional(),
          terminal: z.array(z.string()).optional(),
          initial: z.string().optional(),
          transitions: z
            .array(z.object({ from: z.string(), to: z.string() }))
            .optional(),
        });
        const request = z.object({
          clientId: z.string(),
          revision: z.number().int(),
          file: z.string(),
          buffers: z.record(z.string(), z.string()),
          kind: z.enum(["check", "simulate", "verify"]),
          entry: z.string(),
          seed: z.string(),
          maxSteps: z.number().int(),
          maxSamples: z.number().int(),
          scope: z.record(z.string(), z.unknown()).optional(),
          timeoutMs: z.number().optional(),
        });
        const checked = z
          .object({
            id: z.string(),
            sequence: z.number().int().min(0),
            request,
            status: z.enum([
              "running",
              "completed",
              "cancelled",
              "superseded",
              "failed",
            ]),
            phase: z.string(),
            report: z
              .unknown()
              .refine((value) => value === null || this.validateReport(value)),
            symbols: z.array(symbol),
            error: z.string().nullable(),
            persistenceError: z.string().optional(),
          })
          .parse(r);
        const run = checked as StudioRun;
        if (run.status === "running") {
          run.status = "cancelled";
          run.phase = "interrupted";
          run.error =
            "The previous Studio session ended before this run finished. It was not a pass.";
          if (run.report) run.report.session.state = "Cancelled";
        }
        return run;
      });
  }
  close() {
    this.db.close();
  }
}
