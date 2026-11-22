// SPDX-License-Identifier: MIT
import { errorMessage } from "../shared/error-message.js";
import { ObservationInputError } from "../implementation/capture.js";
import { ZodError } from "zod";
import { decodeUtf8 } from "../shared/text.js";
import { implementationCheckOptionsSchema } from "../contracts/implementation-check.js";
import {
  sourceContractRequestSchema,
  sourceTargetsSchema,
} from "../shared/source-contracts.js";
import { setupProject } from "../project/setup.js";
import { importResolutionSchema } from "../architecture/schema.js";
import { projectSetupSchema } from "../shared/project-setup.js";
import { findWorkspace } from "../project/workspace.js";
import { OutputRegistry } from "../contracts/registry.js";
import { ArchitectureConflict } from "../architecture/import-merge.js";
import {
  isScaffoldBodyMode,
  isOutputMode,
  defaultScaffoldBodyMode,
  isOutputTarget,
} from "../shared/outputs.js";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { hash, json } from "../shared/identity.js";
import { StudioService, StudioError } from "./service.js";
import type { RunRequest } from "./protocol.js";
import { formatSource } from "../language/format.js";
import { scenario } from "../shared/config.js";
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function request(value: unknown): RunRequest {
  if (
    !object(value) ||
    typeof value.clientId !== "string" ||
    value.clientId.length > 100 ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    typeof value.file !== "string" ||
    !object(value.buffers) ||
    !Object.values(value.buffers).every((v) => typeof v === "string") ||
    !["check", "simulate", "verify"].includes(String(value.kind)) ||
    typeof value.entry !== "string" ||
    typeof value.seed !== "string" ||
    !/^\d{1,18}$/.test(value.seed) ||
    !Number.isSafeInteger(value.maxSteps) ||
    Number(value.maxSteps) < 1 ||
    Number(value.maxSteps) > 10000 ||
    !Number.isSafeInteger(value.maxSamples) ||
    Number(value.maxSamples) < 1 ||
    Number(value.maxSamples) > 100000
  )
    throw new StudioError(400, "Invalid run request");
  const settings = scenario({
    file: value.file,
    entry: value.entry || "local",
    seed: value.seed,
    maxSteps: value.maxSteps,
    maxSamples: value.maxSamples,
    ...(value.timeoutMs !== undefined ? { timeoutMs: value.timeoutMs } : {}),
    ...(value.scope !== undefined ? { scope: value.scope } : {}),
  });
  return {
    ...value,
    scope: settings.scope,
    timeoutMs: settings.timeoutMs,
  } as unknown as RunRequest;
}
async function body(
  req: IncomingMessage,
  maxBytes = 8 * 1024 * 1024,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new StudioError(413, "Request exceeds 8 MiB");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    ) as unknown;
  } catch {
    throw new StudioError(400, "Invalid JSON or UTF-8");
  }
}
export async function startStudio(options: {
  path: string;
  port?: number;
  assets?: string;
  outputRegistry?: OutputRegistry;
}): Promise<{
  url: string;
  token: string;
  service: StudioService;
  close: () => Promise<void>;
}> {
  const input = await realpath(options.path);
  const root =
    (await findWorkspace(input))?.root ??
    ((await stat(input)).isDirectory() ? input : resolve(input, ".."));
  const service = new StudioService(
      root,
      (await stat(input)).isFile() ? relative(root, input) : null,
      options.outputRegistry ?? OutputRegistry.empty(),
    ),
    token = randomBytes(32).toString("hex"),
    assets =
      options.assets ??
      fileURLToPath(new URL("../../dist-web/", import.meta.url));
  let setupPreview: {
    token: string;
    files: { path: string; hash: string }[];
    result: import("../shared/project-setup.js").ProjectSetup;
  } | null = null;
  await service.initializeRecovery();
  const streams = new Set<ServerResponse>();
  let origin = "";
  const server = createServer((req, res) => {
    void (async () => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
      );
      res.setHeader("Cache-Control", "no-store");
      if (req.headers.host !== new URL(origin).host)
        throw new StudioError(403, "Unexpected host");
      if (req.headers.origin && req.headers.origin !== origin)
        throw new StudioError(403, "Cross-origin request rejected");
      const url = new URL(req.url ?? "/", origin);
      const send = (value: unknown, status = 200): void => {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(json(value));
      };
      if (url.pathname.startsWith("/api/")) {
        const auth = req.headers.authorization ?? "",
          expected = "Bearer " + token;
        if (
          auth.length !== expected.length ||
          !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))
        )
          throw new StudioError(401, "Studio session token required");
        if (req.method === "POST" && url.pathname === "/api/try-inputs") {
          const data = await body(req);
          if (
            !object(data) ||
            typeof data.id !== "string" ||
            typeof data.entry !== "string" ||
            !object(data.inputs)
          )
            throw new StudioError(400, "Choose a checked flow and its inputs");
          const cancel = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) cancel.abort();
          });
          return send(
            await service.tryInputs(
              data.id,
              data.entry,
              data.inputs,
              cancel.signal,
            ),
          );
        }
        if (req.method === "GET" && url.pathname === "/api/source")
          return send(
            await service.sourceFile(url.searchParams.get("file") ?? ""),
          );
        if (
          req.method === "GET" &&
          url.pathname === "/api/implementation/versions"
        )
          return send(
            await service.implementationVersions(
              Number(url.searchParams.get("offset") ?? 0),
              Number(url.searchParams.get("limit") ?? 50),
              Object.fromEntries(
                ["query", "category", "selectedId", "catalogHash"].flatMap(
                  (key) =>
                    url.searchParams.has(key)
                      ? [[key, url.searchParams.get(key)]]
                      : [],
                ),
              ),
            ),
          );
        if (req.method === "POST" && url.pathname === "/api/implementation") {
          const abort = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) abort.abort();
          });
          return send(
            await service.implementationGraph(await body(req), abort.signal),
          );
        }
        if (
          req.method === "POST" &&
          url.pathname === "/api/implementation/compare"
        ) {
          const abort = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) abort.abort();
          });
          return send(
            await service.implementationComparison(
              await body(req),
              abort.signal,
            ),
          );
        }
        if (
          req.method === "POST" &&
          url.pathname === "/api/implementation/files"
        ) {
          const abort = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) abort.abort();
          });
          return send(
            await service.implementationFiles(await body(req), abort.signal),
          );
        }
        if (
          req.method === "POST" &&
          [
            "/api/implementation/observe",
            "/api/implementation/link",
            "/api/implementation/unlink",
          ].includes(url.pathname)
        ) {
          const abort = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) abort.abort();
          });
          const data = await body(req);
          return send(
            url.pathname.endsWith("/observe")
              ? await service.observeImplementation(data, abort.signal)
              : url.pathname.endsWith("/unlink")
                ? await service.unlinkImplementation(data, abort.signal)
                : await service.linkImplementation(data, abort.signal),
          );
        }
        if (
          req.method === "GET" &&
          url.pathname === "/api/architecture/source-contracts"
        ) {
          const cancel = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) cancel.abort();
          });
          return send(
            await service.sourceContractPage(
              {
                ...(url.searchParams.has("snapshotId")
                  ? { snapshotId: url.searchParams.get("snapshotId")! }
                  : {}),
                ...(url.searchParams.has("file")
                  ? { file: url.searchParams.get("file")! }
                  : {}),
                query: url.searchParams.get("q") ?? "",
                offset: Number(url.searchParams.get("offset") ?? 0),
                limit: Number(url.searchParams.get("limit") ?? 20),
                targets: url.searchParams.has("targets")
                  ? sourceTargetsSchema.parse(
                      JSON.parse(url.searchParams.get("targets")!),
                    )
                  : undefined,
              },
              cancel.signal,
            ),
          );
        }
        if (
          req.method === "POST" &&
          url.pathname === "/api/architecture/source-selection"
        ) {
          const data = await body(req);
          if (!object(data) || typeof data.snapshotId !== "string")
            throw new StudioError(400, "Choose a checked source snapshot.");
          return send(
            service.sourceSelection(
              data.snapshotId,
              sourceTargetsSchema.parse(data.targets),
            ),
          );
        }
        if (
          req.method === "POST" &&
          url.pathname === "/api/architecture/source-contract"
        ) {
          const parsed = sourceContractRequestSchema.safeParse(await body(req));
          if (!parsed.success)
            throw new StudioError(
              400,
              "Choose a source target and its checked snapshot",
            );
          const cancel = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) cancel.abort();
          });
          return send(
            await service.sourceContractDetail(parsed.data, cancel.signal),
          );
        }
        if (req.method === "GET" && url.pathname === "/api/architecture/draft")
          return send(await service.architectureDraft());
        if (req.method === "GET" && url.pathname === "/api/architecture")
          return send(
            await service.architectureOverview(
              url.searchParams.get("revision") ?? undefined,
            ),
          );
        if (
          req.method === "GET" &&
          url.pathname === "/api/architecture/review-history"
        )
          return send(
            await service.branchReviewHistory(
              url.searchParams.get("revision") ?? "",
              Number(url.searchParams.get("offset") ?? 0),
              Number(url.searchParams.get("limit") ?? 20),
            ),
          );
        if (
          req.method === "GET" &&
          url.pathname === "/api/architecture/withdrawals"
        )
          return send(
            await service.branchWithdrawalHistory(
              url.searchParams.get("id") ?? "",
              Number(url.searchParams.get("offset") ?? 0),
              Number(url.searchParams.get("limit") ?? 20),
            ),
          );
        if (req.method === "GET" && url.pathname === "/api/architecture/work") {
          const cancel = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) cancel.abort();
          });
          return send(
            await service.architectureWork(
              url.searchParams.get("revision") ?? "",
              cancel.signal,
            ),
          );
        }
        if (req.method === "GET" && url.pathname === "/api/architecture/search")
          return send(
            await service.searchArchitecture(
              url.searchParams.get("revision") ?? "",
              url.searchParams.get("q") ?? "",
            ),
          );
        if (
          req.method === "GET" &&
          url.pathname === "/api/architecture/search-page"
        )
          return send(
            await service.searchArchitecturePage(
              url.searchParams.get("revision") ?? "",
              url.searchParams.get("q") ?? "",
              Number(url.searchParams.get("offset") ?? 0),
              Number(url.searchParams.get("limit") ?? 100),
            ),
          );
        if (req.method === "GET" && url.pathname === "/api/architecture/record")
          return send(
            await service.architectureRecord(
              url.searchParams.get("revision") ?? "",
              url.searchParams.get("id") ?? "",
            ),
          );
        if (
          req.method === "GET" &&
          url.pathname === "/api/architecture/document"
        )
          return send(
            await service.architectureDocument(
              url.searchParams.get("revision") ?? "",
              url.searchParams.get("path") ?? "",
            ),
          );
        if (
          req.method === "GET" &&
          url.pathname === "/api/architecture/history"
        )
          return send(await service.exportArchitectureHistory());
        if (req.method === "GET" && url.pathname === "/api/architecture/export")
          return send(
            await service.exportArchitecture(
              url.searchParams.get("revision") ?? "",
            ),
          );
        if (
          req.method === "GET" &&
          url.pathname === "/api/architecture/compare"
        )
          return send(
            await service.compareArchitecture(
              url.searchParams.get("current") ?? "",
              url.searchParams.get("previous") ?? "",
            ),
          );
        if (
          req.method === "POST" &&
          url.pathname.startsWith("/api/architecture/")
        ) {
          const data = await body(req, 70 * 1024 * 1024);
          if (url.pathname === "/api/architecture/draft") {
            if (!object(data) || !Number.isSafeInteger(data.version))
              throw new StudioError(400, "Draft revision is required");
            return send(
              await service.saveArchitectureDraft(
                Number(data.version),
                data.draft,
              ),
            );
          }
          if (url.pathname === "/api/architecture/import-commit") {
            if (!object(data) || typeof data.token !== "string")
              throw new StudioError(400, "Import preview token is required");
            const cancel = new AbortController();
            res.on("close", () => {
              if (!res.writableEnded) cancel.abort();
            });
            return send(
              await service.commitPreparedArchitectureImport(
                data.token,
                cancel.signal,
              ),
            );
          }
          if (
            url.pathname === "/api/architecture/history-preview" ||
            url.pathname === "/api/architecture/history-commit"
          ) {
            const cancel = new AbortController();
            res.on("close", () => {
              if (!res.writableEnded) cancel.abort();
            });
            if (url.pathname.endsWith("preview"))
              return send(
                await service.previewArchitectureHistory(data, cancel.signal),
              );
            if (!object(data) || typeof data.token !== "string")
              throw new StudioError(400, "History preview is required");
            return send(
              await service.commitArchitectureHistory(
                data.token,
                cancel.signal,
              ),
            );
          }
          if (url.pathname === "/api/architecture/history") {
            const cancel = new AbortController();
            res.on("close", () => {
              if (!res.writableEnded) cancel.abort();
            });
            return send(
              await service.importArchitectureHistory(data, cancel.signal),
            );
          }
          if (
            url.pathname === "/api/architecture/review-branch" ||
            url.pathname === "/api/architecture/withdraw-review"
          ) {
            if (
              !object(data) ||
              typeof data.tip !== "string" ||
              typeof data.active !== "string"
            )
              throw new StudioError(400, "Choose a branch and current version");
            if (
              (data.reviewer !== undefined &&
                (typeof data.reviewer !== "string" ||
                  data.reviewer.length > 200)) ||
              (data.reason !== undefined &&
                (typeof data.reason !== "string" || data.reason.length > 4000))
            )
              throw new StudioError(
                400,
                "Keep the reviewer under 200 characters and review notes under 4,000",
              );
            const metadata = {
              ...(typeof data.reviewer === "string"
                ? { reviewer: data.reviewer }
                : {}),
              ...(typeof data.reason === "string"
                ? { reason: data.reason }
                : {}),
            };
            const cancel = new AbortController();
            res.on("close", () => {
              if (!res.writableEnded) cancel.abort();
            });
            return send(
              url.pathname.endsWith("withdraw-review")
                ? await service.withdrawArchitectureReview(
                    data.tip,
                    data.active,
                    cancel.signal,
                    metadata,
                  )
                : await service.reviewArchitectureBranch(
                    data.tip,
                    data.active,
                    cancel.signal,
                    metadata,
                  ),
            );
          }
          if (!object(data) || typeof data.label !== "string")
            throw new StudioError(400, "Name this architecture revision");
          const cancel = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) cancel.abort();
          });
          if (url.pathname === "/api/architecture/import-preview")
            return send(
              await service.previewArchitectureImport(
                data.label,
                data,
                cancel.signal,
              ),
            );
          if (url.pathname === "/api/architecture/import") {
            if (data.bundle)
              return send(
                await service.importArchitectureBundle(
                  data.label,
                  data.bundle,
                  cancel.signal,
                ),
              );
            if (!Array.isArray(data.documents))
              throw new StudioError(400, "Choose documents to import");
            return send(
              await service.importArchitecture(
                data.label,
                data.documents as import("../architecture/schema.js").ArchitectureDocument[],
                cancel.signal,
              ),
            );
          }
          if (url.pathname === "/api/architecture/checkpoint") {
            if (typeof data.revision !== "string")
              throw new StudioError(
                400,
                "Choose the current architecture version",
              );
            return send(
              await service.nameArchitectureVersion(
                data.revision,
                data.label,
                cancel.signal,
              ),
            );
          }
          if (url.pathname === "/api/architecture/plan") {
            if (typeof data.revision !== "string")
              throw new StudioError(400, "Previous revision is required");
            if (
              data.target !== undefined &&
              (!object(data.target) ||
                typeof data.target.document !== "string" ||
                typeof data.target.originalId !== "string" ||
                (data.target.itemIndex !== undefined &&
                  (!Number.isSafeInteger(data.target.itemIndex) ||
                    Number(data.target.itemIndex) < 0)))
            )
              throw new StudioError(400, "Planning record source is invalid");
            return send(
              await service.savePlanItem(
                data.revision,
                data.item,
                data.label,
                cancel.signal,
                data.target as
                  | {
                      document: string;
                      originalId: string;
                      itemIndex?: number | undefined;
                    }
                  | undefined,
              ),
            );
          }
          if (url.pathname === "/api/architecture/document") {
            if (
              typeof data.revision !== "string" ||
              typeof data.path !== "string" ||
              typeof data.text !== "string"
            )
              throw new StudioError(
                400,
                "Document and previous revision are required",
              );
            return send(
              await service.editArchitectureDocument(
                data.revision,
                data.path,
                data.text,
                data.label,
                cancel.signal,
                data.createOnly === true,
              ),
            );
          }
        }
        if (
          req.method === "POST" &&
          url.pathname === "/api/project/initialize"
        ) {
          const data = await body(req);
          if (
            !object(data) ||
            Object.keys(data).some(
              (key) =>
                ![
                  "name",
                  "importDocuments",
                  "previewToken",
                  "resolutions",
                  "allowBrokenLinks",
                  "trust",
                ].includes(key),
            ) ||
            (data.trust !== undefined &&
              data.trust !== "trusted" &&
              data.trust !== "source-only") ||
            (data.name !== undefined && typeof data.name !== "string") ||
            (data.importDocuments !== undefined &&
              typeof data.importDocuments !== "boolean") ||
            (data.allowBrokenLinks !== undefined &&
              typeof data.allowBrokenLinks !== "boolean")
          )
            throw new StudioError(
              400,
              "Choose a project name and an explicit documentation import option",
            );
          const abort = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) abort.abort();
          });
          if (data.importDocuments === true || data.resolutions !== undefined) {
            const prepared = setupPreview;
            if (!prepared || data.previewToken !== prepared.token)
              throw new StudioError(
                409,
                "Review the project documentation preview before importing it.",
              );
            for (const file of prepared.files) {
              abort.signal.throwIfAborted();
              try {
                if (
                  hash(
                    decodeUtf8(
                      await readFile(resolve(root, file.path)),
                      file.path,
                    ),
                  ) !== file.hash
                )
                  throw Error("changed");
              } catch {
                throw new StudioError(
                  409,
                  "Documentation changed after this preview. Review project setup again before importing.",
                );
              }
            }
            if (data.importDocuments === true) {
              if (prepared.result.documentation.review?.conflicts.length)
                throw new StudioError(
                  409,
                  "Resolve each document conflict before importing.",
                );
              if (
                prepared.result.documentation.review?.newlyBrokenAuthoredLinks
                  .length &&
                !data.allowBrokenLinks
              )
                throw new StudioError(
                  409,
                  "Review the broken planning links and explicitly accept them before importing.",
                );
              const current = await service.architectureOverview();
              const saved = await service.commitPreparedArchitectureImport(
                prepared.token,
                abort.signal,
              );
              setupPreview = null;
              return send(
                projectSetupSchema.parse({
                  ...prepared.result,
                  documentation: {
                    ...prepared.result.documentation,
                    previewToken: undefined,
                    status:
                      saved.id === current.activeRevision
                        ? "unchanged"
                        : "imported",
                    committed: saved.id !== current.activeRevision,
                    revision: saved.id,
                  },
                }),
              );
            }
          }
          const captured: {
            token: string;
            files: { path: string; hash: string }[];
          }[] = [];
          setupPreview = null;
          const result = projectSetupSchema.parse(
            await setupProject(
              root,
              typeof data.name === "string" ? data.name : undefined,
              false,
              abort.signal,
              {
                service,
                // D22: the setup dialog's answer; none records nothing.
                ...(data.trust === "trusted" || data.trust === "source-only"
                  ? { trust: data.trust }
                  : {}),
                resolutions:
                  data.resolutions === undefined
                    ? []
                    : importResolutionSchema.array().parse(data.resolutions),
                onPreview: (preview) => {
                  captured.push({
                    token: preview.token,
                    files: preview.documents.map((d) => ({
                      path: d.path,
                      hash: hash(d.text),
                    })),
                  });
                },
              },
            ),
          );
          const capture = captured.at(-1);
          if (capture) setupPreview = { ...capture, result };
          return send(result);
        }
        if (req.method === "GET" && url.pathname === "/api/project")
          return send(await service.project());
        if (req.method === "GET" && url.pathname === "/api/events") {
          res.writeHead(200, { "Content-Type": "application/x-ndjson" });
          res.write(json({ kind: "connected" }).replace(/\n/g, "") + "\n");
          streams.add(res);
          const unsubscribe = service.subscribe((event) => {
            if (!res.destroyed)
              res.write(
                JSON.stringify(event, (_, v: unknown) =>
                  typeof v === "bigint" ? String(v) : v,
                ) + "\n",
              );
          });
          req.on("close", () => {
            streams.delete(res);
            unsubscribe();
          });
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/recovery")
          return send(service.readRecovery());
        if (req.method === "POST" && url.pathname === "/api/recovery") {
          const data = await body(req);
          if (!object(data) || !Number.isSafeInteger(data.expectedRevision))
            throw new StudioError(400, "Expected recovery revision");
          return send(
            await service.saveRecovery(
              Number(data.expectedRevision),
              data.workspace,
              typeof data.owner === "string" && data.owner.length <= 120
                ? data.owner
                : null,
            ),
          );
        }
        if (
          req.method === "POST" &&
          url.pathname === "/api/implementation-check"
        ) {
          const data = await body(req);
          if (!object(data) || typeof data.id !== "string")
            throw new StudioError(400, "Choose a checked design.");
          const options = implementationCheckOptionsSchema.parse(data.options);
          const abort = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) abort.abort();
          });
          return send(
            await service.implementationCheck(data.id, options, abort.signal),
          );
        }
        if (req.method === "POST" && url.pathname === "/api/scaffold") {
          const data = await body(req);
          if (
            !object(data) ||
            typeof data.id !== "string" ||
            typeof data.target !== "string" ||
            !service.outputRegistry
              .targets()
              .some((t) => t.id === data.target) ||
            (data.body !== undefined && !isScaffoldBodyMode(data.body)) ||
            (data.mode !== undefined && !isOutputMode(data.mode))
          )
            throw new StudioError(400, "Choose a supported scaffold target");
          const abort = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) abort.abort();
          });
          return send(
            await service.scaffold(
              data.id,
              data.target,
              isScaffoldBodyMode(data.body)
                ? data.body
                : defaultScaffoldBodyMode,
              abort.signal,
              isOutputMode(data.mode) ? data.mode : "stubs",
            ),
          );
        }
        if (req.method === "POST" && url.pathname === "/api/run")
          return send(await service.start(request(await body(req))), 202);
        if (req.method === "POST" && url.pathname === "/api/cancel") {
          const data = await body(req);
          if (!object(data) || typeof data.id !== "string")
            throw new StudioError(400, "Expected run ID");
          service.cancel(data.id);
          return send({ cancelled: true });
        }
        if (req.method === "POST" && url.pathname === "/api/save") {
          const data = await body(req);
          if (
            !object(data) ||
            typeof data.path !== "string" ||
            typeof data.text !== "string" ||
            !(
              typeof data.expectedHash === "string" ||
              data.expectedHash === null
            )
          )
            throw new StudioError(400, "Invalid save request");
          return send(
            await service.save(data.path, data.text, data.expectedHash),
          );
        }
        if (req.method === "POST" && url.pathname === "/api/scenario") {
          const data = await body(req);
          if (
            !object(data) ||
            typeof data.name !== "string" ||
            !(
              typeof data.expectedHash === "string" ||
              data.expectedHash === null
            )
          )
            throw new StudioError(400, "Invalid scenario save");
          return send(
            await service.saveScenario(
              data.name,
              data.scenario,
              data.expectedHash,
            ),
          );
        }
        if (
          req.method === "POST" &&
          url.pathname === "/api/declaration/imports"
        ) {
          const value = await body(req);
          if (!object(value))
            throw new StudioError(400, "Invalid import validation request.");
          const abort = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) abort.abort();
          });
          return send(
            await service.validateDeclarationSources(
              value.sources,
              value.buffers,
              abort.signal,
            ),
          );
        }
        if (req.method === "POST" && url.pathname === "/api/declaration") {
          const data = await body(req);
          if (
            !object(data) ||
            typeof data.runId !== "string" ||
            typeof data.file !== "string"
          )
            throw new StudioError(400, "Choose a checked source file.");
          if (
            data.action === "resource-context" &&
            typeof data.name === "string"
          )
            return send(
              await service.resourceContext(data.runId, data.file, data.name),
            );
          if (data.action === "types") {
            const abort = new AbortController();
            res.on("close", () => {
              if (!res.writableEnded) abort.abort();
            });
            return send(
              await service.declarationTypes(
                data.runId,
                data.query ?? {},
                abort.signal,
              ),
            );
          }
          if (data.action === "context")
            return send(
              await service.declarationContext(data.runId, data.file),
            );
          if (
            data.action === "preview" &&
            typeof data.sourceHash === "string"
          ) {
            const abort = new AbortController();
            res.on("close", () => {
              if (!res.writableEnded) abort.abort();
            });
            return send(
              await service.previewDeclaration(
                data.runId,
                data.file,
                data.declaration,
                data.sourceHash,
                data.typeSelections ?? [],
                abort.signal,
              ),
            );
          }
          throw new StudioError(
            400,
            "Choose a declaration action and checked snapshot.",
          );
        }
        if (req.method === "POST" && url.pathname === "/api/blocks") {
          const data = await body(req);
          if (
            !object(data) ||
            typeof data.runId !== "string" ||
            typeof data.file !== "string"
          )
            throw new StudioError(400, "Choose a checked source file.");
          return send(await service.blockDocument(data.runId, data.file));
        }
        if (req.method === "POST" && url.pathname === "/api/interface") {
          const data = await body(req);
          if (
            object(data) &&
            data.action === "types" &&
            typeof data.runId === "string" &&
            typeof data.file === "string"
          )
            return send(service.interfaceTypes(data.runId, data.file));
          if (
            !object(data) ||
            typeof data.runId !== "string" ||
            typeof data.symbolId !== "string"
          )
            throw new StudioError(400, "Choose a checked interface.");
          if (data.action === "resume")
            return send(service.resumeInterface(data.runId, data.draft));
          if (data.action === "operation")
            return send(service.operationContract(data.runId, data.symbolId));
          if (
            data.action === "preview-operation" &&
            typeof data.sourceHash === "string"
          )
            return send(
              service.previewOperationContract(
                data.runId,
                data.symbolId,
                data.edit,
                data.sourceHash,
              ),
            );
          if (data.action === "resource")
            return send(service.interfaceResource(data.runId, data.symbolId));
          if (
            data.action === "preview-resource" &&
            typeof data.sourceHash === "string"
          )
            return send(
              service.previewResource(
                data.runId,
                data.symbolId,
                data.edit,
                data.sourceHash,
              ),
            );
          if (data.action === "type")
            return send(service.interfaceType(data.runId, data.symbolId));
          if (
            data.action === "preview-type" &&
            typeof data.sourceHash === "string"
          )
            return send(
              service.previewType(
                data.runId,
                data.symbolId,
                data.edit,
                data.sourceHash,
              ),
            );
          if (data.action === "describe")
            return send(service.describeInterface(data.runId, data.symbolId));
          if (data.action !== "preview" || typeof data.sourceHash !== "string")
            throw new StudioError(
              400,
              "Choose an interface action and source snapshot.",
            );
          return send(
            service.previewInterface(
              data.runId,
              data.symbolId,
              data.edit,
              data.sourceHash,
            ),
          );
        }
        if (req.method === "POST" && url.pathname === "/api/format") {
          const data = await body(req);
          if (
            !object(data) ||
            typeof data.text !== "string" ||
            typeof data.file !== "string"
          )
            throw new StudioError(400, "Expected source text and path");
          return send({
            text: formatSource(await service.path(data.file, true), data.text),
          });
        }
        if (req.method === "POST" && url.pathname === "/api/report") {
          const value = await body(req);
          const schema = JSON.parse(
            await readFile(
              fileURLToPath(
                new URL("../../docs/report.schema.json", import.meta.url),
              ),
              "utf8",
            ),
          ) as object;
          const validate = new Ajv({ allErrors: true }).compile(schema);
          if (!validate(value))
            throw new StudioError(400, "Invalid report schema");
          return send(value);
        }
        throw new StudioError(404, "Unknown API route");
      }
      if (req.method !== "GET")
        throw new StudioError(405, "Method not allowed");
      const name =
        url.pathname === "/"
          ? "index.html"
          : decodeURIComponent(url.pathname).slice(1);
      const path = await realpath(resolve(assets, name));
      if (relative(assets, path).startsWith(".."))
        throw new StudioError(403, "Asset outside public directory");
      res.setHeader(
        "Content-Type",
        (
          {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".svg": "image/svg+xml",
          } as Record<string, string>
        )[extname(path)] ?? "application/octet-stream",
      );
      res.end(await readFile(path));
    })().catch((error) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      res.statusCode =
        error instanceof StudioError || error instanceof ArchitectureConflict
          ? error.status
          : error instanceof ZodError || error instanceof ObservationInputError
            ? 400
            : error instanceof Error &&
                /database is locked|SQLITE_BUSY/i.test(error.message)
              ? 503
              : /Observed source file was not found|Use an offset|Invalid data:/.test(
                    errorMessage(error),
                  )
                ? 400
                : /64 MiB archive limit/.test(errorMessage(error))
                  ? 413
                  : 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        json({
          error:
            error instanceof ZodError
              ? "Invalid request: " +
                error.issues
                  .slice(0, 4)
                  .map(
                    (issue) =>
                      `${issue.path.join(".") || "request"}: ${issue.message}`,
                  )
                  .join("; ")
              : res.statusCode === 503
                ? "The architecture store is busy with another writer. Retry after that operation finishes; your request was not saved."
                : errorMessage(error) +
                  (res.statusCode === 413
                    ? " Export an individual revision from the selected snapshot instead. Whole-history export has no revision-subset option; existing history is preserved."
                    : ""),
          ...(res.statusCode === 409
            ? {
                conflictKind:
                  error instanceof ArchitectureConflict
                    ? "architecture"
                    : "request",
              }
            : {}),
        }),
      );
    });
  });
  await new Promise<void>((yes, no) => {
    server.once("error", no);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.removeListener("error", no);
      yes();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Missing server address");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: origin + "/#token=" + token,
    token,
    service,
    close: async () => {
      await service.close();
      for (const stream of streams) stream.end();
      server.closeAllConnections();
      await new Promise<void>((yes, no) =>
        server.close((e) => (e ? no(e) : yes())),
      );
    },
  };
}
