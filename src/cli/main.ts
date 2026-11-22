#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// First: drop only the node:sqlite and glob ExperimentalWarnings (early Node 24/25).
import "./quiet-warnings.js";
import { FormatSyntaxError } from "../language/format.js";
import { scopeIssueResult } from "../reporting/scope-issues.js";
import { renderImportSummary } from "./import-summary.js";
import { findWorkspace } from "../project/workspace.js";
import {
  OutputRegistry,
  outputPluginArguments,
} from "../contracts/registry.js";
import { newlyBrokenAuthoredLinks } from "../architecture/work.js";
import {
  mergeArchitectureImport,
  sourceRegistry,
} from "../architecture/import-merge.js";
import { withImportInventory } from "../architecture/import-policy.js";
import { invocationMessage, renderInvocationFailure } from "./errors.js";
import { help, commandNames } from "./help.js";
import {
  isScaffoldBodyMode,
  isOutputMode,
  pluginDeadline,
  defaultScaffoldBodyMode,
  isOutputTarget,
} from "../shared/outputs.js";
import { analyseInWorker } from "./coordinator.js";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { staleSourcesAsync, type Snapshot } from "../language/project.js";
import type { ProjectIR } from "../semantic/core.js";
import {
  emptyReport,
  exitStatus,
  renderText,
  result,
} from "../reporting/report.js";
import { atomicWrite } from "../reporting/publish.js";
import {
  identity,
  json,
  finding,
  hash,
  assertNever,
} from "../shared/identity.js";
import { lowerInWorker } from "../behaviour/runner.js";
import { modelDocument } from "../behaviour/model.js";
import { readFile } from "node:fs/promises";
import { runBackend, type BackendOptions } from "../backends/adapter.js";
import { findConfig } from "../project/config.js";
import { uncheckedBehaviourNotice } from "../reporting/explain.js";
const args = process.argv.slice(2);
const wantsJson = args.some(
  (a, i) => a === "--format" && args[i + 1] === "json",
);
let snapshot: Snapshot = {
    id: "unavailable",
    sources: [],
    diagnostics: [],
    measurements: { bytes: 0, files: 0, tokens: 0, parses: 0 },
  },
  report = emptyReport(args[0] ?? "invalid");
const cancel = new AbortController();
function writeReport() {
  if (wantsJson) process.stdout.write(json(report));
  else if (snapshot.sources.length === 0 && report.session.state === "Failed")
    process.stderr.write(renderInvocationFailure(report));
  else process.stdout.write(renderText(report, snapshot));
}
const onSignal = (): void => cancel.abort();
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
try {
  if (args.includes("--help")) {
    process.stdout.write(help());
  } else if (args[0] === "graph") {
    process.exitCode = await (
      await import("./graph.js")
    ).graphCommand(args.slice(1), cancel.signal);
  } else if (args[0] === "link") {
    process.exitCode = await (
      await import("./link.js")
    ).linkCommand(args.slice(1), cancel.signal);
  } else if (args[0] === "observe") {
    process.exitCode = await (
      await import("../implementation/cli.js")
    ).observeCommand(args.slice(1), cancel.signal);
  } else if (args[0] === "trust") {
    // D22: the user's trust answers, kept outside every checkout.
    const { listTrust, revokeTrust, trustFile } = await import(
      "../project/local-trust.js"
    );
    const rest = args
      .slice(1)
      .filter((arg) => arg !== "--format" && arg !== "json");
    if (rest[0] === "--revoke") {
      if (rest.length > 2)
        throw Error("Usage: pymtheg trust --revoke [DIRECTORY]");
      const target = resolve(rest[1] ?? ".");
      const removed = await revokeTrust(target);
      process.stdout.write(
        removed
          ? `Removed the trust answer for ${target}. The next init asks again; until then nothing from it runs.\n`
          : `No trust answer is recorded for ${target}.\n`,
      );
    } else if (rest.length === 0 || rest[0] === "--list") {
      const answers = await listTrust();
      if (wantsJson) process.stdout.write(json({ file: trustFile(), answers }));
      else
        process.stdout.write(
          [
            `Trust answers (${trustFile()}):`,
            ...(answers.length
              ? answers.map(
                  (a) =>
                    `  ${a.trust === "trusted" ? "trusted    " : "source only"}  ${a.root}`,
                )
              : ["  none"]),
            "",
          ].join("\n"),
        );
    } else
      throw Error(
        "Usage: pymtheg trust [--list] | pymtheg trust --revoke [DIRECTORY]",
      );
  } else if (args[0] === "init") {
    const { askTrust } = await import("../project/trust.js");
    const { findWorkspace, checkoutTrust } = await import(
      "../project/workspace.js"
    );
    /**
     * D22: this machine's trust answer, asked when the checkout has none
     * (a new project, or a clone of an initialised one). A flag answers it;
     * a terminal is asked; with neither, source only is recorded and said.
     * A committed "source-only" binds, so nothing is asked.
     */
    const initTrust = async (
      directory: string,
      flag: "trusted" | "source-only" | undefined,
    ): Promise<{
      answer?: "trusted" | "source-only";
      asked?: "terminal" | "no-terminal";
    }> => {
      if (flag) return { answer: flag };
      const existing = await findWorkspace(directory).catch(() => null);
      if (existing && (await checkoutTrust(existing.root)) !== "unanswered")
        return {};
      if (process.stdin.isTTY && process.stderr.isTTY)
        return {
          answer: await askTrust(process.stdin, process.stderr, cancel.signal),
          asked: "terminal",
        };
      return { answer: "source-only", asked: "no-terminal" };
    };
    const { setupProject } = await import("../project/setup.js");
    const values = new Map<string, string>();
    let directory: string | undefined;
    let importDocs = false;
    let allowBrokenLinks = false;
    // D22: the trust answer, given by flag instead of the prompt.
    let trustFlag: "trusted" | "source-only" | undefined;
    for (let i = 1; i < args.length; i++) {
      const key = args[i]!;
      if (key === "--allow-broken-links") {
        allowBrokenLinks = true;
        continue;
      }
      if (key === "--trust" || key === "--source-only") {
        if (trustFlag) throw Error("Choose one of --trust and --source-only");
        trustFlag = key === "--trust" ? "trusted" : "source-only";
        continue;
      }
      if (key === "--import-docs") {
        if (importDocs) throw Error("Duplicate --import-docs");
        importDocs = true;
        continue;
      }
      if (!key.startsWith("--")) {
        if (directory !== undefined)
          throw Error("Choose one project directory");
        directory = key;
        continue;
      }
      if (
        !["--name", "--format", "--resolutions"].includes(key) ||
        values.has(key) ||
        !args[i + 1] ||
        args[i + 1]!.startsWith("--")
      )
        throw Error("Invalid init option " + key);
      values.set(key, args[++i]!);
    }
    if (
      values.has("--format") &&
      !["text", "json"].includes(values.get("--format")!)
    )
      throw Error("Init format must be text or json");
    // Ask only when this checkout has no answer on this machine: re-running
    // init never changes a recorded one.
    let trust: Awaited<ReturnType<typeof initTrust>>;
    try {
      trust = await initTrust(directory ?? ".", trustFlag);
    } catch (error) {
      const { TrustCancelled } = await import("../project/trust.js");
      if (!(error instanceof TrustCancelled)) throw error;
      // Ctrl-C at the question: say so, write nothing, exit 130.
      process.stderr.write(`\n${error.message}\n`);
      process.exit(130);
    }
    const response = await setupProject(
      directory ?? ".",
      values.get("--name"),
      importDocs,
      cancel.signal,
      {
        ...(trust.answer ? { trust: trust.answer } : {}),
        ...(trust.asked === "no-terminal" ? { defaulted: true } : {}),
        allowBrokenLinks,
        resolutions: values.has("--resolutions")
          ? (await import("../architecture/schema.js")).importResolutionSchema
              .array()
              .parse(
                JSON.parse(
                  await readFile(values.get("--resolutions")!, "utf8"),
                ),
              )
          : [],
      },
    );
    const { documentation, ...initialized } = response;
    const { printLegacyNotice } = await import("../storage/legacy.js");
    printLegacyNotice(initialized.root);
    const shellRoot = "'" + initialized.root.replace(/'/g, "'\\''") + "'";
    process.stdout.write(
      wantsJson
        ? json(response)
        : [
            initialized.created
              ? `Initialized ${initialized.workspace.name} at ${initialized.root}`
              : `Already initialized: opened ${initialized.workspace.name} at ${initialized.root}${initialized.filesCreated.length ? " (completed missing metadata)" : " (no metadata changes)"}`,
            ...(initialized.filesCreated.length
              ? [`Created: ${initialized.filesCreated.join(", ")}`]
              : []),
            initialized.trust === "unanswered"
              ? (await import("../project/trust.js")).trustAnswerHow
              : `${trust.asked === "no-terminal" && initialized.trustRecorded ? "No terminal to ask whether you trust this repository, so recorded source only. " : ""}${(await import("../project/trust.js")).trustSummary(initialized.trust)} Kept for this checkout in your own Pymtheg configuration, never in the repository; pymtheg trust lists answers and --revoke removes one.`,
            "Commit .pymtheg/project.json, .pymtheg/settings.json and .pymtheg/.gitignore with your designs.",
            "Planning/history in .pymtheg/shared/ and caches in .pymtheg/rebuildable/ stay local and ignored; share planning by exported history.",
            `Next: ${identity.cli} doctor`,
            `      ${identity.cli} studio ${shellRoot}`,
            `      ${identity.cli} mcp ${shellRoot}`,
            documentation.status === "none"
              ? "No existing documentation found. Start with a requirement or component in Studio."
              : documentation.status === "unavailable"
                ? `Documentation preview unavailable: ${documentation.message}`
                : documentation.total === 0
                  ? documentation.committed
                    ? "No upstream design documents remain. Removals applied; prior revisions remain available."
                    : documentation.status === "unchanged"
                      ? "The tracked documentation source remains empty; no new changes."
                      : "No upstream design documents remain. Review the removals below."
                  : `${documentation.total} existing ${documentation.total === 1 ? "document" : "documents"} ${documentation.status === "unchanged" ? `already ${documentation.total === 1 ? "matches" : "match"} the retained architecture` : documentation.committed ? "retained in the architecture" : "found; preview only"}.`,
            ...("changes" in documentation && documentation.changes
              ? [
                  `Documentation changes: ${documentation.changes.added.length} added, ${documentation.changes.changed.length} changed, ${documentation.changes.removed.length} removed.`,
                  ...(["added", "changed", "removed"] as const).flatMap(
                    (kind) => [
                      ...documentation.changes[kind]
                        .slice(0, 20)
                        .map((path) => `  ${kind}: ${path}`),
                      ...(documentation.changes[kind].length > 20
                        ? [
                            `  ${documentation.changes[kind].length - 20} more ${kind}; use --format json for every path.`,
                          ]
                        : []),
                    ],
                  ),
                  ...(documentation.changes.keptLocal.length
                    ? [
                        "Existing planning links stay on retained local documents. Choosing keep-both creates a separate incoming copy.",
                      ]
                    : []),
                ]
              : []),
            ...("files" in documentation
              ? documentation.files.map((path) => "  " + path)
              : []),
            ...("warnings" in documentation
              ? documentation.warnings.map((warning) => "Notice: " + warning)
              : []),
            documentation.status === "preview"
              ? `Bring these documents in: ${identity.cli} init ${JSON.stringify(initialized.root)} --import-docs`
              : documentation.status === "needs_review"
                ? "Nothing imported: review conflicts and newly broken links with init --format json. Resolve conflicts with --resolutions FILE; accept broken links only with --allow-broken-links. The same review is available in Studio Project setup."
                : "",
          ]
            .filter(Boolean)
            .join("\n") + "\n",
    );
    if (
      documentation.status === "unavailable" ||
      documentation.status === "needs_review"
    )
      process.exitCode = 2;
  } else if (args[0] === "import-architecture") {
    if (!args[1])
      throw Error(
        `Use ${identity.cli} import-architecture SOURCE_FOLDER --into PROJECT_FOLDER --name NAME`,
      );
    const importOptions = new Map<string, string>();
    let previewOnly = false,
      allowBrokenLinks = false,
      newSource = false;
    for (let i = 2; i < args.length; i++) {
      const key = args[i]!;
      if (key === "--allow-broken-links") {
        allowBrokenLinks = true;
        continue;
      }
      if (key === "--new-source") {
        newSource = true;
        continue;
      }
      if (key === "--preview") {
        if (previewOnly) throw Error("Duplicate --preview");
        previewOnly = true;
        continue;
      }
      if (
        ![
          "--into",
          "--name",
          "--source-id",
          "--source-name",
          "--resolutions",
          "--format",
        ].includes(key) ||
        importOptions.has(key) ||
        !args[i + 1] ||
        args[i + 1]!.startsWith("--")
      )
        throw Error("Invalid architecture import option " + key);
      importOptions.set(key, args[++i]!);
    }
    if (
      importOptions.has("--format") &&
      !["text", "json"].includes(importOptions.get("--format")!)
    )
      throw Error("Import format must be text or json");
    const writeImport = (value: Parameters<typeof renderImportSummary>[0]) =>
      process.stdout.write(
        importOptions.get("--format") === "text"
          ? renderImportSummary(value)
          : json(value),
      );
    const into = args.indexOf("--into"),
      named = args.indexOf("--name");
    if (into < 0 || !args[into + 1])
      throw Error("Choose the destination project with --into");
    const { readArchitectureFolder, ArchitectureStore } = await import(
      "../architecture/store.js"
    );
    const sourceRoot = await (
        await import("node:fs/promises")
      ).realpath(args[1]),
      store = await ArchitectureStore.open(resolve(args[into + 1]!));
    try {
      const head = store.read(),
        current = head
          ? head.documents.map((d) => store.document(head.id, d.path))
          : [];
      const selectedId = importOptions.get("--source-id"),
        registry = sourceRegistry(current),
        existing =
          registry.sources.find(
            (s) => s.id === (selectedId ?? "folder:" + hash(sourceRoot)),
          ) ??
          (!selectedId
            ? registry.sources.find((s) => {
                if (s.kind !== "folder") return false;
                const inventory = current.find(
                  (d) =>
                    d.path ===
                    `.pymtheg-imports/${encodeURIComponent(s.id)}.json`,
                );
                if (!inventory) return false;
                try {
                  const value: unknown = JSON.parse(inventory.text);
                  return (
                    !!value &&
                    typeof value === "object" &&
                    "schema" in value &&
                    value.schema === "pymtheg.import/v1" &&
                    "source" in value &&
                    value.source === sourceRoot
                  );
                } catch {
                  return false;
                }
              })
            : undefined);
      const loaded =
        existing?.selection === "project-documents"
          ? await (
              await import("../project/documents.js")
            ).projectDocumentation(sourceRoot, cancel.signal)
          : await readArchitectureFolder(sourceRoot, { signal: cancel.signal });
      if (selectedId && newSource)
        throw Error(
          "Choose --source-id to refresh or --new-source to add; not both.",
        );
      if (!existing && !newSource) {
        const paths = new Set(loaded.documents.map((d) => d.path));
        const candidates = registry.sources.filter(
          (s) =>
            s.kind === "folder" &&
            s.documents.some((d) => paths.has(d.sourcePath ?? d.path)),
        );
        if (candidates.length)
          throw Error(
            "This folder overlaps retained sources and may have moved. Refresh with --source-id " +
              candidates.map((s) => s.id + " (" + s.label + ")").join(", ") +
              ", or use --new-source to deliberately add a separate source.",
          );
      }
      if (selectedId && !existing)
        throw Error(
          "No retained source has ID " +
            selectedId +
            ". Run an import preview to see source IDs.",
        );
      const resolutions = importOptions.has("--resolutions")
        ? (await import("../architecture/schema.js")).importResolutionSchema
            .array()
            .parse(
              JSON.parse(
                await readFile(importOptions.get("--resolutions")!, "utf8"),
              ),
            )
        : [];
      const source = {
        id: existing?.id ?? "folder:" + hash(loaded.root),
        label:
          importOptions.get("--source-name") ?? existing?.label ?? loaded.root,
        kind: "folder" as const,
        ...(existing?.selection ? { selection: existing.selection } : {}),
      };
      const documents = withImportInventory(
        loaded.documents,
        loaded.root,
        loaded.excluded,
        source.id,
      );
      const merged = mergeArchitectureImport(
        current,
        documents,
        source,
        "refresh",
        { collectConflicts: true, resolutions },
      );
      const prepared = await (
        await import("../architecture/runner.js")
      ).prepareAndIndexInWorker(current, merged.documents, cancel.signal);
      const brokenLinks = newlyBrokenAuthoredLinks(
        head,
        prepared.index,
        prepared.documents,
      );
      if (
        previewOnly ||
        merged.conflicts.length ||
        (brokenLinks.length && !allowBrokenLinks)
      ) {
        writeImport({
          source,
          committed: false,
          ...(brokenLinks.length && !allowBrokenLinks
            ? {
                message:
                  "Native planning links would break. Review this preview; use --allow-broken-links only to accept that change explicitly.",
              }
            : {}),
          changes: merged.summary,
          conflicts: merged.conflicts,
          warnings: prepared.index.warnings,
          ready:
            !merged.conflicts.length &&
            (!brokenLinks.length || allowBrokenLinks),
          newlyBrokenAuthoredLinks: brokenLinks,
        });
        process.exitCode =
          merged.conflicts.length || brokenLinks.length ? 2 : 0;
      } else {
        const index = store.save(
          named >= 0
            ? (args[named + 1] ?? "Imported architecture")
            : "Imported architecture",
          loaded.root,
          prepared.documents,
          prepared.index,
          head?.id ?? null,
          { skipUnchanged: named < 0 },
        );
        writeImport({
          committed: index.id !== head?.id,
          unchanged: index.id === head?.id,
          revision: index.id,
          newlyBrokenAuthoredLinks: brokenLinks,
          documents: index.documents.length,
          entities: index.entities.length,
          edges: index.edges.length,
          sourceStatus: "imported_unverified",
          changes: merged.summary,
          excluded: loaded.excluded,
          warnings: index.warnings,
          measurements: index.measurements,
        });
        process.exitCode = brokenLinks.length ? 2 : 0;
      }
    } finally {
      store.close();
    }
  } else if (args[0] === "mcp") {
    const launch = outputPluginArguments(args.slice(1));
    if (launch.rest.length > 1)
      throw Error(
        `Use ${identity.cli} mcp [PROJECT_DIRECTORY] [--plugin TARGET=PATH]`,
      );
    const outputs = await OutputRegistry.load(
      launch.specifications,
      cancel.signal,
      { timeoutMs: launch.timeoutMs },
    );
    const { runAgentStdio } = await import("../mcp/server.js");
    await runAgentStdio(launch.rest[0] ?? ".", cancel.signal, outputs);
  } else if (args[0] === "scaffold") {
    if (!args[1] || args[1].startsWith("--"))
      throw Error(
        `Use ${identity.cli} scaffold FILE${identity.extension} [--target typescript|rust|go] [--plugin FILE.mjs] [--body fail-fast|empty] [--format json]`,
      );
    const scaffoldOptions = new Map<string, string>();
    let allowIncomplete = false;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--allow-incomplete") {
        if (allowIncomplete) throw Error("Duplicate --allow-incomplete");
        allowIncomplete = true;
        continue;
      }
      const key = args[i]!,
        value = args[++i];
      if (
        ![
          "--target",
          "--plugin",
          "--format",
          "--body",
          "--mode",
          "--manifest",
          "--plugin-timeout",
          "--check",
          "--implementation",
          "--implementation-module",
          "--contracts-module",
        ].includes(key) ||
        scaffoldOptions.has(key) ||
        value === undefined ||
        value.startsWith("--")
      )
        throw Error("Invalid scaffold option " + key);
      scaffoldOptions.set(key, value);
    }
    if (
      scaffoldOptions.has("--format") &&
      scaffoldOptions.get("--format") !== "json"
    )
      throw Error("Scaffold format must be json, or omitted for source text");
    if (scaffoldOptions.has("--plugin") && !scaffoldOptions.has("--target"))
      throw Error(
        "Choose the plugin output language explicitly, for example --plugin emitter.mjs --target javascript. See docs/output-plugins.md.",
      );
    if (scaffoldOptions.has("--manifest") && scaffoldOptions.has("--check"))
      throw Error(
        "Use --manifest to save a baseline or --check to compare one, not both.",
      );
    const body = scaffoldOptions.get("--body") ?? defaultScaffoldBodyMode;
    if (!isScaffoldBodyMode(body))
      throw Error("Scaffold body must be fail-fast or empty");
    const mode = scaffoldOptions.get("--mode") ?? "stubs";
    if (!isOutputMode(mode))
      throw Error("Output mode must be stubs or contracts");
    const target = scaffoldOptions.get("--target") ?? "typescript";
    if (
      !scaffoldOptions.has("--implementation") &&
      (scaffoldOptions.has("--implementation-module") ||
        scaffoldOptions.has("--contracts-module"))
    )
      throw Error(
        "Use --implementation TYPE to generate a compiler-check file with these module paths.",
      );
    if (!scaffoldOptions.has("--plugin") && !isOutputTarget(target))
      throw Error(
        "Unknown output target; provide an explicit --plugin for additional languages",
      );
    const sourceWorkspace = await findWorkspace(dirname(resolve(args[1])));
    const session = await analyseInWorker({
      file: resolve(args[1]),
      ...(sourceWorkspace
        ? { workerData: { root: sourceWorkspace.root } }
        : {}),
      signal: cancel.signal,
    });
    if (!session.ir) {
      report = session.report;
      snapshot = session.snapshot;
      throw Error(
        report.diagnostics[0]?.message ??
          "No typed specification is available for scaffold generation",
      );
    }
    const { scaffold } = await import("../contracts/scaffold.js");
    const generated = scaffoldOptions.has("--plugin")
      ? await (
          await import("../contracts/plugins.js")
        ).emitPlugin(
          {
            ...(await import("../contracts/document.js")).contractDocument(
              session.ir,
            ),
            outputMode: mode,
          },
          scaffoldOptions.get("--plugin")!,
          target,
          cancel.signal,
          {
            bodyPolicy: body,
            requirePolicy: scaffoldOptions.has("--body"),
            ...(scaffoldOptions.has("--plugin-timeout")
              ? {
                  timeoutMs: pluginDeadline(
                    scaffoldOptions.get("--plugin-timeout")!,
                  ),
                }
              : {}),
          },
        )
      : scaffold(
          session.ir,
          target as import("../contracts/scaffold.js").BuiltinTarget,
          body,
          mode,
        );
    if (scaffoldOptions.has("--implementation")) {
      if (
        !isOutputTarget(target) ||
        scaffoldOptions.has("--plugin") ||
        mode !== "contracts"
      )
        throw Error(
          "Implementation checks require --mode contracts and a built-in TypeScript, Rust or Go target.",
        );
      if (
        scaffoldOptions.has("--manifest") ||
        scaffoldOptions.has("--check") ||
        session.report.diagnostics.some((d) => d.severity === "error")
      )
        throw Error(
          "Generate an implementation check from a design without errors, separately from manifest saving/comparison.",
        );
      const { emitImplementationCheck } = await import(
        "../contracts/implementation-check.js"
      );
      const check = emitImplementationCheck(generated, {
        target,
        ...(target !== "go" || scaffoldOptions.has("--contracts-module")
          ? {
              contractsModule:
                scaffoldOptions.get("--contracts-module") ??
                (target === "rust" ? "crate::contracts" : "./contracts"),
            }
          : {}),
        ...(target === "typescript" ||
        scaffoldOptions.has("--implementation-module")
          ? {
              implementationModule:
                scaffoldOptions.get("--implementation-module") ??
                "./implementation",
            }
          : {}),
        implementationType: scaffoldOptions.get("--implementation")!,
      });
      process.stdout.write(wantsJson ? json(check) : check.source);
      if (!wantsJson) process.stderr.write(check.instructions + "\n");
      process.exitCode = 0;
    } else {
      if (scaffoldOptions.has("--manifest")) {
        if (
          !allowIncomplete &&
          (generated.contractManifest?.omitted.length ||
            session.report.diagnostics.some((d) => d.severity === "error"))
        )
          throw Error(
            "Contract baseline not saved: this design has errors or omitted contracts. Repair the design, or use --allow-incomplete to explicitly save partial coverage. The existing baseline is unchanged.",
          );
        await atomicWrite(
          resolve(scaffoldOptions.get("--manifest")!),
          json(generated.contractManifest),
          cancel.signal,
        );
      }
      if (scaffoldOptions.has("--check")) {
        const { compareContractManifests } = await import(
          "../contracts/manifest.js"
        );
        const file = resolve(scaffoldOptions.get("--check")!);
        const text = await readFile(file, "utf8");
        if (Buffer.byteLength(text) > 16 * 1024 * 1024)
          throw Error("Contract manifest exceeds 16 MiB");
        const drift = compareContractManifests(
          JSON.parse(text),
          generated.contractManifest!,
        );
        const currentDesignErrors = session.report.diagnostics.filter(
          (d) => d.severity === "error",
        );
        process.stdout.write(
          wantsJson
            ? json({ ...drift, currentDesignErrors })
            : [
                ...(currentDesignErrors.length
                  ? [
                      "The current design has errors. Contract comparison does not establish a valid design.",
                      ...currentDesignErrors.map(
                        (d) => `${d.code}: ${d.message}`,
                      ),
                    ]
                  : []),
                drift.matches
                  ? "Declared contracts match the saved manifest."
                  : "Declared contracts changed:",
                ...drift.added.map((id) => "+ " + id),
                ...drift.removed.map((id) => "- " + id),
                ...drift.changed.flatMap((e) => [
                  "~ " + e.id,
                  ...e.details.map((d) => "  " + d),
                ]),
                ...drift.moved.map(
                  (e) => "Moved: " + e.before + " → " + e.after,
                ),
                ...drift.incomplete.map((e) => "? " + e.name + ": " + e.reason),
              ].join("\n") + "\n",
        );
        process.exitCode = currentDesignErrors.length
          ? 1
          : drift.incomplete.length
            ? 2
            : drift.matches
              ? 0
              : 1;
      } else if (wantsJson) process.stdout.write(json(generated));
      else {
        process.stdout.write(generated.source);
        for (const item of generated.omitted)
          process.stderr.write(`Omitted ${item.name}: ${item.reason}\n`);
      }
      if (!scaffoldOptions.has("--check"))
        process.exitCode = generated.omitted.length ? 2 : 0;
    }
  } else if (args[0] === "doctor") {
    const { doctor } = await import("../project/doctor.js");
    const diagnosis = await doctor(cancel.signal);
    process.stdout.write(
      wantsJson
        ? json(diagnosis)
        : diagnosis.checks
            .map((c) => `${c.name}: ${c.status} — ${c.detail}`)
            .join("\n") + "\n",
    );
    process.exitCode = diagnosis.ready ? 0 : 3;
  } else if (args[0] === "fmt") {
    if (!args[1] || args[1].startsWith("--"))
      throw Error("fmt requires a source file");
    for (const arg of args.slice(2))
      if (!["--check", "--write"].includes(arg))
        throw Error("Unknown formatter option " + arg);
    const { formatSource } = await import("../language/format.js");
    const file = resolve(args[1]),
      source = await readFile(file, "utf8"),
      formatted = formatSource(file, source);
    if (args.includes("--write"))
      await atomicWrite(file, formatted, cancel.signal);
    else if (args.includes("--check")) {
      const originalLines = source.split("\n"),
        canonicalLines = formatted.split("\n");
      let differing = 0;
      while (
        differing < Math.min(originalLines.length, canonicalLines.length) &&
        originalLines[differing] === canonicalLines[differing]
      )
        differing++;
      process.stdout.write(
        source === formatted
          ? "Formatting is current\n"
          : `Formatting differs at line ${Math.min(differing + 1, originalLines.length)}; run ${identity.cli} fmt ${args[1]} --write\n`,
      );
      process.exitCode = source === formatted ? 0 : 1;
    } else process.stdout.write(formatted);
  } else if (args[0] === "studio") {
    const { startStudio } = await import("../studio/server.js");
    const launch = outputPluginArguments(args.slice(1));
    const rest = [...launch.rest];
    const path = rest[0] && !rest[0].startsWith("--") ? rest.shift()! : ".";
    if (rest.length && (rest.length !== 2 || rest[0] !== "--port"))
      throw Error(
        `Use ${identity.cli} studio PATH [--port PORT] [--plugin TARGET=PATH]`,
      );
    const port = rest.length ? Number(rest[1]) : 0;
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw Error("Invalid port");
    const outputRegistry = await OutputRegistry.load(
      launch.specifications,
      cancel.signal,
      { timeoutMs: launch.timeoutMs },
    );
    const app = await startStudio({
      path,
      port,
      outputRegistry,
    });
    console.log(
      `Pymtheg Studio\nOpen in Firefox: ${app.url}\nPress Ctrl-C to close the workspace.`,
    );
    await new Promise<void>((resolve) => {
      if (cancel.signal.aborted) resolve();
      else
        cancel.signal.addEventListener("abort", () => resolve(), {
          once: true,
        });
    });
    await app.close();
  } else if (args[0] === "--version") {
    process.stdout.write(identity.version + "\n");
  } else if (args[0] === "--help" || !args.length) {
    process.stdout.write(help());
  } else {
    const command = args[0],
      file = args[1];
    if (
      !["check", "emit", "simulate", "verify"].includes(command!) ||
      !file ||
      file.startsWith("--")
    )
      throw Error(
        `Unknown command or missing file. Commands: ${commandNames.join(", ")}. See --help.`,
      );
    const options = new Map<string, string>();
    let verbose = false;
    for (let i = 2; i < args.length; i++) {
      const key = args[i]!;
      if (key === "--verbose") {
        verbose = true;
        continue;
      }
      if (
        ![
          "--scenario",
          "--format",
          "--out",
          "--entry",
          "--target",
          "--seed",
          "--max-steps",
          "--max-samples",
          "--timeout",
          "--state-budget",
          "--scope",
          "--check-scope",
        ].includes(key)
      )
        throw Error(`Unknown option ${key}`);
      if (options.has(key)) throw Error(`Repeated option ${key}`);
      const value = args[++i];
      if (value === undefined || value.startsWith("--"))
        throw Error(`Missing value for ${key}`);
      options.set(key, value);
    }
    const explicit = new Set(options.keys());
    let selectedScope: unknown, scenarioEntry: string | undefined;
    if (options.has("--scenario")) {
      const loaded = await findConfig(dirname(resolve(file)));
      const selected = loaded.config.scenarios[options.get("--scenario")!];
      if (!selected)
        throw Error("Unknown project scenario " + options.get("--scenario"));
      if (resolve(loaded.root, selected.file) !== resolve(file))
        throw Error("Scenario belongs to a different source file");
      const defaults: Record<string, string> = {
        "--entry": selected.entry,
        "--seed": selected.seed,
        "--max-steps": String(selected.maxSteps),
        "--max-samples": String(selected.maxSamples),
        "--timeout": selected.timeoutMs + "ms",
      };
      for (const [key, value] of Object.entries(defaults))
        if (!options.has(key)) options.set(key, value);
      selectedScope = selected.scope;
      scenarioEntry = selected.entry;
    }
    if (
      options.has("--format") &&
      !["json", "text"].includes(options.get("--format")!)
    )
      throw Error("Format must be text or json");
    if (command !== "check" && !options.get("--entry")) {
      const available = await analyseInWorker({
        file: resolve(file),
        signal: cancel.signal,
      });
      const names =
        available.ir?.declarations
          .filter((d) => d.kind === "flow" || d.kind === "machine")
          .map((d) => d.name) ?? [];
      throw Error(
        "Choose --entry NAME. Available entries: " +
          (names.join(", ") || "none in this source"),
      );
    }
    if (
      command === "emit" &&
      (!options.get("--out") || options.get("--target") !== "json")
    )
      throw Error("emit requires --target json --out PATH");
    if (command !== "emit" && options.has("--target"))
      throw Error("--target is available for emit only");
    if (command !== "verify" && options.has("--state-budget"))
      throw Error("--state-budget is available for verify only");
    for (const key of ["--seed", "--max-steps", "--max-samples"])
      if (command !== "simulate" && explicit.has(key))
        throw Error(`${key} is available for simulate only`);
    const intOption = (key: string, fallback: number, max: number): number => {
      const s = options.get(key) ?? String(fallback);
      if (!/^\d+$/.test(s)) throw Error(`${key} must be an integer`);
      const n = Number(s);
      if (!Number.isSafeInteger(n) || n < 1 || n > max)
        throw Error(`${key} must be in 1..${max}`);
      return n;
    };
    const time = options.get("--timeout") ?? "45s",
      match = /^(\d+)(ms|s)$/.exec(time);
    if (!match) throw Error("--timeout expects 45s or 500ms");
    const timeoutMs = Number(match[1]) * (match[2] === "s" ? 1000 : 1);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
      throw Error("Timeout must be 1ms..120s");
    const seed = options.get("--seed") ?? "42";
    if (!/^\d+$/.test(seed) || BigInt(seed) > 9223372036854775807n)
      throw Error("Seed must be a nonnegative signed 64-bit integer");
    const backendOptions: BackendOptions = {
      entry: options.get("--entry") ?? "",
      method: command === "simulate" ? "sample" : "exhaustive",
      stateBudget: intOption(
        "--state-budget",
        1_000_000,
        Number.MAX_SAFE_INTEGER,
      ),
      seed,
      maxSteps: intOption("--max-steps", 6, 10000),
      maxSamples: intOption("--max-samples", 1000, 100000),
      timeoutMs,
      scope: selectedScope,
      scopeFile: options.get("--scope")
        ? resolve(options.get("--scope")!)
        : null,
    };
    const started = performance.now();
    const checkScope = options.get("--check-scope") ?? "entry";
    if (
      !["entry", "related", "project"].includes(checkScope) ||
      (command !== "check" && options.has("--check-scope"))
    )
      throw Error(
        "--check-scope entry|related|project is available for local checks only",
      );
    const checkConfig =
      checkScope === "entry" ? null : await findConfig(dirname(resolve(file)));
    const session = await analyseInWorker({
      file: resolve(file),
      workerData: checkConfig
        ? {
            root: checkConfig.hash ? checkConfig.root : dirname(resolve(file)),
            sourcePolicy: checkConfig.config.sources,
            related: checkScope === "related",
            projectWide: checkScope === "project",
          }
        : {},
      signal: cancel.signal,
      onProgress: (message) => {
        if (verbose) process.stderr.write(`phase: ${message.kind}\n`);
      },
    });
    snapshot = session.snapshot;
    report = session.report;
    const ir = session.ir;
    report.session.requested = command!;
    if (ir && !cancel.signal.aborted) {
      const project = ir;
      if (command === "emit") {
        const scope = backendOptions.scopeFile
          ? (JSON.parse(
              await readFile(backendOptions.scopeFile, "utf8"),
            ) as unknown)
          : (selectedScope ?? {});
        const plan = await lowerInWorker(
          project,
          backendOptions.entry,
          scope,
          cancel.signal,
        );
        const scopeIssue =
          plan.kind === "supported"
            ? scopeIssueResult(project, plan.model)
            : null;
        if (scopeIssue) {
          report.results.push(scopeIssue);
          report.diagnostics.push(...scopeIssue.diagnostics);
        } else if (plan.kind === "supported") {
          const output = resolve(options.get("--out")!);
          if (project.snapshot.sources.some((s) => s.file === output))
            throw Error("Refusing to overwrite source with generated model");
          await atomicWrite(
            output,
            modelDocument(project, plan.model),
            cancel.signal,
          );
          report.artifacts.push(output);
        } else
          report.results.push(
            result(project, backendOptions.entry + "/lowering", "lowering", {
              completion:
                plan.kind === "unsupported" ? "unsupported" : "incomplete",
              outstandingObligations: plan.reasons,
            }),
          );
      } else if (command === "simulate" || command === "verify") {
        const backend = await runBackend(
          project,
          backendOptions,
          cancel.signal,
        );
        report.results.push(...backend);
        report.diagnostics.push(...backend.flatMap((x) => x.diagnostics));
      }
      report.session.staleFiles = await staleSourcesAsync(
        project.snapshot.sources,
        cancel.signal,
      );
    }
    if (cancel.signal.aborted) report.session.state = "Cancelled";
    report.measurements.coordinatorMs = performance.now() - started;
    if (options.has("--out") && command !== "emit") {
      try {
        const destination = resolve(options.get("--out")!);
        if (snapshot.sources.some((s) => s.file === destination))
          throw Error("Refusing to overwrite a source file");
        await atomicWrite(destination, json(report), cancel.signal);
        report.artifacts.push(destination);
      } catch (e) {
        report.session.state = cancel.signal.aborted ? "Cancelled" : "Failed";
        report.diagnostics.push(
          finding("PUBLISH", String(e), {
            file: resolve(file),
            start: 0,
            end: 0,
          }),
        );
      }
    }
    writeReport();
    if (command === "check" && ir && !wantsJson && !cancel.signal.aborted)
      process.stdout.write(
        uncheckedBehaviourNotice(ir, report, {
          file: resolve(file),
          scenario: options.get("--scenario"),
          scenarioEntry,
        }),
      );
    process.exitCode = exitStatus(report);
  }
} catch (e) {
  report.session.state = cancel.signal.aborted ? "Cancelled" : "Failed";
  if (!cancel.signal.aborted)
    report.diagnostics.push(
      finding("I001", String(e), {
        file: "<invocation>",
        start: 0,
        end: 0,
      }),
    );
  if (e instanceof FormatSyntaxError && !cancel.signal.aborted) {
    process.stderr.write(e.message + "\n");
    process.exitCode = 1;
  } else {
    if (args[0] === "mcp")
      process.stderr.write(identity.cli + ": " + invocationMessage(e) + "\n");
    else writeReport();
    process.exitCode = exitStatus(report);
  }
} finally {
  process.removeListener("SIGINT", onSignal);
  process.removeListener("SIGTERM", onSignal);
}
