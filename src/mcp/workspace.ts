// SPDX-License-Identifier: MIT
import { LinkJobs } from "./links-jobs.js";
import { GraphJobs } from "./graph-jobs.js";
import { findWorkspace } from "../project/workspace.js";
import { ProjectInventories, type InventoryQuery } from "./inventories.js";
import { agentLimits } from "./limits.js";
import { EmissionStore } from "./emissions.js";
import { traceSteps } from "../reporting/trace.js";
import { OutputRegistry } from "../contracts/registry.js";
import { outputTargetIds } from "../shared/outputs.js";
import { realpath, stat } from "node:fs/promises";
import { relative } from "node:path";
import { randomUUID } from "node:crypto";
import { StudioService } from "../studio/service.js";
import { analyseInWorker } from "../cli/coordinator.js";
import { runBackend } from "../backends/adapter.js";
import { staleSourcesAsync } from "../language/project.js";
import { type Report, exitStatus } from "../reporting/report.js";
import type { ProjectIR } from "../semantic/core.js";
export interface AgentRun {
  id: string;
  file: string;
  kind: string;
  report: Report;
  ir: ProjectIR | null;
  overlays: string[];
  inputBuffers?: Record<string, string>;
  planImpact?: Awaited<ReturnType<StudioService["candidatePlanImpact"]>> | null;
  planImpactError?: string;
}
export interface AgentRequest {
  file: string;
  checkScope?: "project" | "entry" | "related";
  buffers?: Record<string, string>;
  kind?: "check" | "simulate" | "verify";
  entry?: string;
  seed?: string;
  maxSteps?: number;
  maxSamples?: number;
  timeoutMs?: number;
  scope?: Record<string, unknown>;
}
export class AgentWorkspace {
  readonly links: LinkJobs;
  readonly graph: GraphJobs;
  readonly runs = new Map<string, AgentRun>();
  readonly emissions = new EmissionStore();
  readonly inventories = new ProjectInventories();
  readonly access: StudioService;
  private shutdown = new AbortController();
  private active: Promise<AgentRun> | null = null;
  private activeSignal: AbortSignal | null = null;
  private busy = false;
  constructor(
    readonly root: string,
    private analyse: typeof analyseInWorker = analyseInWorker,
    readonly outputs: OutputRegistry = OutputRegistry.empty(),
  ) {
    this.access = new StudioService(root);
    this.links = new LinkJobs(root);
    this.graph = new GraphJobs(root);
  }
  static async open(
    path: string,
    outputs: OutputRegistry = OutputRegistry.empty(),
  ) {
    const input = await realpath(path);
    const root = (await findWorkspace(input))?.root ?? input;
    if (!(await stat(root)).isDirectory())
      throw Error("MCP requires a project directory");
    return new AgentWorkspace(root, analyseInWorker, outputs);
  }
  async project(
    options: InventoryQuery & { inventoryId?: string | undefined } = {},
  ) {
    if ((options.offset ?? 0) > 0 && !options.inventoryId)
      throw Error(
        "Continue a page with the inventoryId returned by project_info",
      );
    const inventoryId =
      options.inventoryId ??
      this.inventories.capture(await this.access.project());
    return {
      ...this.inventories.read(inventoryId, options),
      runIds: [...this.runs.keys()],
      limits: {
        retainedRuns: 10,
        retainedTypedModels: 3,
        maximumResponseBytes: agentLimits.responseBytes,
        retainedEmissions: agentLimits.retainedEmissions,
        maximumEmissionBytes: agentLimits.emissionBytes,
        retainedInventories: agentLimits.retainedInventories,
      },
      capabilities: {
        sourceWrites: false,
        scaffolds: this.outputs.targets().map((t) => t.id),
        transport: "stdio",
      },
    };
  }
  async source(
    file: string,
    startLine = 1,
    limit = 100,
    signal: AbortSignal = new AbortController().signal,
  ) {
    const source = await this.access.sourceFile(file, signal);
    const lines = source.text.split("\n");
    return {
      file: source.path,
      startLine,
      lines: lines.slice(startLine - 1, startLine - 1 + limit),
      totalLines: lines.length,
    };
  }
  async run(
    request: AgentRequest,
    signal: AbortSignal,
    onProgress?: (phase: string) => void,
  ): Promise<AgentRun> {
    if (this.shutdown.signal.aborted) throw Error("Workspace is closed");
    if (this.busy && this.activeSignal?.aborted && this.active)
      await this.active.catch(() => {});
    signal.throwIfAborted();
    if (this.shutdown.signal.aborted) throw Error("Workspace is closed");
    if (this.busy)
      throw Error(
        "Another analysis is running. Wait for it or cancel its MCP request before starting another.",
      );
    this.busy = true;
    const runSignal = AbortSignal.any([signal, this.shutdown.signal]);
    const task = this.execute(request, runSignal, onProgress);
    this.active = task;
    this.activeSignal = runSignal;
    try {
      return await task;
    } finally {
      if (this.active === task) {
        this.active = null;
        this.activeSignal = null;
        this.busy = false;
      }
    }
  }
  private async execute(
    request: AgentRequest,
    signal: AbortSignal,
    onProgress?: (phase: string) => void,
  ): Promise<AgentRun> {
    const buffers: Record<string, string> = Object.create(null) as Record<
      string,
      string
    >;
    let bytes = 0;
    for (const [name, text] of Object.entries(request.buffers ?? {})) {
      bytes += Buffer.byteLength(text);
      if (bytes > 8 * 1024 * 1024) throw Error("Supplied buffers exceed 8 MiB");
      buffers[await this.access.path(name, "buffer")] = text;
    }
    const candidate = await this.access.path(request.file, "buffer");
    const file = Object.hasOwn(buffers, candidate)
      ? candidate
      : await this.access.path(request.file);
    const kind = request.kind ?? "check";
    const { ir, report, sourceCatalogue } = await this.analyse({
      file,
      signal,
      workerData: {
        root: this.root,
        sourceContracts: kind === "check",
        buffers,
        projectWide: kind === "check" && request.checkScope === "project",
        related:
          kind === "check" &&
          request.checkScope !== "entry" &&
          request.checkScope !== "project",
        sourcePolicy: (
          await import("../project/config.js").then((m) =>
            m.loadConfig(this.root),
          )
        ).config.sources,
      },
      onProgress: (event) => onProgress?.(event.kind),
    });
    if (ir && !signal.aborted && kind !== "check") {
      const results = await runBackend(
        ir,
        {
          entry: request.entry ?? "",
          method: kind === "verify" ? "exhaustive" : "sample",
          seed: request.seed ?? "42",
          maxSteps: request.maxSteps ?? 12,
          maxSamples: request.maxSamples ?? 1000,
          timeoutMs: request.timeoutMs ?? 45000,
          scopeFile: null,
          scope: request.scope ?? {},
        },
        signal,
      );
      report.results.push(...results);
      report.diagnostics.push(...results.flatMap((r) => r.diagnostics));
    }
    report.session.requested = kind;
    if (signal.aborted) report.session.state = "Cancelled";
    if (ir && !signal.aborted) {
      try {
        report.session.staleFiles = await staleSourcesAsync(
          ir.snapshot.sources.filter(
            (source) => !Object.hasOwn(buffers, source.file),
          ),
          signal,
        );
      } catch (error) {
        if (!signal.aborted) throw error;
        report.session.state = "Cancelled";
      }
    }
    const run: AgentRun = {
      id: randomUUID(),
      file,
      kind,
      report,
      ir,
      overlays: Object.keys(buffers),
      ...(ir ? { inputBuffers: buffers } : {}),
    };
    if (kind === "check" && !signal.aborted) {
      if (sourceCatalogue) {
        try {
          run.planImpact = await this.access.candidatePlanImpact(
            sourceCatalogue,
            report.snapshot.files.map((f) => relative(this.root, f.file)),
            signal,
          );
        } catch (error) {
          run.planImpactError = String(error);
        }
      } else
        run.planImpactError =
          "Planning impact is unavailable because this run did not retain a source catalogue.";
    }
    if (signal.aborted) report.session.state = "Cancelled";
    this.runs.set(run.id, run);
    const typed = [...this.runs.values()].filter((r) => r.ir);
    for (const old of typed.slice(0, -3)) {
      old.ir = null;
      delete old.inputBuffers;
    }
    while (this.runs.size > 10)
      this.runs.delete(this.runs.keys().next().value!);
    return run;
  }
  async get(id: string, signal: AbortSignal): Promise<AgentRun> {
    const run = this.runs.get(id);
    if (!run)
      throw Error(
        "Unknown or expired run ID. Runs are retained for this connection only.",
      );
    run.report.session.staleFiles = await staleSourcesAsync(
      run.report.snapshot.files.filter(
        (source) => !run.overlays.includes(source.file),
      ),
      signal,
    );
    return run;
  }
  summary(run: AgentRun) {
    const r = run.report;
    return {
      runId: run.id,
      file: relative(this.root, run.file),
      kind: run.kind,
      exitStatus: exitStatus(r),
      session: {
        ...r.session,
        staleFiles: r.session.staleFiles.map(
          (file) => relative(this.root, file) || ".",
        ),
      },
      snapshotId: r.snapshot.id,
      consumers: r.consumers
        ? {
            symbolCount: r.consumers.symbolIds.length,
            incompleteFiles: (r.consumers.incompleteFiles ?? []).map((file) =>
              relative(this.root, file),
            ),
            errors: r.consumers.diagnostics.filter(
              (d) => d.severity === "error",
            ).length,
            findings: r.consumers.diagnostics.length,
            meaning:
              "Related files include confirmed dependencies and unresolved references. They are separate from the selected file verdict. Read consumer_findings and consumer_properties.",
          }
        : null,
      usedUnsavedBuffers: run.overlays.map((p) => relative(this.root, p)),
      planImpact: run.planImpact
        ? {
            ...run.planImpact,
            items: run.planImpact.items.slice(0, 20),
            total: run.planImpact.items.length,
            nextOffset: run.planImpact.items.length > 20 ? 20 : null,
          }
        : {
            complete: false,
            reason:
              run.planImpactError ??
              "Planning impact was not checked for this run.",
          },
      findings: {
        errors: r.diagnostics.filter((d) => d.severity === "error").length,
        warnings: r.diagnostics.filter((d) => d.severity === "warning").length,
      },
      results: {
        total: r.results.length,
        /**
         * true when every behaviour result came from a completed exhaustive
         * search; false when any was sampled or stopped early; null without
         * behaviour results. A sampled no-counterexample run is not a proof.
         */
        exhaustive: r.results.some((p) => p.analysisKind === "behaviour")
          ? r.results
              .filter((p) => p.analysisKind === "behaviour")
              .every((p) => p.exhaustive === true)
          : null,
        complete: r.results.filter((p) => p.completion === "complete").length,
        unresolved: r.results.filter((p) => p.completion !== "complete").length,
        counterexamples: r.results.filter(
          (p) =>
            p.outcome === "counterexample" &&
            (p.witnessValidation === "source_replayed" ||
              (p.analysisKind === "behaviour" && traceSteps(p).length > 0)),
        ).length,
        structuralFindings: r.results.filter(
          (p) =>
            p.analysisKind !== "behaviour" &&
            p.outcome === "counterexample" &&
            p.witnessValidation !== "source_replayed",
        ).length,
      },
      meaning: r.session.staleFiles.length
        ? "These findings describe the captured source; files on disk have since changed."
        : exitStatus(r) === 0
          ? run.kind === "simulate"
            ? "Sampling found no counterexample within its seed, step and sample limits. The run is not exhaustive (exhaustive: false); use verify for an exhaustive check."
            : "The requested checks completed without error findings. This is not proof of the whole program."
          : exitStatus(r) === 1
            ? "The model has problems to investigate. Read the findings and their related declarations."
            : exitStatus(r) === 2
              ? "Some requested claims remain unresolved. Do not treat them as passed."
              : r.session.state === "Cancelled"
                ? "The run was cancelled. Only completed evidence is usable."
                : "The tool could not complete the requested analysis.",
      next: "Read this run with section findings, properties, costs or trace. Complete means that check finished, not that the design is fully correct.",
    };
  }
  async waitForIdle() {
    await this.active?.then(
      () => {},
      () => {},
    );
  }
  async close() {
    this.shutdown.abort();
    try {
      await Promise.all([this.links.close(), this.graph.close()]);
      await this.outputs.close();
      await this.active?.catch(() => {});
      await this.access.close();
    } finally {
      this.emissions.clear();
      this.inventories.clear();
    }
  }
}
