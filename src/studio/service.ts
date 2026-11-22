// SPDX-License-Identifier: MIT
import { sharedSourceLabel, sharedProjectPath } from "../storage/paths.js";
import { storagePath } from "../storage/local.js";
import { errorMessage } from "../shared/error-message.js";
import { decodeObservation } from "../implementation/storage.js";
import { implementationDesignPlans } from "../implementation/design-attention.js";
import {
  describeOperationContract,
  rewriteOperationContract,
} from "./operation-contract.js";
import { isAbsolute } from "node:path";
import {
  declarationTypeQuerySchema,
  type DeclarationTypeInventory,
} from "./declaration-type-protocol.js";
import { declarationTypePage } from "./declaration-type-inventory.js";
import { queryDeclarationTypes } from "../implementation/query-runner.js";
import { declarationTypeSelectionsSchema } from "./declaration-data.js";
import {
  previewDeclarationImports,
  normalizeDeclarationSymbols,
  DeclarationImportConflict,
} from "./declaration-imports.js";
import {
  describeResourceDefinition,
  rewriteResourceDefinition,
} from "./resource-authoring.js";
import {
  versionCatalog,
  VersionCatalogChanged,
} from "../implementation/versions.js";
import { versionCatalogQuerySchema } from "../implementation/protocol.js";
import { updateSourceBaselines } from "../architecture/source-baselines.js";
import {
  checkoutTrust,
  initializeBeforeWrite,
  readWorkspace,
} from "../project/workspace.js";
import { captureImplementation } from "../implementation/capture.js";
import { ImplementationFileCatalog } from "../implementation/files.js";
import { implementationComparisonQuerySchema } from "../implementation/comparison-protocol.js";
import {
  queryImplementationComparison,
  queryImplementation,
} from "../implementation/query-runner.js";
import {
  bindingsPath,
  implementationBindingsSchema,
  readImplementation,
  readImplementationDocuments,
  retainObservation,
  bindImplementation,
  unlinkImplementation,
  implementationPage,
  observationSource,
  observationPath,
} from "../implementation/workspace.js";
import { sourceCatalogue as projectSourceCatalogue } from "../architecture/source-contracts.js";
import {
  captureCodeSchema,
  bindCodeSchema,
  unlinkCodeSchema,
  implementationQuerySchema,
} from "../implementation/protocol.js";
import { describeBlocks } from "./block-model.js";
import { readSourceBytes, SourceReadError } from "../shared/source-read.js";
import { preserveInventoryLocation } from "../architecture/import-policy.js";
import { sourcePlanningIssues } from "../architecture/source-work.js";
import {
  sourceExpectations,
  retainSourceCatalogue,
  sourceExpectationHash,
  sourceReplacementCandidates,
  sourceDependencyPaths,
  type SourceCatalogue,
} from "../architecture/source-contracts.js";
import {
  sourceContractsPath,
  sourceCatalogueSchema,
  sourceSelectionSchema,
  type SourceSelection,
} from "../shared/source-contracts.js";
import { sourceIncluded } from "../language/source-selection.js";
import {
  sourceDirectoryExcluded,
  directoryMayContainSource,
} from "../shared/source-policy.js";
import { decodeUtf8 } from "../shared/text.js";
import { textPage } from "../shared/text-pages.js";
import { setImmediate as yieldToCoordinator } from "node:timers/promises";
import { bundleContentMatches } from "../architecture/manifest.js";
import {
  describeSignature,
  describeInterfaceTypes,
  describeTypeDefinition,
  resumeSignature,
  rewriteSignature,
} from "./signature.js";
import { readSignatureEdit, readInterfaceDraft } from "./interface-data.js";
import {
  createDeclaration,
  declarationContext,
} from "./declaration-authoring.js";
import { rewriteType } from "./type-edit.js";
import { OutputRegistry } from "../contracts/registry.js";
import {
  emitImplementationCheck,
  type ImplementationCheckOptions,
} from "../contracts/implementation-check.js";
import {
  defaultScaffoldBodyMode,
  type ScaffoldBodyMode,
} from "../shared/outputs.js";
import {
  ArchitectureConflict,
  mergeArchitectureImport,
  withNativeDocuments,
  sourceRegistry,
  sourceRegistryPath,
  nativePlanPath,
  type ImportSource,
} from "../architecture/import-merge.js";
import { validateHistory } from "../architecture/history.js";
import { fieldChanges, changedText } from "../architecture/diff.js";
import { headingRegistryPath } from "../architecture/headings.js";
import { planningIntegrityRegression } from "../architecture/planning-integrity.js";
import {
  openArchitectureWork,
  authoredDocuments,
  projectEvidenceSnapshot,
  forkReviewTargets,
  newlyBrokenAuthoredLinks,
} from "../architecture/work.js";
import { tryFlowInWorker } from "../behaviour/trial-runner.js";
import { ArchitectureStore } from "../architecture/store.js";
import {
  architectureImpact,
  architectureDetail,
  affectedEntities,
  compareArchitecture,
} from "../architecture/model.js";
import {
  indexInWorker,
  historyInWorker,
  prepareAndIndexInWorker,
} from "../architecture/runner.js";
import {
  importSourceSchema,
  importPreviewSchema,
  importResolutionSchema,
  documentSchema,
  planItemSchema,
  planSchema,
  bundleSchema,
  type ArchitectureDocument,
} from "../architecture/schema.js";
import { realpath, readdir, readFile, stat, mkdir } from "node:fs/promises";
import { relative, resolve, sep, extname, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { analyseInWorker } from "../cli/coordinator.js";
import { runBackend } from "../backends/adapter.js";
import { staleSourcesAsync, sourceFileByteLimit } from "../language/project.js";
import { hash, identity, json } from "../shared/identity.js";
import { atomicWrite } from "../reporting/publish.js";
import {
  callable,
  typeKey,
  type Type,
  type ProjectIR,
} from "../semantic/core.js";
import type {
  ProjectView,
  RunRequest,
  StudioEvent,
  StudioFile,
  StudioRun,
  SymbolView,
} from "./protocol.js";
import { valueShape, guidedShapeLimits } from "./shapes.js";
import {
  contractDocument,
  type ContractDocument,
} from "../contracts/document.js";
import { emitDocument, type BuiltinTarget } from "../contracts/scaffold.js";
import { nodeKey } from "../language/ast.js";
import { scenario } from "../shared/config.js";
import type { RecoveryStore, RecoveryView } from "./recovery.js";
import { loadConfig } from "../project/config.js";
export class StudioError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export class StudioService {
  /** MCP and link commands: initialise an uninitialised project (as
   * `pymtheg init` would) before the first architecture write. */
  initializeOnFirstWrite = false;
  /**
   * D22: the trust answer the first write's initialisation records, set by
   * a caller for one write (MCP's observe/link_implementation), so a
   * project is initialised only once that write proceeds.
   */
  firstWriteTrust: import("../shared/config.js").ProjectTrust | undefined;
  private sourceCatalogues = new Map<string, SourceCatalogue>();
  private sourceCatalogueFiles = new Map<
    string,
    { file: string; hash: string }[]
  >();
  private sourceCatalogueKey: { key: string; id: string } | null = null;
  async captureSourceContracts(
    signal: AbortSignal,
    file?: string,
    selection?: { project: ProjectView; additionalFiles: string[] },
  ): Promise<SourceCatalogue> {
    if (this.closed) throw new StudioError(503, "Studio is closing");
    const abort = new AbortController();
    const combined = AbortSignal.any([signal, abort.signal]);
    const job = { abort, done: Promise.resolve<unknown>(null) };
    const work = (async (): Promise<SourceCatalogue> => {
      const project = selection?.project ?? (await this.project());
      combined.throwIfAborted();
      const scopeFile =
        file ??
        (project.files.length > 2048 ? project.files[0]?.path : undefined);
      const key = hash(
        json({
          files: project.files.map((f) => [f.path, f.hash]),
          config: project.configHash,
          scopeFile,
          additionalFiles: selection?.additionalFiles,
        }),
      );
      const previous =
        this.sourceCatalogueKey?.key === key
          ? this.sourceCatalogues.get(this.sourceCatalogueKey.id)
          : undefined;
      const knownHashes = new Map(
        project.files.map((source) => [source.path, source.hash]),
      );
      if (
        previous &&
        this.sourceCatalogueFiles.has(previous.snapshotId) &&
        previous.entries.every(
          (entry) => knownHashes.get(entry.file) === entry.sourceHash,
        ) &&
        (!scopeFile || !!knownHashes.get(scopeFile)) &&
        !(
          await staleSourcesAsync(
            this.sourceCatalogueFiles.get(previous.snapshotId)!,
            combined,
          )
        ).length
      )
        return previous;
      const entry = scopeFile ?? project.files[0]?.path;
      if (!entry) {
        const empty: SourceCatalogue = {
          schema: "pymtheg.source-contracts/v1",
          snapshotId: hash("empty source catalogue"),
          entries: [],
          dependencies: [],
          incompleteFiles: [],
          diagnostics: (project.inventoryWarnings ?? []).map((message) => ({
            file: ".",
            code: "L003",
            message,
          })),
          meaning:
            "No readable source is available. This is not a verification result.",
        };
        this.sourceCatalogues.set(empty.snapshotId, empty);
        this.sourceCatalogueKey = { key, id: empty.snapshotId };
        return empty;
      }
      const checked = await analyseInWorker({
        file: await this.path(entry),
        signal: combined,
        workerData: {
          root: this.root,
          projectWide: !scopeFile,
          sourcePolicy: project.config.sources,
          sourceContracts: true,
          additionalEntries: await Promise.all(
            (selection?.additionalFiles ?? []).map((path) => this.path(path)),
          ),
        },
      });
      combined.throwIfAborted();
      if (!checked.ir)
        throw new StudioError(
          409,
          checked.report.diagnostics[0]?.message ??
            "Source catalogue could not be checked",
        );
      const catalogue = checked.sourceCatalogue;
      if (!catalogue)
        throw new StudioError(500, "Source worker returned no catalogue");
      combined.throwIfAborted();
      if ((await loadConfig(this.root)).hash !== project.configHash)
        throw new StudioError(
          409,
          "Project configuration changed during source capture. Refresh the source choices.",
        );
      if (
        (await staleSourcesAsync(checked.ir.snapshot.sources, combined)).length
      )
        throw new StudioError(
          409,
          "Source changed during catalogue capture. Refresh the source choices.",
        );
      catalogue.diagnostics.push(
        ...(project.inventoryWarnings ?? []).map((message) => ({
          file: ".",
          code: "L003",
          message,
        })),
      );
      if (scopeFile)
        catalogue.diagnostics.push({
          file: scopeFile,
          code: "scope",
          message: selection?.additionalFiles.length
            ? `Source choices cover ${selection.additionalFiles.length + 1} selected source files and their shared import closure.`
            : `Source choices cover ${scopeFile} and its imports. Choose another source file for other components.`,
        });
      if (Buffer.byteLength(json(catalogue)) > 32 * 1024 * 1024)
        throw new StudioError(
          413,
          "Source catalogue exceeds 32 MiB; select a smaller source file or narrow the project sources.",
        );
      this.sourceCatalogues.set(catalogue.snapshotId, catalogue);
      this.sourceCatalogueFiles.set(
        catalogue.snapshotId,
        checked.ir.snapshot.sources.map((source) => ({
          file: source.file,
          hash: source.hash,
        })),
      );
      while (this.sourceCatalogueFiles.size > 3)
        this.sourceCatalogueFiles.delete(
          this.sourceCatalogueFiles.keys().next().value!,
        );
      while (this.sourceCatalogues.size > 3)
        this.sourceCatalogues.delete(
          this.sourceCatalogues.keys().next().value!,
        );
      this.sourceCatalogueKey = { key, id: catalogue.snapshotId };
      return catalogue;
    })();
    job.done = work;
    this.trials.add(job);
    try {
      return await work;
    } finally {
      this.trials.delete(job);
    }
  }
  async sourceContractPage(
    options: {
      snapshotId?: string;
      file?: string;
      query?: string;
      offset?: number;
      limit?: number;
      targets?: string[] | undefined;
    },
    signal: AbortSignal,
  ) {
    const offset = options.offset ?? 0,
      limit = options.limit ?? 20;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new StudioError(
        400,
        "Choose a nonnegative offset and a page of 1–100 source contracts",
      );
    if (offset && !options.snapshotId)
      throw new StudioError(
        400,
        "Continue source-contract pages with their snapshotId",
      );
    const catalogue = options.snapshotId
      ? this.sourceCatalogues.get(options.snapshotId)
      : options.targets?.length
        ? await this.captureSourceSelection(signal, options.targets)
        : await this.captureSourceContracts(signal, options.file);
    if (!catalogue)
      throw new StudioError(
        409,
        "This source catalogue has expired; refresh its first page",
      );
    const query = (options.query ?? "").toLowerCase();
    if (query.length > 256)
      throw new StudioError(400, "Source query exceeds 256 characters");
    const matches = catalogue.entries.filter((e) =>
      (e.name + " " + e.file + " " + e.id).toLowerCase().includes(query),
    );
    const items = [];
    let bytes = 0;
    for (const entry of matches.slice(offset, offset + limit)) {
      const { source, declaration, ...metadata } = entry;
      const size = Buffer.byteLength(json(metadata));
      if (bytes + size > 96 * 1024) break;
      items.push(metadata);
      bytes += size;
    }
    if (offset < matches.length && !items.length)
      throw new StudioError(
        413,
        "This source contract metadata exceeds the page budget; inspect its source directly",
      );
    return {
      snapshotId: catalogue.snapshotId,
      meaning: catalogue.meaning,
      total: matches.length,
      offset,
      items,
      complete:
        catalogue.diagnostics.length === 0 &&
        catalogue.entries.every((e) => e.modelStatus === "checked"),
      nextOffset:
        offset + items.length < matches.length ? offset + items.length : null,
      notices: catalogue.diagnostics.slice(0, 20).map((d) => ({
        ...d,
        message:
          d.message.length > 1000 ? d.message.slice(0, 1000) + "…" : d.message,
      })),
      noticeCount: catalogue.diagnostics.length,
      incompleteFiles: catalogue.incompleteFiles.slice(0, 20),
      incompleteFileCount: catalogue.incompleteFiles.length,
    };
  }
  readonly runs: StudioRun[] = [];
  sourceSelection(snapshotId: string, targets: string[]): SourceSelection {
    const catalogue = this.sourceCatalogues.get(snapshotId);
    if (!catalogue)
      throw new StudioError(
        409,
        "The source choices expired. Refresh the components to select the current source.",
      );
    const entries = new Map(
      catalogue.entries.map((entry) => [entry.id, entry]),
    );
    if (
      targets.some(
        (id) =>
          !entries.has(id) || entries.get(id)!.modelStatus === "ambiguous",
      )
    )
      throw new StudioError(
        409,
        "A selected source component is missing or ambiguous. Remove its link or find a replacement before reviewing. Existing historical links can be saved without a new source review.",
      );
    const expectations = sourceExpectations(catalogue, targets);
    return sourceSelectionSchema.parse({
      schema: "pymtheg.source-selection/v1",
      targets,
      expectations,
      textHashes: Object.fromEntries(
        Object.keys(expectations).map((id) => [
          id,
          hash(entries.get(id)!.source),
        ]),
      ),
    });
  }
  private async sourceAttentionCatalogue(
    plans: Parameters<typeof sourcePlanningIssues>[0],
    signal: AbortSignal,
  ): Promise<SourceCatalogue | { unavailable: string }> {
    const project = await this.project();
    const files = [
      ...new Set(
        plans.flatMap((plan) =>
          plan.record.links
            .filter((link) => link.target.startsWith("source:"))
            .map((link) => link.target.slice(7, link.target.lastIndexOf("#"))),
        ),
      ),
    ].sort();
    const entries = new Map<string, SourceCatalogue["entries"][number]>();
    const dependencies = new Map<
      string,
      SourceCatalogue["dependencies"][number]
    >();
    const failures = new Map<string, string>(),
      missing = new Set<string>(),
      unstable = new Set<string>();
    const fileHashes = new Map<string, string>();
    let retainedBytes = 0;
    // A previously captured import can disappear without being a direct link.
    // Check its identity separately; failure to load a root is not evidence that
    // every recorded dependency is merely waiting for a syntax repair.
    const expectedFiles = new Set(
      plans.flatMap((plan) =>
        Object.keys(plan.record.sourceExpectations ?? {}).map((id) =>
          id.slice(7, id.lastIndexOf("#")),
        ),
      ),
    );
    const directFiles = new Set(files);
    for (const file of expectedFiles) {
      signal.throwIfAborted();
      if (directFiles.has(file)) continue;
      try {
        await this.path(file);
      } catch (error) {
        if (error instanceof StudioError && error.status === 404)
          missing.add(file);
        else
          failures.set(
            file,
            error instanceof Error ? error.message : String(error),
          );
      }
    }
    const capture = async (batch: string[]): Promise<void> => {
      signal.throwIfAborted();
      const present: string[] = [];
      for (const file of batch) {
        try {
          await this.path(file);
          present.push(file);
        } catch (error) {
          if (error instanceof StudioError && error.status === 404)
            missing.add(file);
          else
            failures.set(
              file,
              error instanceof Error ? error.message : String(error),
            );
        }
      }
      if (!present.length) return;
      try {
        const catalogue = await this.captureSourceContracts(
          signal,
          present[0],
          { project, additionalFiles: present.slice(1) },
        );
        const additions = catalogue.entries.filter(
          (entry) =>
            !entries.has(entry.id) ||
            entries.get(entry.id)!.sourceHash !== entry.sourceHash,
        );
        const newEdges = catalogue.dependencies
          .map((edge) => [json(edge), edge] as const)
          .filter(([key]) => !dependencies.has(key));
        const bytes =
          Buffer.byteLength(json(additions)) +
          newEdges.reduce((total, [key]) => total + Buffer.byteLength(key), 0);
        if (retainedBytes + bytes > 32 * 1024 * 1024) {
          for (const file of present)
            failures.set(
              file,
              "Source attention reached its 32 MiB evidence budget; narrow the selected plans.",
            );
          return;
        }
        retainedBytes += bytes;
        for (const entry of catalogue.entries) {
          if (
            fileHashes.has(entry.file) &&
            fileHashes.get(entry.file) !== entry.sourceHash
          )
            unstable.add(entry.file);
          fileHashes.set(entry.file, entry.sourceHash);
          entries.set(entry.id, entry);
        }
        for (const [key, edge] of newEdges) dependencies.set(key, edge);
        for (const file of catalogue.incompleteFiles)
          failures.set(file, "Source syntax is incomplete.");
        for (const diagnostic of catalogue.diagnostics)
          if (diagnostic.code !== "scope" && diagnostic.file !== ".")
            failures.set(diagnostic.file, diagnostic.message);
      } catch (error) {
        signal.throwIfAborted();
        if (present.length > 1) {
          const middle = Math.floor(present.length / 2);
          await capture(present.slice(0, middle));
          await capture(present.slice(middle));
        } else
          failures.set(
            present[0]!,
            error instanceof Error ? error.message : String(error),
          );
      }
    };
    for (let offset = 0; offset < files.length; offset += 32)
      await capture(files.slice(offset, offset + 32));
    for (const path of await staleSourcesAsync(
      [...fileHashes].map(([file, expected]) => ({
        file: resolve(this.root, file),
        hash: expected,
      })),
      signal,
    ))
      unstable.add(relative(this.root, path));
    if ((await loadConfig(this.root)).hash !== project.configHash)
      return {
        unavailable:
          "Project configuration changed during source attention; retry the check.",
      };
    for (const file of unstable)
      failures.set(
        file,
        "Source changed during this attention check; retry it.",
      );
    const catalogue: SourceCatalogue = {
      schema: "pymtheg.source-contracts/v1",
      snapshotId: hash(
        json(
          [...entries.values()].map((entry) => [entry.id, entry.snapshotId]),
        ),
      ),
      entries: [...entries.values()].map((entry) =>
        unstable.has(entry.file)
          ? { ...entry, modelStatus: "incomplete" }
          : entry,
      ),
      dependencies: [...dependencies.values()],
      missingFiles: [...missing],
      incompleteFiles: [...failures.keys()],
      diagnostics: [...failures].map(([file, message]) => ({
        file,
        code: "L003",
        message,
      })),
      meaning:
        "Source attention combines independently captured scopes. Each entry retains its snapshot; unavailable scopes do not erase other findings.",
    };
    return catalogue;
  }
  private async sourceAttention(
    plans: Parameters<typeof sourcePlanningIssues>[0],
    signal: AbortSignal,
  ) {
    return sourcePlanningIssues(
      plans,
      await this.sourceAttentionCatalogue(plans, signal),
    );
  }
  private async implementationDesignAttention(
    plan: Parameters<typeof queryImplementation>[0],
    store: ArchitectureStore,
    signal: AbortSignal,
    selectedPlan?: string,
  ) {
    const path = sourceContractsPath;
    if (
      plan.index.documents.some((d) => d.path === sourceRegistryPath) &&
      !plan.documents.some((d) => d.path === sourceRegistryPath)
    )
      plan.documents.push(store.document(plan.index.id, sourceRegistryPath));
    if (
      plan.index.documents.some((d) => d.path === path) &&
      !plan.documents.some((d) => d.path === path)
    )
      plan.documents.push(store.document(plan.index.id, path));
    let plans: ReturnType<typeof implementationDesignPlans>;
    try {
      plans = implementationDesignPlans(plan);
    } catch (error) {
      signal.throwIfAborted();
      return {
        issues: plan.index.entities
          .filter((e) => e.planning || e.id.startsWith("source:"))
          .map((e) => ({
            id: e.id,
            kind: "unknown-link-review" as const,
            origin: "authored" as const,
            message:
              "Current design comparison is unavailable: " +
              errorMessage(error),
            target: e.id,
          })),
        current: [],
      };
    }
    if (!plans.length) return { issues: [], current: [] };
    const catalogue = await this.sourceAttentionCatalogue(plans, signal);
    const issues = sourcePlanningIssues(plans, catalogue);
    const targets = new Set(
      issues.filter((i) => i.id === selectedPlan).map((i) => i.target),
    );
    return {
      issues,
      current:
        "unavailable" in catalogue
          ? []
          : catalogue.entries
              .filter((e) => targets.has(e.id))
              .map((e) => ({
                id: e.id,
                source: e.source.slice(0, 12000),
                truncated: e.source.length > 12000,
                sourceHash: e.sourceHash,
                fileHash: e.sourceHash,
                declarationHash: e.declarationHash,
              })),
    };
  }
  /** Large projects check the selected import closures, never an arbitrary first file. */
  private async captureSourceSelection(
    signal: AbortSignal,
    targets: readonly string[],
  ): Promise<SourceCatalogue> {
    const project = await this.project();
    const files = [
      ...new Set(targets.map((id) => id.slice(7, id.lastIndexOf("#")))),
    ].sort();
    const known = new Set(project.files.map((f) => f.path));
    if (project.files.length <= 2048 && files.every((file) => known.has(file)))
      return this.captureSourceContracts(signal);
    if (files.length > 500)
      throw new StudioError(
        413,
        "A source review supports up to 500 linked roots; split this plan into smaller components.",
      );
    const available: string[] = [];
    for (const file of files) {
      signal.throwIfAborted();
      if (!known.has(file)) {
        try {
          await this.path(file);
        } catch (error) {
          if (error instanceof StudioError && error.status === 404) continue;
          throw error;
        }
      }
      available.push(file);
    }
    let result = available.length
      ? await this.captureSourceContracts(signal, available[0], {
          project,
          additionalFiles: available.slice(1),
        })
      : null;
    result ??= {
      schema: "pymtheg.source-contracts/v1",
      snapshotId: hash("missing source targets:" + JSON.stringify(files)),
      entries: [],
      dependencies: [],
      diagnostics: (project.inventoryWarnings ?? []).map((message) => ({
        file: ".",
        code: "L003",
        message,
      })),
      incompleteFiles: [],
      meaning: "No selected source target is currently available.",
    };
    this.sourceCatalogues.set(result.snapshotId, result);
    while (this.sourceCatalogues.size > 3)
      this.sourceCatalogues.delete(this.sourceCatalogues.keys().next().value!);
    return result;
  }
  async sourceContractDetail(
    options: {
      id: string;
      snapshotId: string;
      revision?: string | undefined;
      planId?: string | undefined;
      expectations?: Record<string, string> | undefined;
      sourceHashes?: Record<string, string> | undefined;
    },
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const current = this.sourceCatalogues.get(options.snapshotId);
    if (!current)
      throw new StudioError(
        409,
        "Source choices expired. Refresh checked components.",
      );
    let revision = options.revision;
    let expectations = options.expectations,
      sourceHashes = options.sourceHashes;
    if (options.planId) {
      revision ??=
        (await this.architectureOverview()).activeRevision ?? undefined;
      if (!revision)
        throw new StudioError(
          404,
          "No saved plan is available for this comparison.",
        );
      const record = await this.architectureRecord(revision, options.planId);
      const plan = planItemSchema.safeParse(record.data);
      if (!plan.success)
        throw new StudioError(
          400,
          "Choose a planning record for the source comparison.",
        );
      expectations =
        plan.data.sourceRoots?.[options.id]?.expectations ??
        plan.data.sourceExpectations;
      sourceHashes =
        plan.data.sourceRoots?.[options.id]?.hashes ?? plan.data.sourceHashes;
    }
    const hasComparison =
      !!expectations && Object.hasOwn(expectations, options.id);
    let recorded: SourceCatalogue | undefined;
    if (revision) {
      const store = await this.architecture();
      const index = await store?.readAsync(revision);
      if (index?.documents.some((d) => d.path === sourceContractsPath))
        recorded = sourceCatalogueSchema.parse(
          JSON.parse(store!.document(index.id, sourceContractsPath).text),
        );
    }
    const preview = (entry: SourceCatalogue["entries"][number] | undefined) => {
      if (!entry) return null;
      const { declaration, source, ...metadata } = entry;
      const page = textPage(source, 0, 16384);
      return {
        ...metadata,
        source: page.text,
        sourceTruncated: page.nextOffset !== null,
      };
    };
    const live = new Map(current.entries.map((e) => [e.id, e]));
    const selectedScope = new Set([
      options.id,
      ...Object.keys(sourceExpectations(current, [options.id])),
    ]);
    const previous = [
      ...(recorded?.history ?? []),
      ...(recorded?.entries ?? []),
    ].find(
      (e) =>
        e.id === options.id &&
        (!expectations?.[e.id] ||
          sourceExpectationHash(e) === expectations[e.id]) &&
        (!sourceHashes?.[e.id] || sourceHashes[e.id] === e.sourceHash),
    );
    const replacements =
      !live.has(options.id) && previous
        ? sourceReplacementCandidates(previous, current)
        : [];
    const changedDependencies = hasComparison
      ? Object.entries(expectations ?? {})
          .filter(
            ([id, expected]) =>
              selectedScope.has(id) &&
              (!live.has(id) ||
                sourceExpectationHash(live.get(id)!) !== expected),
          )
          .map(([id]) => id)
      : null;
    const dependencyPaths = await sourceDependencyPaths(
      current,
      options.id,
      changedDependencies ?? [],
      signal,
    );
    const selectedFiles = new Set(
      [...selectedScope].map((id) => id.slice(7, id.lastIndexOf("#"))),
    );
    return {
      snapshotId: current.snapshotId,
      current: preview(live.get(options.id)),
      replacements: replacements.slice(0, 10),
      replacementCount: replacements.length,
      replacementScope:
        "Suggestions cover this captured source catalogue only. They do not establish identity; compare source and dependencies before replacing a link.",
      recorded: preview(previous),
      recordedAtReview:
        !!previous && sourceHashes?.[options.id] === previous.sourceHash,
      changedDependencies,
      dependencyPaths,
      comparisonPlanId: options.planId ?? null,
      comparisonReason: hasComparison
        ? null
        : options.planId
          ? "This plan has no recorded expectation for this source target."
          : "No plan baseline was selected. This is a source view, not a no-change result.",
      complete:
        !!live.get(options.id) &&
        live.get(options.id)!.modelStatus === "checked" &&
        [...selectedScope].every(
          (id) => live.get(id)?.modelStatus === "checked",
        ) &&
        !current.diagnostics.some(
          (d) =>
            d.code !== "scope" && (d.file === "." || selectedFiles.has(d.file)),
        ) &&
        !current.incompleteFiles.some((file) => selectedFiles.has(file)),
      meaning: current.meaning,
    };
  }
  private preparedHistory: {
    token: string;
    archive: ReturnType<typeof validateHistory>;
    head: string | null;
  } | null = null;
  private preparedImport: {
    preview: import("zod").infer<typeof importPreviewSchema>;
    documents: ArchitectureDocument[];
    index: import("../architecture/schema.js").ArchitectureIndex;
  } | null = null;
  private architectureStore: Promise<ArchitectureStore> | null = null;
  private architectureReader: Promise<ArchitectureStore> | null = null;
  private architectureJob: {
    abort: AbortController;
    done: Promise<unknown>;
  } | null = null;
  private async architectureWrite<T>(
    signal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.closed) throw new StudioError(503, "Studio is closing");
    if (this.architectureJob)
      throw new StudioError(
        409,
        "An architecture import or save is already running",
      );
    const abort = new AbortController(),
      cancel = () => abort.abort();
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    const done = operation(abort.signal);
    this.architectureJob = { abort, done };
    try {
      return await done;
    } finally {
      signal.removeEventListener("abort", cancel);
      if (this.architectureJob?.done === done) this.architectureJob = null;
    }
  }

  private async architecture(create = false) {
    if (this.closed) throw new StudioError(503, "Studio is closing");
    if (create) {
      if (!this.architectureStore && this.initializeOnFirstWrite)
        await initializeBeforeWrite(this.root, this.firstWriteTrust);
      return (this.architectureStore ??= ArchitectureStore.open(this.root));
    }
    if (this.architectureStore) return this.architectureStore;
    if (!existsSync(storagePath(this.root, "planning"))) return null;
    if (this.architectureReader) {
      const reader = await this.architectureReader;
      if (await reader.snapshotChanged()) {
        await reader.closeReadWorkers();
        reader.close();
        this.architectureReader = null;
      }
    }
    return (this.architectureReader ??= ArchitectureStore.open(this.root, {
      readOnly: true,
    }));
  }
  async architectureOverview(revision?: string) {
    const store = await this.architecture(),
      head = await store?.readAsync(),
      index = revision ? await store?.readAsync(revision) : head;
    return {
      index: index ?? null,
      revisions:
        store?.revisions(false).map(({ reviewRecords, ...r }) => ({
          ...r,
          reviewRecordCount: r.reviewRecordCount ?? reviewRecords?.length ?? 0,
        })) ?? [],
      activeRevision: head?.id ?? null,
      sources: head
        ? sourceRegistry(
            head.documents.map((d) => store!.document(head.id, d.path)),
          ).sources.map(({ id, label, kind, selection }) => ({
            id,
            label,
            kind,
            ...(selection ? { selection } : {}),
          }))
        : [],
    };
  }
  async implementationVersions(
    offset = 0,
    limit = 50,
    options: Record<string, unknown> = {},
  ) {
    try {
      const query = versionCatalogQuerySchema.parse({
        ...options,
        offset,
        limit,
      });
      const store = await this.architecture();
      return versionCatalog(
        store?.revisions(false) ?? [],
        store?.activeRevisionId() ?? null,
        query,
      );
    } catch (error) {
      throw new StudioError(
        error instanceof VersionCatalogChanged ? 409 : 400,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  private implementationQueries = new Set<{
    abort: AbortController;
    done: Promise<unknown>;
  }>();
  private implementationFileCatalog: ImplementationFileCatalog | null = null;
  async implementationFiles(raw: unknown, signal: AbortSignal) {
    if (this.closed) throw new StudioError(503, "Studio is closing");
    const abort = new AbortController(),
      combined = AbortSignal.any([signal, abort.signal]);
    this.implementationFileCatalog ??= new ImplementationFileCatalog(this.root);
    const done = this.implementationFileCatalog.page(raw, combined),
      job = { abort, done };
    this.implementationQueries.add(job);
    try {
      return await done;
    } catch (error) {
      if (combined.aborted) throw error;
      throw new StudioError(
        400,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.implementationQueries.delete(job);
    }
  }
  async implementationGraph(
    raw: unknown,
    signal: AbortSignal = new AbortController().signal,
  ) {
    const query = implementationQuerySchema.parse(raw);
    const store = await this.architecture();
    if (!store) {
      if (query.planRevision || query.codeRevision)
        throw new StudioError(404, "Implementation revision not found");
      return null;
    }
    const active = await store.readAsync();
    const plan = await readImplementationDocuments(
      store,
      query.planRevision,
      false,
    );
    if (!plan) {
      if (query.planRevision)
        throw new StudioError(404, "Plan revision not found");
      return null;
    }
    for (const document of new Set(
      plan.index.entities
        .filter((entity) => entity.planning)
        .map((entity) => entity.document),
    )) {
      if (!plan.documents.some((d) => d.path === document))
        plan.documents.push(store.document(plan.index.id, document));
    }
    if (query.detailId && query.mode !== "existing") {
      const entity = plan.index.entities.find((e) => e.id === query.detailId);
      if (entity && !plan.documents.some((d) => d.path === entity.document))
        plan.documents.push(store.document(plan.index.id, entity.document));
    }
    const code = query.codeRevision
      ? await readImplementationDocuments(store, query.codeRevision, false)
      : plan;
    if (query.codeRevision && !code)
      throw new StudioError(404, "Code revision not found");
    const abort = new AbortController();
    const combined = AbortSignal.any([abort.signal, signal]);
    combined.throwIfAborted();
    if (this.closed) throw new StudioError(503, "Studio is closing");
    const designAttention =
      query.mode === "existing"
        ? undefined
        : await this.implementationDesignAttention(plan, store, combined);
    const done = queryImplementation(
      { ...plan, designAttention },
      code,
      query,
      active?.id ?? null,
      combined,
    );
    const job = { abort, done };
    this.implementationQueries.add(job);
    try {
      const result = await done;
      const codeHash = code?.index.documents.find(
        (d) => d.path === observationPath,
      )?.hash;
      return {
        ...result,
        linkAllowed:
          !!codeHash &&
          plan.index.id === active?.id &&
          codeHash ===
            active.documents.find((d) => d.path === observationPath)?.hash,
      };
    } finally {
      this.implementationQueries.delete(job);
    }
  }
  async implementationComparison(
    raw: unknown,
    signal: AbortSignal = new AbortController().signal,
  ) {
    const query = implementationComparisonQuerySchema.parse(raw);
    const store = await this.architecture();
    if (!store)
      throw new StudioError(404, "No retained architecture is available.");
    const active = await store.readAsync();
    const plan = await readImplementationDocuments(
      store,
      query.planRevision,
      false,
    );
    const code =
      query.codeRevision === plan?.index.id
        ? plan
        : await readImplementationDocuments(store, query.codeRevision, false);
    if (!plan || !code)
      throw new StudioError(404, "A selected retained version is unavailable.");
    const entity = plan.index.entities.find((e) => e.id === query.planId);
    if (entity && !plan.documents.some((d) => d.path === entity.document))
      plan.documents.push(store.document(plan.index.id, entity.document));
    // Decode and search large graphs in the owned worker, not on the event loop.
    const links = plan.documents.find((d) => d.path === bindingsPath);
    const binding = links
      ? implementationBindingsSchema
          .parse(JSON.parse(links.text))
          .bindings.find(
            (b) => b.planId === query.planId && b.nodeId === query.nodeId,
          )
      : null;
    if (!binding)
      throw new StudioError(404, "Choose a retained plan/declaration link.");
    let baseline = null;
    let unavailable: string | null = binding.reviewedRevision
      ? null
      : "This legacy link has no retained review checkpoint. Inspect current source and explicitly review it to establish a baseline.";
    if (binding.reviewedRevision) {
      try {
        baseline = await readImplementationDocuments(
          store,
          binding.reviewedRevision,
          false,
        );
      } catch {
        unavailable =
          "The reviewed checkpoint is unavailable or invalid in this history. No baseline was inferred.";
      }
      if (!baseline && !unavailable)
        unavailable =
          "The reviewed checkpoint is absent from this history. No baseline was inferred.";
    }
    const abort = new AbortController();
    const combined = AbortSignal.any([abort.signal, signal]);
    combined.throwIfAborted();
    if (this.closed) throw new StudioError(503, "Studio is closing");
    const designAttention = await this.implementationDesignAttention(
      plan,
      store,
      combined,
      query.planId,
    );
    const done = queryImplementationComparison(
      { ...plan, designAttention },
      code,
      baseline,
      query,
      unavailable,
      active?.id ?? null,
      combined,
    );
    const job = { abort, done };
    this.implementationQueries.add(job);
    try {
      const result = await done;
      const codeHash = code.index.documents.find(
        (d) => d.path === observationPath,
      )?.hash;
      return {
        ...result,
        reviewAllowed:
          result.after.available &&
          !!codeHash &&
          plan.index.id === active?.id &&
          codeHash ===
            active.documents.find((d) => d.path === observationPath)?.hash,
      };
    } finally {
      this.implementationQueries.delete(job);
    }
  }
  async observeImplementation(raw: unknown, signal: AbortSignal) {
    const request = captureCodeSchema.parse(raw);
    return this.architectureWrite(signal, async (owned) => {
      const graph = await captureImplementation(
        this.root,
        request.files,
        request.label,
        owned,
      );
      let planDocument: ArchitectureDocument | undefined;
      if (request.runId) {
        const ir = this.models.get(request.runId);
        if (!ir)
          throw new StudioError(
            409,
            "Check your design again before capturing it with this code version.",
          );
        const current = await this.architecture();
        const state = current
          ? await readImplementation(current, undefined, false)
          : null;
        const old = state?.documents.find(
          (d) => d.path === sourceContractsPath,
        );
        const catalogue = retainSourceCatalogue(
          old ? sourceCatalogueSchema.parse(JSON.parse(old.text)) : null,
          projectSourceCatalogue(ir, this.root),
        );
        planDocument = { path: sourceContractsPath, text: json(catalogue) };
      }
      const store = (await this.architecture(true))!;
      return retainObservation(
        store,
        graph,
        request.expectedRevision,
        owned,
        planDocument,
      );
    });
  }
  async linkImplementation(raw: unknown, signal: AbortSignal) {
    const request = bindCodeSchema.parse(raw);
    return this.architectureWrite(signal, async (owned) =>
      bindImplementation((await this.architecture(true))!, request, owned),
    );
  }
  async unlinkImplementation(raw: unknown, signal: AbortSignal) {
    const request = unlinkCodeSchema.parse(raw);
    return this.architectureWrite(signal, async (owned) =>
      unlinkImplementation((await this.architecture(true))!, request, owned),
    );
  }
  async branchReviewHistory(checkpoint: string, offset = 0, limit = 20) {
    const store = await this.architecture();
    if (!store) throw new StudioError(404, "No architecture is available");
    if (!(await store.readAsync(checkpoint)))
      throw new StudioError(404, "Architecture revision not found");
    return store.reviewHistory(checkpoint, offset, limit);
  }
  async branchWithdrawalHistory(id: string, offset = 0, limit = 20) {
    const store = await this.architecture();
    if (!store) throw new StudioError(404, "No architecture is available");
    return store.withdrawalHistory(id, offset, limit);
  }
  async reviewArchitectureBranch(
    tip: string,
    active: string,
    signal: AbortSignal,
    metadata: { reviewer?: string; reason?: string } = {},
  ) {
    return this.architectureWrite(signal, async () => {
      const store = (await this.architecture(true))!;
      return store.reviewBranch(tip, active, metadata);
    });
  }
  async withdrawArchitectureReview(
    id: string,
    active: string,
    signal: AbortSignal,
    metadata: { reviewer?: string; reason?: string } = {},
  ) {
    return this.architectureWrite(signal, async () => {
      const store = (await this.architecture(true))!;
      return store.withdrawBranchReview(id, active, metadata);
    });
  }
  async candidatePlanImpact(
    catalogue: SourceCatalogue,
    files: string[],
    signal: AbortSignal,
  ) {
    const store = await this.architecture(),
      index = await store?.readAsync();
    const empty = {
      architectureRevision: index?.id ?? null,
      scopedPlanCount: 0,
      outsideScopePlanCount: 0,
      affectedPlanCount: 0,
      complete: true,
      items: [] as {
        planId: string;
        name: string;
        kind: string;
        message: string;
        target: string;
      }[],
      meaning:
        "Planning impact within the checked source scope, not a proof of requirement satisfaction.",
    };
    if (!store || !index) return empty;
    const scope = new Set(files);
    const documents = new Map<string, ReturnType<typeof planSchema.parse>>();
    const provenance = index.documents.some(
      (d) => d.path === sourceRegistryPath,
    )
      ? [store.document(index.id, sourceRegistryPath)]
      : [];
    const native = authoredDocuments(index, provenance);
    const plans: Parameters<typeof sourcePlanningIssues>[0] = [];
    let outside = 0,
      visited = 0;
    for (const entity of index.entities) {
      if (++visited % 64 === 0) {
        await yieldToCoordinator();
        signal.throwIfAborted();
      }
      if (!entity.planning) continue;
      let document = documents.get(entity.document);
      if (!document) {
        document = planSchema.parse(
          JSON.parse(store.document(index.id, entity.document).text),
        );
        documents.set(entity.document, document);
      }
      const record =
        typeof entity.pointer[1] === "number"
          ? document.items[entity.pointer[1]]
          : undefined;
      if (!record || !record.links.some((l) => l.target.startsWith("source:")))
        continue;
      const within = (id: string) =>
        scope.has(id.slice("source:".length, id.lastIndexOf("#")));
      const expectations = Object.fromEntries(
        Object.entries(record.sourceExpectations ?? {}).filter(([id]) =>
          within(id),
        ),
      );
      if (
        !Object.keys(expectations).length &&
        !record.links.some(
          (l) => l.target.startsWith("source:") && within(l.target),
        )
      ) {
        outside++;
        continue;
      }
      plans.push({
        entity,
        record: { ...record, sourceExpectations: expectations },
        origin: native.has(entity.document) ? "authored" : "imported",
      });
    }
    signal.throwIfAborted();
    const issues = sourcePlanningIssues(plans, catalogue, {
      inspectedFiles: scope,
      maxIssues: 10000,
    });
    const names = new Map(plans.map((p) => [p.entity.id, p.entity.name]));
    return {
      ...empty,
      scopedPlanCount: plans.length,
      outsideScopePlanCount: outside,
      affectedPlanCount: new Set(issues.map((i) => i.id)).size,
      complete: issues.length < 10000,
      items: issues.map((i) => ({
        planId: i.id,
        name: names.get(i.id) ?? i.id,
        kind: i.kind,
        message: i.message,
        target: i.target,
      })),
      meaning: outside
        ? "Planning impact within checked files only. Other plans were outside this source scope and were not assessed."
        : empty.meaning,
    };
  }
  async architectureWork(
    revision: string,
    signal: AbortSignal = new AbortController().signal,
  ) {
    const store = await this.architecture(),
      index = await store?.readAsync(revision);
    if (!store || !index)
      throw new StudioError(404, "Architecture revision not found");
    const history = new Map<
      string,
      import("../architecture/work.js").EvidenceSnapshot
    >();
    const plans = new Map(
      index.entities.map((e) => [
        e.id,
        [
          ...new Set([
            ...(e.planning?.hasEvidence && e.planning.evidenceRevision
              ? [e.planning.evidenceRevision]
              : []),
            ...(e.planning?.linkReviewRevision || e.planning?.originRevision
              ? [e.planning.linkReviewRevision || e.planning.originRevision!]
              : []),
            ...Object.values(e.planning?.linkBaselines ?? {}),
          ]),
        ],
      ]),
    );
    const needed = new Map<string, Set<string>>();
    const provenance = index.documents.some(
      (d) => d.path === sourceRegistryPath,
    )
      ? [store.document(index.id, sourceRegistryPath)]
      : [];
    const forks = forkReviewTargets(index, provenance);
    for (const revisions of plans.values())
      for (const revision of revisions) needed.set(revision, new Set());
    for (const edge of index.edges)
      for (const revision of plans.get(edge.from) ?? []) {
        needed.get(revision)!.add(edge.to);
        for (const fork of forks.get(edge.to) ?? [])
          if (fork.target) needed.get(revision)!.add(fork.target);
      }
    for (const [id, targets] of needed) {
      const previous = await store.readAsync(id);
      if (previous) history.set(id, projectEvidenceSnapshot(previous, targets));
    }
    const issues = openArchitectureWork(index, history, provenance);
    const native = authoredDocuments(index, provenance);
    const documents = new Map<string, ReturnType<typeof planSchema.parse>>();
    const sourcePlans = [];
    for (const entity of index.entities.filter((e) => e.planning)) {
      let plan = documents.get(entity.document);
      if (!plan) {
        plan = planSchema.parse(
          JSON.parse(store.document(index.id, entity.document).text),
        );
        documents.set(entity.document, plan);
      }
      const position = entity.pointer[1];
      const record =
        typeof position === "number" ? plan.items[position] : undefined;
      if (record?.links.some((l) => l.target.startsWith("source:")))
        sourcePlans.push({
          entity,
          record,
          origin: native.has(entity.document)
            ? ("authored" as const)
            : ("imported" as const),
        });
    }
    if (sourcePlans.length) {
      issues.push(...(await this.sourceAttention(sourcePlans, signal)));
    }
    return issues;
  }
  async architectureRecord(revision: string, id: string) {
    const store = await this.architecture(),
      index = await store?.readAsync(revision);
    if (!store || !index)
      throw new StudioError(404, "Architecture revision not found");
    const entity = index.entities.find((e) => e.id === id);
    if (!entity) throw new StudioError(404, "Architecture record not found");
    const document = store.document(revision, entity.document);
    return {
      entity,
      data: architectureDetail(document, entity.pointer),
      dependents: affectedEntities(index, id),
      impact: architectureImpact(index, id),
    };
  }
  async architectureDocument(revision: string, path: string) {
    const store = await this.architecture();
    if (!store) throw new StudioError(404, "No architecture has been imported");
    const index = await store.readAsync(revision);
    if (!index) throw new StudioError(404, "Architecture revision not found");
    if (!index.documents.some((d) => d.path === path))
      throw new StudioError(404, "Architecture document not found");
    return store.document(revision, path);
  }
  async previewArchitectureImport(
    label: string,
    raw: {
      documents?: unknown;
      bundle?: unknown;
      source?: unknown;
      mode?: unknown;
      resolutions?: unknown;
    },
    signal: AbortSignal,
  ) {
    return this.architectureWrite(signal, async (owned) => {
      this.preparedImport = null;
      this.preparedHistory = null;
      if (!label.trim() || label.length > 160)
        throw new StudioError(
          400,
          "Choose a revision name of 1–160 characters",
        );
      const bundle =
        raw.bundle === undefined ? null : bundleSchema.parse(raw.bundle);
      if (bundle) {
        try {
          decodeObservation(bundle.documents);
        } catch {
          throw new StudioError(
            400,
            "Bundle contains an invalid code version. Nothing was imported; re-export a healthy version.",
          );
        }
      }
      const documents = bundle
        ? bundle.documents
        : documentSchema.array().min(1).max(4096).parse(raw.documents);
      if (bundle && !bundleContentMatches(bundle))
        throw new StudioError(
          400,
          "Bundle content does not match its recorded checksum. Re-export older non-ASCII bundles from the originating locale.",
        );
      const source =
        raw.source === undefined
          ? {
              id: bundle
                ? "bundle:" + bundle.index.id
                : "upload:" +
                  hash(
                    documents
                      .map((d) => d.path)
                      .sort()
                      .join("\n"),
                  ),
              label: bundle?.revision?.label ?? "Uploaded documents",
              kind: bundle ? ("bundle" as const) : ("upload" as const),
            }
          : importSourceSchema.parse(raw.source);
      source.label = sharedSourceLabel(this.root, source.label);
      const mode = raw.mode ?? "add";
      if (mode !== "add" && mode !== "refresh")
        throw new StudioError(400, "Choose add or refresh");
      const store = await this.architecture(),
        head = await store?.readAsync();
      const current = head
        ? head.documents.map((d) => store!.document(head.id, d.path))
        : [];
      if (
        mode === "refresh" &&
        !sourceRegistry(current).sources.some((s) => s.id === source.id)
      )
        throw new StudioError(400, "Choose an existing source to refresh");
      const merged = mergeArchitectureImport(
          current,
          preserveInventoryLocation(current, documents, source.id),
          source,
          mode,
          {
            collectConflicts: true,
            resolutions:
              raw.resolutions === undefined
                ? []
                : importResolutionSchema.array().parse(raw.resolutions),
          },
        ),
        prepared = await prepareAndIndexInWorker(
          current,
          merged.documents,
          owned,
        ),
        index = prepared.index;
      if (owned.aborted) throw new StudioError(409, "Import preview cancelled");
      const preview = importPreviewSchema.parse({
        token: randomUUID(),
        baseRevision: head?.id ?? null,
        label,
        source,
        mode,
        summary: merged.summary,
        conflicts: merged.conflicts,
        unresolvedLinks: index.edges.filter((e) => e.unresolved).length,
        newlyBrokenAuthoredLinks: newlyBrokenAuthoredLinks(
          head,
          index,
          prepared.documents,
        ),
        warnings: index.warnings,
      });
      this.preparedImport = merged.conflicts.length
        ? null
        : { preview, documents: prepared.documents, index };
      return preview;
    });
  }
  async commitPreparedArchitectureImport(token: string, signal: AbortSignal) {
    return this.architectureWrite(signal, async (owned) => {
      const plan = this.preparedImport;
      if (!plan || plan.preview.token !== token)
        throw new StudioError(
          409,
          "This import preview is no longer available. Preview the files again.",
        );
      const store = (await this.architecture(true))!;
      if (owned.aborted) throw new StudioError(409, "Import cancelled");
      const result = store.save(
        plan.preview.label,
        plan.preview.source.label,
        plan.documents,
        plan.index,
        plan.preview.baseRevision,
        { skipUnchanged: plan.preview.mode === "refresh" },
      );
      this.preparedImport = null;
      return result;
    });
  }
  private async commitArchitectureImport(
    label: string,
    documents: ArchitectureDocument[],
    owned: AbortSignal,
    source: ImportSource,
    mode: "add" | "refresh",
  ) {
    if (owned.aborted) throw new StudioError(409, "Import cancelled");
    const store = (await this.architecture(true))!,
      head = await store.readAsync(),
      current = head
        ? head.documents.map((d) => store.document(head.id, d.path))
        : [];
    source = { ...source, label: sharedSourceLabel(this.root, source.label) };
    const merged = mergeArchitectureImport(current, documents, source, mode),
      prepared = await prepareAndIndexInWorker(
        current,
        merged.documents,
        owned,
      ),
      index = prepared.index;
    if (owned.aborted) throw new StudioError(409, "Import cancelled");
    return store.save(
      label,
      source.label,
      prepared.documents,
      index,
      head?.id ?? null,
      { skipUnchanged: mode === "refresh" },
    );
  }
  async importArchitecture(
    label: string,
    documents: ArchitectureDocument[],
    signal: AbortSignal,
    options?: { source: ImportSource; mode: "add" | "refresh" },
  ) {
    const source = options?.source ?? {
      id:
        "upload:" +
        hash(
          documents
            .map((d) => d.path)
            .sort()
            .join("\n"),
        ),
      label: "Uploaded documents",
      kind: "upload" as const,
    };
    return this.architectureWrite(signal, (owned) =>
      this.commitArchitectureImport(
        label,
        documents,
        owned,
        source,
        options?.mode ?? "add",
      ),
    );
  }
  async importArchitectureBundle(
    label: string,
    raw: unknown,
    signal: AbortSignal,
  ) {
    const bundle = bundleSchema.parse(raw);
    try {
      decodeObservation(bundle.documents);
    } catch {
      throw new StudioError(
        400,
        "Bundle contains an invalid code version. Nothing was imported; re-export a healthy version.",
      );
    }
    return this.architectureWrite(signal, async (owned) => {
      if (!bundleContentMatches(bundle))
        throw new StudioError(
          400,
          "Bundle content does not match its recorded identity",
        );
      return this.commitArchitectureImport(
        label,
        bundle.documents,
        owned,
        {
          id: "bundle:" + bundle.index.id,
          label: bundle.revision?.label ?? "Imported architecture bundle",
          kind: "bundle",
        },
        "add",
      );
    });
  }
  async searchArchitecture(revision: string, query: string) {
    return (await this.searchArchitecturePage(revision, query)).matches;
  }
  async searchArchitecturePage(
    revision: string,
    query: string,
    offset = 0,
    limit = 100,
  ) {
    const store = await this.architecture();
    if (!store) throw new StudioError(404, "No architecture imported");
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new StudioError(
        400,
        "Search requires a nonnegative offset and a limit from 1 to 100",
      );
    if (query.length > 256)
      throw new StudioError(400, "Search must be at most 256 characters");
    if (!(await store.readAsync(revision)))
      throw new StudioError(404, "Architecture revision not found");
    return store.searchPage(revision, query, offset, limit);
  }
  async editArchitectureDocument(
    revision: string,
    path: string,
    text: string,
    label: string,
    signal: AbortSignal,
    createOnly = false,
  ) {
    return this.architectureWrite(signal, async (owned) => {
      const store = await this.architecture(true),
        index = await store?.readAsync(revision);
      if (!store || !index)
        throw new StudioError(404, "Architecture revision not found");
      const head = (await store.readAsync())!;
      if (createOnly && head.documents.some((d) => d.path === path))
        throw new ArchitectureConflict(
          "A document already exists at this path. Choose a new path; the existing document was preserved.",
        );
      const before = index.documents.find((d) => d.path === path);
      const now = head.documents.find((d) => d.path === path);
      if (before?.hash !== now?.hash && now?.hash !== hash(text))
        throw new ArchitectureConflict(
          now
            ? "This document changed since your edit began. Your draft is preserved. Review the current document before applying your changes."
            : "This draft's document is absent from the current architecture. Your text is preserved. Restore it as a new document, or review the deletion before applying it.",
        );
      const documents = head.documents
        .filter((d) => d.path !== path)
        .map((d) => store.document(head.id, d.path));
      if (
        path === sourceRegistryPath ||
        path === headingRegistryPath ||
        path === sourceContractsPath
      )
        throw new StudioError(
          400,
          "Source ownership is managed by imports; this registry cannot be edited as a document.",
        );
      let storedPlan = false;
      if (now) {
        try {
          storedPlan =
            JSON.parse(
              store.document(head.id, path).text.replace(/^\uFEFF/, ""),
            ).schema === "pymtheg.plan/v1";
        } catch {
          /* An ordinary text document may not be JSON. */
        }
      }
      if (path === nativePlanPath || storedPlan) {
        try {
          planSchema.parse(JSON.parse(text));
        } catch {
          throw new StudioError(
            400,
            "Planning JSON is invalid. Use the planning form, or correct the JSON before saving; the current plan was preserved.",
          );
        }
      }
      documents.push({ path, text });
      const registry = sourceRegistry(documents),
        imported = registry.sources.some((s) =>
          s.documents.some((d) => d.path === path),
        );
      const nextDocuments =
        imported || now?.hash === hash(text)
          ? documents
          : withNativeDocuments(documents, [path]);
      const prepared = await prepareAndIndexInWorker(
        head.documents.map((d) => store.document(head.id, d.path)),
        nextDocuments,
        owned,
      );
      const regression = planningIntegrityRegression(head, prepared.index);
      if (regression) throw new ArchitectureConflict(regression);
      if (owned.aborted)
        throw new StudioError(409, "Architecture save cancelled");
      return store.save(
        label,
        "Edited in Studio",
        prepared.documents,
        prepared.index,
        head.id,
      );
    });
  }

  async architectureDraft() {
    return (
      (await this.architecture())?.readDraft() ?? { version: 0, draft: null }
    );
  }
  async saveArchitectureDraft(version: number, draft: unknown) {
    if (this.closed) throw new StudioError(503, "Studio is closing");
    const store = await this.architecture(true);
    if (this.closed) throw new StudioError(503, "Studio is closing");
    return store!.saveDraft(version, draft);
  }
  async savePlanItem(
    revision: string,
    raw: unknown,
    label: string,
    signal: AbortSignal,
    target?: {
      document: string;
      originalId: string;
      itemIndex?: number | undefined;
    },
  ) {
    const item = planItemSchema.parse(raw);
    return this.architectureWrite(signal, async (owned) => {
      const store = (await this.architecture(true))!,
        head = await store.readAsync();
      const base = revision ? await store.readAsync(revision) : null;
      const path = target?.document ?? nativePlanPath,
        originalId = target?.originalId ?? item.id;
      const logicalId = "plan:" + item.id;
      const existingIds =
        head?.entities.filter(
          (entity) =>
            entity.id === logicalId || entity.conflictOf === logicalId,
        ) ?? [];
      if (!target && existingIds.length)
        throw new ArchitectureConflict(
          `The record ID ${item.id} already exists. Open that record to edit it, or choose another ID for this new record.`,
        );
      if (target && item.id !== originalId) {
        if (existingIds.length)
          throw new ArchitectureConflict(
            `The record ID ${item.id} is already used in this architecture. Choose a unique ID.`,
          );
        const inbound =
          head?.edges.filter(
            (edge) => edge.to === "plan:" + originalId && !edge.unresolved,
          ) ?? [];
        if (inbound.length)
          throw new ArchitectureConflict(
            `This stable ID has ${inbound.length} incoming link${inbound.length === 1 ? "" : "s"}. Change the title instead, or update those links before changing the ID.`,
          );
      }

      documentSchema.parse({ path, text: "" });
      if (path === sourceRegistryPath || path === headingRegistryPath)
        throw new StudioError(
          400,
          "The source registry cannot contain planning records",
        );
      if (revision && !base)
        throw new StudioError(404, "Architecture revision not found");
      const readPlan = (
        index: import("../architecture/schema.js").ArchitectureIndex | null,
      ) =>
        index?.documents.some((d) => d.path === path)
          ? planSchema.parse(JSON.parse(store.document(index.id, path).text))
          : {
              schema: "pymtheg.plan/v1" as const,
              items: [] as import("../architecture/schema.js").PlanItem[],
            };
      const baseline = readPlan(base),
        current = readPlan(head);
      const originals = baseline.items
        .map((value, index) => ({ value, index }))
        .filter((entry) => entry.value.id === originalId);
      const candidates = current.items
        .map((value, index) => ({ value, index }))
        .filter((entry) => entry.value.id === originalId);
      if (originals.length > 1 && target?.itemIndex === undefined)
        throw new ArchitectureConflict(
          "Choose a particular conflicting definition before editing this ID.",
        );
      const ordinal =
        target?.itemIndex === undefined || originals.length === 0
          ? 0
          : originals.findIndex((entry) => entry.index === target.itemIndex);
      if (target?.itemIndex !== undefined && ordinal < 0)
        throw new ArchitectureConflict(
          "The selected definition is not in the starting revision.",
        );
      if (
        originals.length > 1 &&
        JSON.stringify(originals.map((e) => e.value)) !==
          JSON.stringify(candidates.map((e) => e.value))
      )
        throw new ArchitectureConflict(
          "These conflicting definitions changed. Review the current document before resolving their IDs.",
        );
      const before = originals[ordinal]?.value,
        now = candidates[ordinal]?.value;
      const position = candidates[ordinal]?.index ?? -1;
      if (
        JSON.stringify(before) !== JSON.stringify(now) &&
        JSON.stringify(now) !== JSON.stringify(item)
      )
        throw new ArchitectureConflict(
          "This planning record changed since your edit began. Your draft is preserved. Review the current record before applying your changes.",
        );
      if (item.id !== originalId && current.items.some((i) => i.id === item.id))
        throw new ArchitectureConflict(
          "That record ID is already in this document. Choose a unique ID.",
        );
      const sourceLinks = item.links.filter((link) =>
        link.target.startsWith("source:"),
      );
      const oldSourceTargets = new Set(
        now?.links
          .filter((link) => link.target.startsWith("source:"))
          .map((link) => link.target) ?? [],
      );
      const sourceTargets = sourceLinks.map((link) => link.target);
      const newTargets = sourceTargets.filter(
        (target) => !oldSourceTargets.has(target),
      );
      const retainedTargets = sourceTargets.filter((target) =>
        oldSourceTargets.has(target),
      );
      const explicitlyReviewed =
        !!item.sourceReviewSelection || !!item.sourceReviewSnapshot;
      const capturedTargets = explicitlyReviewed ? sourceTargets : newTargets;
      const selectionSnapshots = new Map(
        [item.sourceReviewSnapshot, item.sourceSelectionSnapshot]
          .filter((id): id is string => !!id)
          .map((id) => [id, this.sourceCatalogues.get(id)]),
      );
      const captured = capturedTargets.length
        ? await this.captureSourceSelection(owned, capturedTargets)
        : null;
      if (captured) {
        const available = new Map(captured.entries.map((e) => [e.id, e]));
        for (const target of capturedTargets)
          if (
            !available.has(target) ||
            available.get(target)!.modelStatus === "ambiguous"
          )
            throw new StudioError(
              409,
              `Source target ${target} is unavailable or ambiguous. Choose a current component for a new link or source review. Existing historical links can be kept without renewing their review.`,
            );
        const verifyChoice = (choice: SourceSelection, targets: string[]) => {
          const actual = sourceExpectations(captured, targets);
          if (
            targets.some((id) => !choice.targets.includes(id)) ||
            Object.keys(actual).length !==
              Object.keys(choice.expectations).length ||
            Object.entries(actual).some(
              ([id, expected]) =>
                choice.expectations[id] !== expected ||
                choice.textHashes[id] !== hash(available.get(id)!.source),
            )
          )
            throw new StudioError(
              409,
              "The selected component or a dependency changed. Refresh the source choices and inspect the current text before saving.",
            );
        };
        if (item.sourceReviewSelection)
          verifyChoice(
            item.sourceReviewSelection,
            sourceLinks.map((link) => link.target),
          );
        for (const target of newTargets)
          if (item.sourceSelections?.[target])
            verifyChoice(item.sourceSelections[target], [target]);
        for (const [snapshot, targets] of [
          [
            item.sourceReviewSelection ? undefined : item.sourceReviewSnapshot,
            sourceLinks.map((l) => l.target),
          ],
          [
            newTargets.every((target) => !!item.sourceSelections?.[target])
              ? undefined
              : item.sourceSelectionSnapshot,
            newTargets.filter((target) => !item.sourceSelections?.[target]),
          ],
        ] as const) {
          if (!snapshot) continue;
          const selected = selectionSnapshots.get(snapshot);
          const expected = selected
            ? sourceExpectations(selected, targets)
            : {};
          const actual = sourceExpectations(captured, targets);
          const displayed = new Map(
            selected?.entries.map((entry) => [entry.id, entry.source]) ?? [],
          );
          if (!selected)
            throw new StudioError(
              409,
              "These source choices expired. Refresh them to capture the selected components again; no source change is implied.",
            );
          if (
            targets.some((id) => !expected[id]) ||
            Object.keys(expected).length !== Object.keys(actual).length ||
            Object.entries(expected).some(
              ([id, value]) =>
                actual[id] !== value ||
                displayed.get(id) !== available.get(id)?.source,
            )
          )
            throw new StudioError(
              409,
              "Source changed since review. Refresh the source choices and review the displayed components before saving.",
            );
        }
      }
      let legacyCatalogue: SourceCatalogue | null = null;
      if (
        now &&
        retainedTargets.some((id) => !now.sourceRoots?.[id]) &&
        head?.documents.some((d) => d.path === sourceContractsPath)
      ) {
        try {
          legacyCatalogue = sourceCatalogueSchema.parse(
            JSON.parse(store.document(head.id, sourceContractsPath).text),
          );
        } catch {
          /* Preserve conservative recorded baselines if old metadata cannot be decoded. */
        }
      }
      if (
        sourceTargets.length ||
        oldSourceTargets.size ||
        item.sourceRoots ||
        item.sourceExpectations ||
        item.sourceHashes
      )
        Object.assign(
          item,
          updateSourceBaselines(
            now,
            sourceTargets,
            captured,
            legacyCatalogue,
            explicitlyReviewed,
          ),
        );
      delete item.sourceReviewSnapshot;
      delete item.sourceSelectionSnapshot;
      delete item.sourceSelections;
      delete item.sourceReviewSelection;
      for (const link of item.links) {
        const unchanged = now?.links.some(
          (old) => old.kind === link.kind && old.target === link.target,
        );
        if (
          !unchanged &&
          link.target !== "plan:" + item.id &&
          !head?.entities.some((e) => e.id === link.target) &&
          !captured?.entries.some((e) => e.id === link.target)
        )
          throw new StudioError(
            400,
            `The linked record ${link.target} is missing or ambiguous. Choose a current record ID; the draft was preserved.`,
          );
      }
      if (
        item.evidenceRevision &&
        !(await store.readAsync(item.evidenceRevision))
      )
        throw new StudioError(
          400,
          "The evidence revision is not retained in this architecture. Choose an existing revision or leave it open.",
        );
      // Baselines are server-owned change markers, never reviews. Only the
      // explicit acknowledgement (a new linkReviewRevision) reviews links.
      const newlyReviewed =
        !!item.linkReviewRevision &&
        item.linkReviewRevision !== now?.linkReviewRevision;
      if (newlyReviewed && !(await store.readAsync(item.linkReviewRevision!)))
        throw new StudioError(
          409,
          "This link review names a revision this architecture does not have. Refresh the record and review the displayed linked targets again; the draft was preserved.",
        );
      // Links stay covered by an earlier review only while the record keeps one.
      const coveredBefore = new Set(
        (item.linkReviewRevision || item.originRevision) &&
        (now?.linkReviewRevision || now?.originRevision)
          ? now.links.map((link) => link.target)
          : [],
      );
      const previousTargets = new Set(now?.links.map((link) => link.target));
      const linkBaselines: Record<string, string> = {};
      if (!newlyReviewed)
        for (const { target: linked } of item.links) {
          if (
            linked.startsWith("source:") ||
            linked === logicalId ||
            linkBaselines[linked]
          )
            continue;
          const kept = now?.linkBaselines?.[linked];
          if (kept) linkBaselines[linked] = kept;
          else if (coveredBefore.has(linked)) continue;
          // The base revision is used only when it contains the target, so a
          // later change can always be compared; never a silent gap.
          else if (base?.entities.some((e) => e.id === linked))
            linkBaselines[linked] = revision;
          else if (!revision && head) linkBaselines[linked] = head.id;
          else if (!previousTargets.has(linked))
            throw new StudioError(
              409,
              `The linked record ${linked} is not in the revision this edit started from. Refresh the record to see the current target, then save again; the draft was preserved.`,
            );
          else if (head) linkBaselines[linked] = head.id;
        }
      if (Object.keys(linkBaselines).length) item.linkBaselines = linkBaselines;
      else delete item.linkBaselines;
      if (position < 0) current.items.push(item);
      else current.items[position] = item;
      const documents = (head?.documents ?? [])
        .filter((d) => d.path !== path)
        .map((d) => store.document(head!.id, d.path));
      documents.push({ path, text: JSON.stringify(current, null, 2) });
      if (captured) {
        const oldDocument = documents.find(
          (d) => d.path === sourceContractsPath,
        );
        const previous = oldDocument
          ? sourceCatalogueSchema.parse(JSON.parse(oldDocument.text))
          : null;
        const retained = {
          path: sourceContractsPath,
          text: json(retainSourceCatalogue(previous, captured)),
        };
        if (oldDocument)
          documents.splice(documents.indexOf(oldDocument), 1, retained);
        else documents.push(retained);
      }
      const imported = sourceRegistry(documents).sources.some((source) =>
        source.documents.some((d) => d.path === path),
      );
      const nativePaths = [
        ...(!imported ? [path] : []),
        ...(captured ? [sourceContractsPath] : []),
      ];
      const next = nativePaths.length
        ? withNativeDocuments(documents, nativePaths)
        : documents;
      const prepared = await prepareAndIndexInWorker(
        (head?.documents ?? []).map((d) => store.document(head!.id, d.path)),
        next,
        owned,
      );
      const regression = head
        ? planningIntegrityRegression(head, prepared.index)
        : null;
      if (regression) throw new ArchitectureConflict(regression);
      if (owned.aborted)
        throw new StudioError(409, "Architecture save cancelled");
      if (captured) {
        const files = new Map(
          captured.entries
            .filter((e) => Object.hasOwn(item.sourceExpectations ?? {}, e.id))
            .map((e) => [e.file, e.sourceHash]),
        );
        for (const [file, expected] of files) {
          if ((await this.sourceFile(file)).hash !== expected)
            throw new StudioError(
              409,
              "Source changed before the plan was saved. Refresh the source choices and review again.",
            );
          owned.throwIfAborted();
        }
      }
      return store.save(
        label,
        "Edited planning record",
        prepared.documents,
        prepared.index,
        head?.id ?? null,
      );
    });
  }
  async previewArchitectureHistory(raw: unknown, signal: AbortSignal) {
    return this.architectureWrite(signal, async (owned) => {
      this.preparedImport = null;
      this.preparedHistory = null;
      let archive: Awaited<ReturnType<typeof historyInWorker>>;
      try {
        archive = await historyInWorker(raw, owned);
      } catch (error) {
        if (owned.aborted)
          throw new StudioError(
            409,
            "History preview cancelled. Nothing was imported.",
          );
        throw new StudioError(
          400,
          "History archive could not be validated. Nothing was imported. " +
            errorMessage(error),
        );
      }
      const store = await this.architecture(),
        head = (await store?.readAsync())?.id ?? null;
      if (owned.aborted)
        throw new StudioError(409, "History preview cancelled");
      const token = randomUUID();
      this.preparedHistory = { token, archive, head };
      return {
        token,
        revisions: archive.revisions.length,
        documents: archive.blobs.length,
        hasDraft: !!archive.draft,
        keepsCurrent: head !== null,
      };
    });
  }
  async commitArchitectureHistory(token: string, signal: AbortSignal) {
    return this.architectureWrite(signal, async (owned) => {
      const prepared = this.preparedHistory;
      if (!prepared || prepared.token !== token)
        throw new StudioError(
          409,
          "Preview this history archive again before importing.",
        );
      const store = (await this.architecture(true))!;
      if (owned.aborted) throw new StudioError(409, "History import cancelled");
      const result = store.commitValidatedHistory(
        prepared.archive,
        prepared.head,
      );
      this.preparedHistory = null;
      return result;
    });
  }
  async nameArchitectureVersion(
    revision: string,
    label: string,
    signal: AbortSignal,
  ) {
    if (!label.trim() || label.length > 160)
      throw new StudioError(400, "Choose a version name of 1–160 characters");
    return this.architectureWrite(signal, async (owned) => {
      const store = (await this.architecture(true))!,
        head = await store.readAsync();
      if (!head)
        throw new StudioError(404, "No architecture has been saved yet");
      if (head.id !== revision)
        throw new ArchitectureConflict(
          "The current architecture changed. Return to the current version before naming it.",
        );
      const documents = head.documents.map((document) =>
        store.document(head.id, document.path),
      );
      if (owned.aborted)
        throw new StudioError(409, "Naming the version was cancelled");
      return store.save(label, "Named in Studio", documents, head, revision);
    });
  }
  async exportArchitectureHistory() {
    const store = await this.architecture();
    if (!store) throw new StudioError(404, "No architecture stored");
    return store.exportHistory();
  }
  async importArchitectureHistory(raw: unknown, signal: AbortSignal) {
    return this.architectureWrite(signal, async (owned) => {
      if (owned.aborted) throw new StudioError(409, "History import cancelled");
      const store = (await this.architecture(true))!;
      if (owned.aborted) throw new StudioError(409, "History import cancelled");
      const archive = await historyInWorker(raw, owned);
      if (owned.aborted) throw new StudioError(409, "History import cancelled");
      return store.commitValidatedHistory(archive);
    });
  }
  async exportArchitecture(revision: string) {
    const store = await this.architecture();
    if (!store) throw new StudioError(404, "No architecture imported");
    if (!(await store.readAsync(revision)))
      throw new StudioError(404, "Architecture revision not found");
    return store.export(revision);
  }
  async compareArchitecture(current: string, previous: string) {
    const store = await this.architecture(),
      a = await store?.readAsync(current),
      b = await store?.readAsync(previous);
    if (!a || !b)
      throw new StudioError(404, "Choose two retained architecture revisions");
    const difference = compareArchitecture(a, b),
      old = new Map(b.entities.map((e) => [e.id, e])),
      now = new Map(a.entities.map((e) => [e.id, e]));
    const documentCache = new Map<string, ArchitectureDocument>();
    const document = (revision: string, path: string) => {
      const key = revision + "/" + path;
      let value = documentCache.get(key);
      if (!value) {
        value = store!.document(revision, path);
        documentCache.set(key, value);
      }
      return value;
    };
    const recordChanges = difference.changed.map((id) => {
      const before = old.get(id)!,
        after = now.get(id)!,
        diff = fieldChanges(
          architectureDetail(document(b.id, before.document), before.pointer),
          architectureDetail(document(a.id, after.document), after.pointer),
        );
      return {
        id,
        name: after.key,
        fields: diff.changes,
        truncated: diff.truncated,
      };
    });
    const documentChanges = difference.changedDocuments.map((path) => ({
      path,
      ...changedText(
        b.documents.some((d) => d.path === path)
          ? document(b.id, path).text
          : "",
        document(a.id, path).text,
      ),
    }));
    return {
      ...difference,
      recordChanges,
      documentChanges,
      removedNames: Object.fromEntries(
        difference.removed.map((id) => [id, old.get(id)!.key]),
      ),
    };
  }

  private active: {
    run: StudioRun;
    abort: AbortController;
    done: Promise<void>;
  } | null = null;
  private contracts = new Map<string, ContractDocument>();
  private models = new Map<string, ProjectIR>();
  async blockDocument(runId: string, file: string) {
    const ir = this.models.get(runId);
    if (!ir)
      throw new StudioError(
        409,
        "Check the current source to open its blocks.",
      );
    return describeBlocks(ir, await this.path(file, true));
  }
  private trials = new Set<{
    abort: AbortController;
    done: Promise<unknown>;
  }>();
  async declarationContext(runId: string, file: string) {
    const ir = this.models.get(runId);
    if (!ir)
      throw new StudioError(
        409,
        "Check the current source before adding a declaration.",
      );
    const context = declarationContext(ir, await this.path(file, true));
    return {
      ...context,
      types: context.types.map((type) => ({
        ...type,
        file: relative(this.root, type.file).split(sep).join("/"),
        symbolId:
          relative(this.root, type.file).split(sep).join("/") + "#" + type.name,
      })),
    };
  }
  private declarationInventories = new Map<
    string,
    { base: string; directory: string; value: DeclarationTypeInventory }
  >();
  async declarationTypes(runId: string, raw: unknown, signal: AbortSignal) {
    const ir = this.models.get(runId),
      run = this.runs.find((r) => r.id === runId);
    if (!ir || !run)
      throw new StudioError(
        409,
        "Check the current source before searching project types.",
      );
    const buffers: Record<string, string> = {};
    for (const [file, text] of Object.entries(run.request.buffers))
      buffers[await this.path(file, "buffer")] = text;
    return this.declarationTypesForModel(ir, buffers, raw, signal);
  }
  async declarationTypesForModel(
    ir: ProjectIR,
    buffers: Record<string, string>,
    raw: unknown,
    signal: AbortSignal,
  ) {
    const query = declarationTypeQuerySchema.parse(raw);
    if (query.inventoryId) {
      const prior = this.declarationInventories.get(query.inventoryId);
      if (!prior || prior.base !== ir.snapshot.id)
        throw new StudioError(
          409,
          "The project type list expired or belongs to an older check. Refresh it; your selections are retained.",
        );
      return {
        ...declarationTypePage(prior.value, query),
        directory: prior.directory,
      };
    }
    if (query.offset)
      throw new StudioError(400, "Continue type pages with their inventoryId.");
    const directory = relative(this.root, resolve(this.root, query.directory))
      .split(sep)
      .join("/");
    if (
      directory === ".." ||
      directory.startsWith("../") ||
      isAbsolute(directory)
    )
      throw new StudioError(400, "Search a directory inside this project.");
    if (!query.refresh) {
      const cached = [...this.declarationInventories.values()]
        .reverse()
        .find(
          (item) =>
            item.base === ir.snapshot.id &&
            item.directory === (directory || "."),
        );
      if (cached)
        return {
          ...declarationTypePage(cached.value, query),
          directory: cached.directory,
        };
    }
    const abort = new AbortController(),
      combined = AbortSignal.any([signal, abort.signal]);
    const done = (async () => {
      combined.throwIfAborted();
      if (this.closed) throw new StudioError(503, "Studio is closing");
      const inventory = await this.inventory(undefined, combined);
      const files = new Map(
        inventory.files.map((file) => [
          file.path,
          {
            file: file.path,
            ...(file.loaded === false ? {} : { text: file.text }),
          },
        ]),
      );
      for (const [file, text] of Object.entries({
        ...buffers,
        ...Object.fromEntries(ir.snapshot.sources.map((s) => [s.file, s.text])),
      })) {
        const path = relative(this.root, file).split(sep).join("/");
        if (path === ".." || path.startsWith("../") || isAbsolute(path))
          throw new StudioError(400, "Type source is outside this project.");
        files.set(path, { file: path, text });
      }
      const inputs = [...files.values()].filter(
        (item) => !directory || item.file.startsWith(directory + "/"),
      );
      const value = await queryDeclarationTypes(
        this.root,
        inputs,
        inventory.complete ? [] : inventory.warnings,
        combined,
      );
      combined.throwIfAborted();
      this.declarationInventories.set(value.id, {
        base: ir.snapshot.id,
        directory: directory || ".",
        value,
      });
      while (this.declarationInventories.size > 3)
        this.declarationInventories.delete(
          this.declarationInventories.keys().next().value!,
        );
      return {
        ...declarationTypePage(value, query),
        directory: directory || ".",
      };
    })();
    const job = { abort, done };
    this.implementationQueries.add(job);
    try {
      return await done;
    } finally {
      this.implementationQueries.delete(job);
    }
  }
  async validateDeclarationSources(
    value: unknown,
    rawBuffers: unknown,
    signal: AbortSignal,
  ) {
    const abort = new AbortController(),
      combined = AbortSignal.any([signal, abort.signal]);
    const done = (async () => {
      combined.throwIfAborted();
      if (this.closed) throw new StudioError(503, "Studio is closing");
      if (!Array.isArray(value) || value.length > 2048)
        throw new StudioError(400, "Invalid imported source expectations.");
      const buffers =
        rawBuffers &&
        typeof rawBuffers === "object" &&
        !Array.isArray(rawBuffers)
          ? (rawBuffers as Record<string, unknown>)
          : {};
      let totalBytes = 0;
      const supplied = new Map<string, string>();
      for (const [name, text] of Object.entries(buffers)) {
        if (typeof text !== "string")
          throw new StudioError(400, "Source buffers must be text.");
        totalBytes += Buffer.byteLength(text);
        if (totalBytes > 8 * 1024 * 1024)
          throw new StudioError(413, "Source buffers exceed 8 MiB.");
        supplied.set(await this.path(name, "buffer"), text);
      }
      const seen = new Set<string>();
      for (const raw of value) {
        combined.throwIfAborted();
        if (
          !raw ||
          typeof raw !== "object" ||
          typeof raw.file !== "string" ||
          typeof raw.hash !== "string" ||
          !/^[a-f0-9]{64}$/.test(raw.hash)
        )
          throw new StudioError(400, "Invalid imported source expectation.");
        const file = await this.path(raw.file, "buffer");
        if (seen.has(file))
          throw new StudioError(400, "Each imported source must occur once.");
        seen.add(file);
        const text = supplied.get(file);
        const actual =
          text === undefined
            ? await this.sourceFile(raw.file, combined)
            : { hash: hash(text), text };
        totalBytes += Buffer.byteLength(actual.text);
        if (totalBytes > 40 * 1024 * 1024)
          throw new StudioError(
            413,
            "Imported source validation exceeds its byte budget.",
          );
        if (actual.hash !== raw.hash)
          throw new StudioError(
            409,
            "An imported type source changed after this preview. Check the current source, refresh the type choices and preview again.",
          );
      }
      return { valid: true };
    })();
    const job = { abort, done };
    this.implementationQueries.add(job);
    try {
      return await done;
    } finally {
      this.implementationQueries.delete(job);
    }
  }
  async previewDeclaration(
    runId: string,
    file: string,
    value: unknown,
    sourceHash: string,
    selections: unknown = [],
    signal: AbortSignal = new AbortController().signal,
  ) {
    const ir = this.models.get(runId),
      run = this.runs.find((r) => r.id === runId);
    if (!ir || !run)
      throw new StudioError(
        409,
        "Check the current source before adding a declaration.",
      );
    const buffers: Record<string, string> = {};
    for (const [path, text] of Object.entries(run.request.buffers))
      buffers[await this.path(path, "buffer")] = text;
    return this.previewDeclarationForModel(
      ir,
      buffers,
      file,
      value,
      sourceHash,
      selections,
      signal,
    );
  }
  async previewDeclarationForModel(
    ir: ProjectIR,
    buffers: Record<string, string>,
    file: string,
    value: unknown,
    sourceHash: string,
    selections: unknown,
    signal: AbortSignal,
  ) {
    const path = await this.path(file, true);
    const resolveSymbol = async (id: string) => {
      const split = id.lastIndexOf("#");
      if (split < 1 || !/^\w+$/.test(id.slice(split + 1)))
        throw new StudioError(
          400,
          "Choose a type by its file and symbol identity.",
        );
      return (await this.path(id.slice(0, split), "buffer")) + id.slice(split);
    };
    const normalized = await normalizeDeclarationSymbols(value, resolveSymbol);
    const selected = [];
    for (const item of declarationTypeSelectionsSchema.parse(selections))
      selected.push({
        ...item,
        file: await this.path(item.file, "buffer"),
        symbolId: await resolveSymbol(item.symbolId),
      });
    const abort = new AbortController(),
      combined = AbortSignal.any([signal, abort.signal]);
    combined.throwIfAborted();
    if (this.closed) throw new StudioError(503, "Studio is closing");
    const done = previewDeclarationImports({
      ir,
      root: this.root,
      file: path,
      value: normalized,
      sourceHash,
      selections: selected,
      buffers,
      sourcePolicy: (await loadConfig(this.root)).config.sources ?? {},
      signal: combined,
    });
    const job = { abort, done };
    this.implementationQueries.add(job);
    try {
      return await done;
    } catch (error) {
      throw new StudioError(
        error instanceof DeclarationImportConflict ? 409 : 400,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.implementationQueries.delete(job);
    }
  }
  interfaceTypes(runId: string, file: string) {
    const ir = this.models.get(runId);
    if (!ir)
      throw new StudioError(
        409,
        "Check the source to load its available types.",
      );
    return {
      types: describeInterfaceTypes(ir, file),
      snapshotId: ir.snapshot.id,
    };
  }
  async resourceContext(runId: string, file: string, name: string) {
    const ir = this.models.get(runId);
    if (!ir)
      throw new StudioError(
        409,
        "Check the current source before editing its resource lifecycle.",
      );
    const path = await this.path(file, true);
    const matches = ir.declarations.filter(
      (d) => d.kind === "resource" && d.name === name && d.span.file === path,
    );
    if (matches.length !== 1)
      throw new StudioError(
        409,
        "The resource was removed, renamed or is ambiguous. Your saved form is kept; restore the resource in Text or discard the form explicitly.",
      );
    return describeResourceDefinition(ir, matches[0]!.id);
  }
  operationContract(runId: string, symbolId: string) {
    const ir = this.models.get(runId);
    if (!ir)
      throw new StudioError(
        409,
        "Check the current source before inspecting this operation contract.",
      );
    if (!["op", "flow"].includes(ir.symbols.get(symbolId)?.kind ?? "")) {
      const split = symbolId.lastIndexOf("#");
      const name = symbolId.slice(split + 1);
      const file =
        split >= 0
          ? relative(this.root, symbolId.slice(0, split)).replaceAll("\\", "/")
          : "this design";
      throw new StudioError(
        409,
        `The operation ${name} is no longer available in ${file}; it may have been renamed or removed. Your saved form is kept. Download it before discarding, or restore the original operation in Text and check again.`,
      );
    }
    return describeOperationContract(ir, symbolId);
  }
  previewOperationContract(
    runId: string,
    symbolId: string,
    value: unknown,
    sourceHash: string,
  ) {
    const ir = this.models.get(runId);
    if (!ir)
      throw new StudioError(
        409,
        "Check the current source before editing this operation contract.",
      );
    const description = this.operationContract(runId, symbolId);
    if (description.sourceHash !== sourceHash)
      throw new StudioError(
        409,
        "The operation source changed. Check it before previewing.",
      );
    try {
      return rewriteOperationContract(ir, symbolId, value, sourceHash);
    } catch (error) {
      throw new StudioError(
        400,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  interfaceResource(runId: string, symbolId: string) {
    const ir = this.models.get(runId);
    if (!ir)
      throw new StudioError(
        409,
        "Check the current source before inspecting its resource lifecycle.",
      );
    return describeResourceDefinition(ir, symbolId);
  }
  previewResource(
    runId: string,
    symbolId: string,
    value: unknown,
    sourceHash: string,
  ) {
    const ir = this.models.get(runId);
    if (!ir)
      throw new StudioError(
        409,
        "Check the current source before editing its resource lifecycle.",
      );
    const description = describeResourceDefinition(ir, symbolId);
    if (description.sourceHash !== sourceHash)
      throw new StudioError(
        409,
        "The resource source changed. Check it again before previewing.",
      );
    try {
      return rewriteResourceDefinition(ir, symbolId, value, sourceHash);
    } catch (error) {
      throw new StudioError(
        400,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  interfaceType(runId: string, symbolId: string) {
    const ir = this.models.get(runId);
    if (!ir)
      throw new StudioError(
        409,
        "Check the current source to inspect its type.",
      );
    return describeTypeDefinition(ir, symbolId);
  }
  resumeInterface(runId: string, value: unknown) {
    const ir = this.models.get(runId);
    if (!ir)
      throw new StudioError(
        409,
        "Check the current source before resuming this interface.",
      );
    return resumeSignature(ir, readInterfaceDraft(value));
  }
  describeInterface(runId: string, symbolId: string) {
    const ir = this.models.get(runId);
    if (!ir)
      throw new StudioError(
        409,
        "Check the current source before editing its interface.",
      );
    return describeSignature(ir, symbolId);
  }
  previewInterface(
    runId: string,
    symbolId: string,
    value: unknown,
    sourceHash: string,
  ) {
    const ir = this.models.get(runId);
    if (!ir)
      throw new StudioError(
        409,
        "Check the current source before editing its interface.",
      );
    const description = describeSignature(ir, symbolId);
    if (description.sourceHash !== sourceHash)
      throw new StudioError(
        409,
        "The interface source changed. Check it again before applying this edit.",
      );
    try {
      return rewriteSignature(
        ir,
        symbolId,
        readSignatureEdit(value),
        sourceHash,
      );
    } catch (error) {
      throw new StudioError(
        400,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  previewType(
    runId: string,
    symbolId: string,
    value: unknown,
    sourceHash: string,
  ) {
    const ir = this.models.get(runId);
    if (!ir)
      throw new StudioError(
        409,
        "Check the current source before editing its data shape.",
      );
    const description = describeTypeDefinition(ir, symbolId);
    if (description.sourceHash !== sourceHash)
      throw new StudioError(
        409,
        "The data shape belongs to a different source snapshot. Check it again before applying this edit.",
      );
    try {
      return rewriteType(ir, symbolId, value, sourceHash);
    } catch (error) {
      throw new StudioError(
        400,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  async tryInputs(
    id: string,
    entry: string,
    inputs: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    const ir = this.models.get(id);
    if (!ir)
      throw new StudioError(
        409,
        "Check this source again to try its inputs; the older typed model is no longer retained.",
      );
    if (this.closed) throw new StudioError(503, "Studio is closing");
    if (this.trials.size >= 2)
      throw new StudioError(
        409,
        "Two input trials are already running. Cancel one before starting another.",
      );
    const abort = new AbortController(),
      cancel = () => abort.abort();
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    const done = tryFlowInWorker(ir, entry, inputs, abort.signal),
      job = { abort, done };
    this.trials.add(job);
    try {
      return await done;
    } finally {
      signal.removeEventListener("abort", cancel);
      this.trials.delete(job);
    }
  }
  async scaffold(
    id: string,
    target: string,
    body: ScaffoldBodyMode = defaultScaffoldBodyMode,
    signal: AbortSignal = new AbortController().signal,
    mode: import("../shared/outputs.js").OutputMode = "stubs",
  ) {
    const document = this.contracts.get(id);
    if (!document)
      throw new StudioError(
        409,
        "Check this source again to generate a scaffold; this older run has no retained contract model.",
      );
    return this.outputRegistry.emit(document, target, body, signal, mode);
  }
  async implementationCheck(
    id: string,
    options: ImplementationCheckOptions,
    signal: AbortSignal,
  ) {
    const run = this.runs.find((run) => run.id === id);
    if (
      !run?.report ||
      run.report.diagnostics.some((d) => d.severity === "error")
    )
      throw new StudioError(
        409,
        "Check a design without errors before generating its implementation check.",
      );
    const contracts = await this.scaffold(
      id,
      options.target,
      "fail-fast",
      signal,
      "contracts",
    );
    signal.throwIfAborted();
    return emitImplementationCheck(contracts, options);
  }
  private listeners = new Set<(event: StudioEvent) => void>();
  private closed = false;
  private closing: Promise<void> | null = null;
  private recoveryStore: RecoveryStore | null = null;
  private recovery: RecoveryView = {
    revision: 0,
    drafts: [],
    context: null,
    enabled: false,
    error: null,
  };
  private saveQueue = Promise.resolve();
  private startQueue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly root: string,
    readonly initialFile: string | null = null,
    readonly outputRegistry: OutputRegistry = OutputRegistry.empty(),
  ) {}
  async initializeRecovery() {
    try {
      const { RecoveryStore } = await import("./recovery.js");
      this.recoveryStore = await RecoveryStore.openOrCreate(this.root);
      const runs = this.recoveryStore.runs();
      this.recovery = this.recoveryStore.read();
      for (const draft of this.recovery.drafts)
        await this.path(draft.path, true);
      this.runs.push(...runs);
    } catch (error) {
      this.recovery = {
        ...this.recovery,
        enabled: false,
        error: `Recovery unavailable: ${String(error)}. Your source files are unchanged.`,
      };
      this.recoveryStore?.close();
      this.recoveryStore = null;
    }
  }
  readRecovery() {
    if (!this.recoveryStore)
      throw new StudioError(
        503,
        this.recovery.error ?? "Recovery is unavailable",
      );
    return this.recoveryStore.read();
  }
  async saveRecovery(
    expectedRevision: number,
    value: unknown,
    owner: string | null = null,
  ) {
    if (this.closed) throw new StudioError(503, "Studio is closing");
    let output: RecoveryView | undefined;
    const task = this.saveQueue.then(async () => {
      if (!this.recoveryStore)
        throw new StudioError(
          503,
          this.recovery.error ?? "Recovery is unavailable",
        );
      if (
        !value ||
        typeof value !== "object" ||
        !("drafts" in value) ||
        !Array.isArray(value.drafts)
      )
        throw new StudioError(400, "Invalid draft recovery");
      for (const draft of value.drafts) {
        if (!draft || typeof draft.path !== "string")
          throw new StudioError(400, "Invalid draft path");
        await this.path(draft.path, true);
      }
      try {
        const normalized: Record<string, unknown> = {
          ...value,
          drafts: value.drafts.map((draft) => ({
            ...draft,
            path: sharedProjectPath(this.root, draft.path),
          })),
        };
        if (
          "context" in value &&
          value.context &&
          typeof value.context === "object" &&
          "file" in value.context &&
          typeof value.context.file === "string"
        )
          normalized.context = {
            ...value.context,
            file: sharedProjectPath(this.root, value.context.file),
          };
        this.recovery = this.recoveryStore.save(expectedRevision, normalized);
        output = this.recovery;
        this.emit({
          kind: "recovery",
          revision: this.recovery.revision,
          owner,
        });
      } catch (error) {
        throw new StudioError(
          error instanceof Error && error.name === "RecoveryConflict"
            ? 409
            : 400,
          String(error),
        );
      }
    });
    this.saveQueue = task.catch(() => {});
    await task;
    return output!;
  }
  private persistRun(run: StudioRun) {
    if (!this.recoveryStore) return;
    try {
      this.recoveryStore.saveRun(run);
    } catch (error) {
      run.persistenceError = `Run history could not be saved: ${String(error)}`;
      this.recovery = { ...this.recovery, error: run.persistenceError };
    }
  }
  subscribe(listener: (event: StudioEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(event: StudioEvent): void {
    if (event.kind === "run") event.run.sequence++;
    for (const listener of this.listeners) listener(event);
  }
  async path(
    name: string,
    allowNew: boolean | "buffer" = false,
  ): Promise<string> {
    if (!name || name.includes("\0") || name.includes("\\"))
      throw new StudioError(400, "Invalid project path");
    const requested = resolve(this.root, name);
    const relativePath = relative(this.root, requested);
    if (relativePath === ".." || relativePath.startsWith(".." + sep))
      throw new StudioError(403, "Path outside project root");
    let canonical: string;
    try {
      canonical = await realpath(requested);
    } catch (e) {
      if (!allowNew) throw new StudioError(404, "File not found");
      let parent = dirname(requested);
      const missing = [requested.split(sep).at(-1)!];
      for (;;) {
        try {
          canonical = resolve(await realpath(parent), ...missing);
          break;
        } catch (error) {
          if (
            allowNew &&
            (error as NodeJS.ErrnoException).code === "ENOENT" &&
            parent !== dirname(parent)
          ) {
            missing.unshift(parent.split(sep).at(-1)!);
            parent = dirname(parent);
            continue;
          }
          throw new StudioError(
            400,
            `Folder “${relative(this.root, dirname(requested)) || "."}” does not exist. Choose an existing folder.`,
          );
        }
      }
    }
    const child = relative(this.root, canonical);
    if (
      child === ".." ||
      child.startsWith(".." + sep) ||
      resolve(canonical) === this.root
    )
      throw new StudioError(403, "Path outside project root");
    if (extname(canonical) !== identity.extension)
      throw new StudioError(400, "Only specification source files are allowed");
    return canonical;
  }
  async sourceFile(
    name: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<StudioFile> {
    const path = await this.path(name);
    if ((await stat(path)).size > sourceFileByteLimit)
      throw new StudioError(
        413,
        "Source exceeds 2 MiB; split the file before checking it",
      );
    let bytes: Buffer;
    try {
      bytes = await readSourceBytes(path, signal);
    } catch (error) {
      if (error instanceof SourceReadError)
        throw new StudioError(
          error.kind === "too-large" ? 413 : 400,
          error.message,
        );
      throw error;
    }
    const text = decodeUtf8(bytes, name);
    return {
      path: relative(this.root, path),
      text,
      hash: hash(text),
      loaded: true,
    };
  }
  private async inventory(preferred?: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const { config } = await loadConfig(this.root);
    const paths: string[] = [],
      warnings: string[] = [];
    const directories = [this.root];
    let complete = true;
    for (
      let index = 0;
      index < directories.length && paths.length < 10000;
      index++
    ) {
      signal?.throwIfAborted();
      const dir = directories[index]!;
      let entries: import("node:fs").Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (dir === this.root) throw error;
        complete = false;
        warnings.push(
          `${relative(this.root, dir)}: directory could not be listed; files within it are unavailable.`,
        );
        continue;
      }
      for (const entry of entries.sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      )) {
        if (paths.length >= 10000) break;
        if (sourceDirectoryExcluded(entry.name, config.sources)) continue;
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (
            directoryMayContainSource(relative(this.root, path), config.sources)
          )
            directories.push(path);
        } else if (
          entry.isFile() &&
          extname(path) === identity.extension &&
          sourceIncluded(relative(this.root, path), config.sources)
        )
          paths.push(path);
      }
    }
    if (paths.length >= 10000) {
      complete = false;
      warnings.push(
        "Showing at most 10,000 source files. Narrow sources.include/exclude in .pymtheg/settings.json to browse a smaller source set.",
      );
    }
    const chosen = preferred ? resolve(this.root, preferred) : undefined;
    const forced = new Set([
      ...(chosen ? [chosen] : []),
      ...this.recovery.drafts.map((d) => resolve(this.root, d.path)),
    ]);
    if (chosen && !paths.includes(chosen) && existsSync(chosen))
      paths.unshift(chosen);
    paths.sort((a, b) =>
      forced.has(a) !== forced.has(b)
        ? forced.has(a)
          ? -1
          : 1
        : a < b
          ? -1
          : a > b
            ? 1
            : 0,
    );
    const files: StudioFile[] = [];
    let bytes = 0,
      lazy = false;
    for (const path of paths) {
      signal?.throwIfAborted();
      const name = relative(this.root, path);
      try {
        const size = (await stat(path)).size;
        if (size > 2 * 1024 * 1024) {
          complete = false;
          warnings.push(name + ": exceeds the 2 MiB per-file limit");
          continue;
        }
        if (bytes + size > 8 * 1024 * 1024 && !forced.has(path)) {
          files.push({ path: name, text: "", hash: "", loaded: false });
          lazy = true;
          continue;
        }
        const file = await this.sourceFile(name, signal);
        bytes += Buffer.byteLength(file.text);
        files.push(file);
      } catch (error) {
        complete = false;
        warnings.push(
          name +
            ": could not be loaded (" +
            (error instanceof Error ? error.message : String(error)) +
            ")",
        );
      }
    }
    if (lazy)
      warnings.push(
        "Only 8 MiB of source text is preloaded. Other listed files load when opened.",
      );
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { files, warnings, complete };
  }
  async files(): Promise<StudioFile[]> {
    return (await this.inventory()).files;
  }
  async project(): Promise<ProjectView> {
    const { config, hash: configHash } = await loadConfig(this.root);
    const inventory = await this.inventory(
      this.initialFile ?? config.defaultFile,
    );
    const workspace = await readWorkspace(this.root);
    return {
      inventoryWarnings: inventory.warnings,
      workspace,
      ...(workspace ? { trust: await checkoutTrust(this.root) } : {}),
      root: this.root,
      outputTargets: this.outputRegistry.targets(),
      architectureAvailable: existsSync(storagePath(this.root, "planning")),
      agentConnection: {
        command: process.execPath,
        args: [
          fileURLToPath(new URL("../cli/main.js", import.meta.url)),
          "mcp",
          this.root,
          ...this.outputRegistry.launchArguments(),
        ],
      },
      files: inventory.files,
      runs: this.runs,
      config,
      configHash,
      recovery: this.recovery,
      defaultFile: this.initialFile ?? config.defaultFile ?? null,
    };
  }
  async save(
    name: string,
    text: string,
    expectedHash: string | null,
  ): Promise<StudioFile> {
    if (Buffer.byteLength(text) > 2 * 1024 * 1024)
      throw new StudioError(413, "Source exceeds 2 MiB");
    const path = await this.path(name, true);
    const policy = (await loadConfig(this.root)).config.sources;
    const excluded = relative(this.root, path)
      .split(sep)
      .find((part) => sourceDirectoryExcluded(part, policy));
    if (excluded)
      throw new StudioError(
        400,
        `Folder “${excluded}” is excluded from this workspace. Choose another location.`,
      );
    if (!sourceIncluded(relative(this.root, path), policy))
      throw new StudioError(
        400,
        "This path is outside sources.include/exclude in .pymtheg/settings.json. Choose an included location or update that configuration.",
      );
    let output: StudioFile | undefined;
    const task = this.saveQueue.then(async () => {
      let current: string | null = null;
      try {
        current = hash(await readFile(path, "utf8"));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (current !== expectedHash)
        throw new StudioError(
          409,
          expectedHash === null
            ? `${name} already exists. Choose another name.`
            : current === null
              ? "File was deleted on disk. Recreate it explicitly or save a separate copy; your buffer is preserved."
              : "File changed on disk. Reload or save a separate copy; your buffer is preserved.",
        );
      if ((await this.path(name, true)) !== path)
        throw new StudioError(
          409,
          "The source location changed; reopen its current folder before saving.",
        );
      await mkdir(dirname(path), { recursive: true });
      if ((await this.path(name, true)) !== path)
        throw new StudioError(
          409,
          "The source location changed before saving.",
        );
      await atomicWrite(path, text);
      output = { path: relative(this.root, path), text, hash: hash(text) };
      this.emit({ kind: "saved", file: output });
    });
    this.saveQueue = task.catch(() => {});
    await task;
    return output!;
  }
  async saveScenario(
    name: string,
    value: unknown,
    expectedHash: string | null,
  ) {
    if (!name.trim() || name.length > 80)
      throw new StudioError(400, "Choose a scenario name of 1–80 characters");
    const selected = scenario(value);
    await this.path(selected.file);
    let output: Awaited<ReturnType<typeof loadConfig>> | undefined;
    const task = this.saveQueue.then(async () => {
      const current = await loadConfig(this.root);
      if (current.hash !== expectedHash)
        throw new StudioError(
          409,
          "Project scenarios changed on disk. Reload the project before saving; the form is preserved.",
        );
      const config = {
        ...current.config,
        scenarios: { ...current.config.scenarios, [name.trim()]: selected },
      };
      const text = json(config);
      await atomicWrite(storagePath(this.root, "settings", true), text);
      output = { config, hash: hash(text) };
    });
    this.saveQueue = task.catch(() => {});
    await task;
    return output!;
  }
  async start(request: RunRequest): Promise<StudioRun> {
    const result = this.startQueue.then(() => this.startNext(request));
    this.startQueue = result.catch(() => {});
    return result;
  }
  private async startNext(request: RunRequest): Promise<StudioRun> {
    if (this.closed) throw new StudioError(503, "Studio is closing");
    const hasEntryBuffer = Object.keys(request.buffers).some(
      (name) => resolve(this.root, name) === resolve(this.root, request.file),
    );
    const entry = await this.path(
      request.file,
      hasEntryBuffer ? "buffer" : false,
    );
    const buffers: Record<string, string> = Object.create(null) as Record<
      string,
      string
    >;
    for (const [name, text] of Object.entries(request.buffers))
      buffers[await this.path(name, "buffer")] = text;
    const previous = this.active;
    if (previous) {
      previous.run.status = "superseded";
      previous.abort.abort();
      this.emit({ kind: "run", run: previous.run });
      await previous.done;
    }
    const run: StudioRun = {
      sequence: 0,
      id: randomUUID(),
      request: structuredClone(request),
      status: "running",
      phase: "loading",
      report: null,
      symbols: [],
      error: null,
    };
    this.runs.unshift(run);
    this.persistRun(run);
    this.runs.splice(10);
    const abort = new AbortController();
    const done = this.execute(run, entry, buffers, abort.signal);
    this.active = { run, abort, done };
    void done.finally(() => {
      if (this.active?.run.id === run.id) this.active = null;
    });
    this.emit({ kind: "run", run });
    return run;
  }
  private async execute(
    run: StudioRun,
    file: string,
    buffers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const { ir, report } = await analyseInWorker({
        file,
        signal,
        workerData: {
          buffers,
          root: this.root,
          related: run.request.kind === "check",
          sourcePolicy: (await loadConfig(this.root)).config.sources ?? {},
        },
        onProgress: (event) => {
          run.phase = event.kind;
          this.emit({ kind: "run", run });
        },
      });
      run.report = report;
      if (ir && !signal.aborted) {
        this.contracts.set(run.id, contractDocument(ir));
        this.models.set(run.id, ir);
        while (this.models.size > 3)
          this.models.delete(this.models.keys().next().value!);
        while (this.contracts.size > 3)
          this.contracts.delete(this.contracts.keys().next().value!);
        run.phase = "preparing input controls";
        this.emit({ kind: "run", run });
        run.symbols = await this.symbols(ir, signal);
        signal.throwIfAborted();
        if (run.request.kind !== "check") {
          run.phase = "backend";
          this.emit({ kind: "run", run });
          const results = await runBackend(
            ir,
            {
              entry: run.request.entry,
              method: run.request.kind === "verify" ? "exhaustive" : "sample",
              seed: run.request.seed,
              maxSteps: run.request.maxSteps,
              maxSamples: run.request.maxSamples,
              timeoutMs: run.request.timeoutMs ?? 45000,
              scopeFile: null,
              scope: run.request.scope,
            },
            signal,
          );
          report.results.push(...results);
          report.diagnostics.push(...results.flatMap((r) => r.diagnostics));
        }
        report.session.requested = run.request.kind;
        report.session.staleFiles = await staleSourcesAsync(
          ir.snapshot.sources.filter(
            (source) => !Object.hasOwn(buffers, source.file),
          ),
          signal,
        );
      }
      if (signal.aborted) report.session.state = "Cancelled";
      if (run.status !== "superseded")
        run.status = signal.aborted
          ? "cancelled"
          : report.session.state === "Failed"
            ? "failed"
            : "completed";
      run.phase = "finished";
    } catch (e) {
      run.error = String(e);
      if (run.report)
        run.report.session.state = signal.aborted ? "Cancelled" : "Failed";
      if (run.status !== "superseded")
        run.status = signal.aborted ? "cancelled" : "failed";
      run.phase = "finished";
    } finally {
      this.persistRun(run);
      this.emit({ kind: "run", run });
    }
  }
  private async symbols(
    ir: ProjectIR,
    signal: AbortSignal,
  ): Promise<SymbolView[]> {
    await yieldToCoordinator();
    signal.throwIfAborted();
    let visits = 0;
    const typeText = (t: import("../language/ast.js").TypeRef): string =>
      t.name +
      (t.args.length ? "<" + t.args.map(typeText).join(", ") + ">" : "");
    const references = new Map<
      string,
      import("../shared/identity.js").Span[]
    >();
    function* targets() {
      for (const [key, info] of ir.info)
        if (ir.types.get(key)?.kind !== "nominal")
          yield [key, info.target] as const;
      for (const [key, type] of ir.types)
        if (type.kind === "nominal") yield [key, type.id] as const;
    }
    for (const [key, target] of targets()) {
      if (++visits % 256 === 0) {
        await yieldToCoordinator();
        signal.throwIfAborted();
      }
      if (target) {
        const endAt = key.lastIndexOf(":"),
          startAt = key.lastIndexOf(":", endAt - 1);
        const span = {
          file: key.slice(0, startAt),
          start: Number(key.slice(startAt + 1, endAt)),
          end: Number(key.slice(endAt + 1)),
        };
        const list = references.get(target) ?? [];
        list.push(span);
        references.set(target, list);
      }
    }

    const visibleFrom = new Map<string, string[]>();
    for (const [file, names] of ir.visibleSymbols)
      for (const ids of names.values()) {
        if (++visits % 256 === 0) {
          await yieldToCoordinator();
          signal.throwIfAborted();
        }
        if (ids.length !== 1) continue;
        const files = visibleFrom.get(ids[0]!) ?? [];
        files.push(file);
        visibleFrom.set(ids[0]!, files);
      }
    const budget = { remaining: Number(guidedShapeLimits.perRun) };
    const shapeCache = new Map<string, ReturnType<typeof valueShape>>();
    const shape = (type: Type | undefined) => {
      const key = type ? typeKey(type) : "unresolved";
      let known = shapeCache.get(key);
      if (!known) {
        known = valueShape(ir, type, budget);
        shapeCache.set(key, known);
      }
      return known;
    };
    const output: SymbolView[] = [];
    for (let i = 0; i < ir.declarations.length; i++) {
      if (i % guidedShapeLimits.metadataChunk === 0) {
        await yieldToCoordinator();
        signal.throwIfAborted();
      }
      const d = ir.declarations[i]!;
      output.push({
        visibleFrom: visibleFrom.get(d.id) ?? [],
        id: d.id,
        name: d.name,
        kind: d.kind,
        span: d.span,
        references: references.get(d.id) ?? [],
        signature: callable(d)
          ? `${d.name}(${d.params.map((p) => `${p.mode === "value" ? "" : p.mode + " "}${p.name}: ${typeText(p.type)}`).join(", ")}) → ${typeText(d.result)}`
          : d.name,
        ...(callable(d)
          ? {
              headerEnd: d.result.span.end,
              callable: {
                parameters: d.params.map((p) => ({
                  name: p.name,
                  mode: p.mode,
                  shape: shape(ir.types.get(nodeKey(p.type.span))),
                  ...(ir.types.get(nodeKey(p.type.span))?.kind !== "error" &&
                  ir.types.has(nodeKey(p.type.span))
                    ? { typeKey: typeKey(ir.types.get(nodeKey(p.type.span))!) }
                    : {}),
                  ...(d.meta.bounds[p.name] !== undefined
                    ? { bound: String(d.meta.bounds[p.name]) }
                    : {}),
                })),
                result: shape(ir.types.get(nodeKey(d.result.span))),
                abstract: d.kind === "op",
                protocol: !!d.meta.protocol,
              },
            }
          : {}),
        ...(d.kind === "machine"
          ? {
              machineDomains: Object.fromEntries(
                d.states.map((s) => [
                  s.name,
                  s.type.name === "Bool" ? "Bool" : `${s.min}..${s.max}`,
                ]),
              ),
            }
          : {}),
        ...(d.kind === "resource"
          ? {
              states: d.states,
              terminal: d.terminal,
              initial: d.initial,
              transitions: d.transitions,
            }
          : {}),
      });
    }
    return output;
  }
  cancel(id: string): void {
    if (this.active?.run.id !== id)
      throw new StudioError(404, "Run is not active");
    this.active.abort.abort();
  }
  close(): Promise<void> {
    return (this.closing ??= this.closeResources());
  }
  private async closeResources(): Promise<void> {
    this.closed = true;
    for (const job of this.implementationQueries) job.abort.abort();
    await Promise.allSettled(
      [...this.implementationQueries].map((job) => job.done),
    );
    this.implementationFileCatalog?.clear();
    await this.outputRegistry.close();
    for (const trial of this.trials) trial.abort.abort();
    await Promise.allSettled([...this.trials].map((job) => job.done));
    this.active?.abort.abort();
    await this.startQueue;
    await this.active?.done;
    await this.saveQueue;
    this.recoveryStore?.close();
    this.recoveryStore = null;
    this.listeners.clear();
    this.preparedImport = null;
    this.preparedHistory = null;
    this.contracts.clear();
    this.models.clear();
    this.sourceCatalogues.clear();
    this.sourceCatalogueFiles.clear();
    this.sourceCatalogueKey = null;
    if (this.architectureJob) {
      this.architectureJob.abort.abort();
      await this.architectureJob.done.catch(() => {});
    }
    if (this.architectureReader) {
      const reader = await this.architectureReader;
      await reader.closeReadWorkers();
      reader.close();
    }
    if (this.architectureStore) {
      const writer = await this.architectureStore;
      await writer.closeReadWorkers();
      writer.close();
    }
  }
}
