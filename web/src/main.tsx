// SPDX-License-Identifier: MIT
import { SourceBufferBases } from "../../src/studio/buffer-base";
import {
  identity as publicIdentity,
  sourceFileName,
} from "../../src/shared/identity-values";
import "./schema-config";
import type { RangeDraft } from "../../src/studio/range-data";
import { OperationContractEditor } from "./OperationContractEditor";
import {
  operationDraftSchema,
  type OperationDraft,
} from "../../src/studio/operation-data";
import { DeclarationEditor } from "./DeclarationEditor";
import { unsavedBuffers } from "../../src/studio/unsaved-buffers";
import {
  declarationDraftSchema,
  type DeclarationDraft,
} from "../../src/studio/declaration-data";
import type { ImplementationDraft } from "../../src/studio/implementation-draft";
import { ProjectSetup } from "./ProjectSetup";
import { ImplementationCheck } from "./ImplementationCheck";
import { InterfaceConflict } from "./InterfaceConflict";
import {
  contractManifestSchema,
  compareContractManifests,
} from "../../src/contracts/manifest";
import {
  completionCaller,
  type CompletionSite,
} from "../../src/studio/completion-position";
import type { RecipeFormDraft } from "../../src/studio/recipes";
import type { InterfaceContext } from "../../src/studio/interface-builder";
import { InterfaceEditor } from "./InterfaceEditor";
import { TypeEditor } from "./TypeEditor";
import { readTypeDraft, type TypeDraft } from "../../src/studio/type-edit-data";
import {
  readSignatureDescription,
  readInterfaceDraft,
  type InterfaceDraft,
  type SignatureDescription,
  readTypeDefinition,
  type TypeDefinitionDescription,
  type SourceEditPreview,
} from "../../src/studio/interface-data";
import { decodeUtf8 } from "../../src/shared/text";
import { callableSnippet } from "../../src/studio/completion";
import { TryInputs } from "./TryInputs";
import { ArchitectureView } from "./ArchitectureView";
import { blocks } from "./blocks";
import { RecipeForm, type RecipeDraft } from "./RecipeForm";
import { RecipeCoach } from "./RecipeCoach";
import { InterfaceHint, describeShape } from "./InterfaceHint";
import { snippetCompletion } from "@codemirror/autocomplete";
import {
  defaultScaffoldBodyMode,
  type ScaffoldBodyMode,
  type OutputMode,
  outputTargetIds,
  outputTargets,
} from "../../src/shared/outputs";
import { useRecovery } from "./useRecovery";
import {
  scenario,
  projectConfig,
  type Scenario,
} from "../../src/shared/config";
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { mergeRun } from "../../src/studio/state";
import { ScopeEditor, scopeProblems } from "./ScopeEditor";
import { Editor } from "./Editor";
import { BlockEditor } from "./BlockEditor";
import {
  reportStatus,
  outcomeLabel,
  propertyLabel,
} from "../../src/reporting/status";
import { EvidenceView } from "./EvidenceView";
import { CompareView } from "./CompareView";
import { compareCost } from "../../src/reporting/compare";
import { DependencyMap } from "./DependencyMap";
import { FindingCard } from "./FindingCard";
import { findingPresenter } from "../../src/reporting/explain";
import {
  api,
  ApiError,
  events,
  project as readProject,
  report as readReport,
  run as readRun,
  sourceFile as readSourceFile,
} from "./api";
import type { Report } from "../../src/reporting/report";
import type { Finding, Span } from "../../src/shared/identity";
import type {
  ProjectView,
  StudioRun,
  SymbolView,
} from "../../src/studio/protocol";
import "./style.css";
const object = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const short = (id: string) => id.split("#").at(-1) ?? id;
const basename = (path: string) => path.split("/").at(-1) ?? path;
const icons = { error: "!", warning: "△", info: "i" };
const analysisViews = [
  ["findings", "Findings"],
  ["costs", "Work"],
  ["trace", "Trace"],
  ["structure", "Structure"],
  ["code", "Code"],
  ["evidence", "Evidence"],
  ["history", "History"],
  ["compare", "Compare"],
] as const;
function App() {
  const analysisContent = useRef<HTMLDivElement>(null);
  const revealAnalysis = useRef(false);
  function focusAnalysis() {
    analysisContent.current?.focus({ preventScroll: true });
    analysisContent.current?.scrollIntoView({ block: "start" });
  }

  const [editorMode, setEditorMode] = useState<"text" | "blocks">("text");
  const editorActions = useRef<{ undo: () => void; redo: () => void } | null>(
    null,
  );
  const typeRequestGeneration = useRef(0);
  const [scaffoldPreview, setScaffoldPreview] = useState<{
    runId: string;
    target: string;
    body: ScaffoldBodyMode;
    mode: OutputMode;
    source: string;
    omitted: number;
  } | null>(null);
  const [scaffoldMode, setScaffoldMode] = useState<OutputMode>("stubs");
  const [scaffoldDrift, setScaffoldDrift] = useState<ReturnType<
    typeof compareContractManifests
  > | null>(null);
  const [interfaceConflict, setInterfaceConflict] = useState<{
    runId: string;
    draft: InterfaceDraft;
    description: SignatureDescription | null;
    conflicts: string[];
    candidates: { symbolId: string; name: string }[];
  } | null>(null);
  const [tryOpen, setTryOpen] = useState(false);
  const [architectureOpen, setArchitectureOpen] = useState(false);
  const workspaceViewChosen = useRef(false);
  const [architectureVisited, setArchitectureVisited] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [architectureRefresh, setArchitectureRefresh] = useState(0);
  const [project, setProject] = useState<ProjectView | null>(null),
    [buffers, setBuffers] = useState<Record<string, string>>({}),
    [file, setFile] = useState(""),
    [runs, setRuns] = useState<StudioRun[]>([]),
    [selectedRun, setSelectedRun] = useState(""),
    [tab, setTab] = useState("findings"),
    [query, setQuery] = useState(""),
    [fileQuery, setFileQuery] = useState(""),
    [fileLimit, setFileLimit] = useState(200),
    [filter, setFilter] = useState("all"),
    [revision, setRevision] = useState(0),
    [frozen, setFrozen] = useState(false),
    [range, setRange] = useState<{ start: number; end: number } | null>(null),
    [selectedResult, setSelectedResult] = useState(""),
    [traceIndex, setTraceIndex] = useState(0),
    [preferredEntry, setEntry] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [lastSave, setLastSave] = useState<{ path: string; newer: boolean } | null>(
      null,
    ),
    [recoveryNotice, setRecoveryNotice] = useState(""),
    [recoveryReview, setRecoveryReview] = useState<
      import("../../src/studio/recovery").RecoveryView | null
    >(null),
    [copyPath, setCopyPath] = useState(""),
    [connected, setConnected] = useState(false),
    [auto, setAuto] = useState(false),
    [help, setHelp] = useState(false),
    [connectHelp, setConnectHelp] = useState(false),
    [connectionNotice, setConnectionNotice] = useState(""),
    [newFile, setNewFile] = useState(false),
    [newDesign, setNewDesign] = useState<RecipeFormDraft | null>(null),
    [projectTypes, setProjectTypes] = useState<InterfaceContext["types"]>([]),
    [typeCatalogue, setTypeCatalogue] = useState<{
      status: "idle" | "loading" | "ready" | "error";
      message: string;
    }>({ status: "idle", message: "" }),
    [recipeDraft, setRecipeDraft] = useState<RecipeDraft | null>(null),
    [interfaceDraft, setInterfaceDraft] = useState<InterfaceDraft | null>(null),
    [typeDraft, setTypeDraft] = useState<TypeDraft | null>(null),
    [declarationDraft, setDeclarationDraft] = useState<DeclarationDraft | null>(
      null,
    ),
    [operationDraft, setOperationDraft] = useState<OperationDraft | null>(null),
    [operationSession, setOperationSession] = useState<{
      file: string;
      name: string;
      runId?: string;
      error?: string;
    } | null>(null),
    [rangeDrafts, setRangeDrafts] = useState<RangeDraft[]>([]),
    [declarationOpen, setDeclarationOpen] = useState(false),
    [appliedFocus, setAppliedFocus] = useState<{
      file: string;
      text: string;
      name?: string | undefined;
    } | null>(null),
    [declarationSession, setDeclarationSession] = useState<{
      file: string;
      resourceName?: string;
      runId?: string;
      error?: string;
    } | null>(null),
    [implementationDrafts, setImplementationDrafts] = useState<
      ImplementationDraft[]
    >([]),
    [pendingType, setPendingType] = useState<{
      runId: string;
      generation: number;
      symbolId?: string;
      draft: TypeDraft | null;
    } | null>(null),
    [typeSession, setTypeSession] = useState<{
      runId: string;
      description: TypeDefinitionDescription;
      knownTypes: {
        name: string;
        kind: "record" | "choice";
        symbolId: string;
      }[];
    } | null>(null),
    [pendingInterface, setPendingInterface] = useState<{
      runId: string;
      symbolId: string;
      draft?: InterfaceDraft;
    } | null>(null),
    [interfaceSession, setInterfaceSession] = useState<{
      runId: string;
      description: SignatureDescription;
      baseText: string;
    } | null>(null),
    [scaffoldTarget, setScaffoldTarget] = useState("typescript"),
    [scaffoldBody, setScaffoldBody] = useState<ScaffoldBodyMode>(
      defaultScaffoldBodyMode,
    ),
    [includeSource, setIncludeSource] = useState(false),
    [baseline, setBaseline] = useState(""),
    [settingsOpen, setSettingsOpen] = useState(false),
    [settings, setSettings] = useState({
      seed: "42",
      maxSteps: 12,
      maxSamples: 1000,
      timeoutMs: 45000,
      scope: "{}",
    }),
    [settingsError, setSettingsError] = useState(""),
    [scenarioName, setScenarioName] = useState(""),
    [scenarioSaved, setScenarioSaved] = useState(""),
    [cursor, setCursor] = useState(0),
    [blockInsertion, setBlockInsertion] = useState<{
      serial: number;
      template: string;
      documentId: string;
    } | null>(null),
    [referenceSymbol, setReferenceSymbol] = useState<SymbolView | null>(null),
    [diskConflict, setDiskConflict] = useState<
      import("../../src/studio/protocol").StudioFile | null
    >(null);
  const bufferBases = useRef(new SourceBufferBases());
  const pendingSaves = useRef(
    new Map<string, { text: string; expectedHash: string | null }>(),
  );
  const declarationGeneration = useRef(0);
  const clientId = useRef(crypto.randomUUID()),
    reportInput = useRef<HTMLInputElement>(null),
    revisionRef = useRef(0),
    buffersRef = useRef(buffers),
    fileRef = useRef(file),
    lastLocalRequest = useRef(""),
    sourceOpenRequest = useRef(0),
    sourceFilesRef = useRef<import("../../src/studio/protocol").StudioFile[]>(
      [],
    );
  if (project) sourceFilesRef.current = project.files;
  buffersRef.current = buffers;
  fileRef.current = file;
  const current = runs.find((r) => r.id === selectedRun) ?? runs[0] ?? null,
    report = current?.report ?? null;
  useEffect(
    () => setScaffoldDrift(null),
    [current?.id, scaffoldTarget, scaffoldMode],
  );
  const absolute = (name: string) =>
    name.startsWith("/") ? name : `${project?.root ?? ""}/${name}`;
  const relative = (name: string) =>
    project && name.startsWith(project.root + "/")
      ? name.slice(project.root.length + 1)
      : name;
  const symbols = current?.symbols ?? [];
  const entries = symbols.filter(
    (s) =>
      (s.kind === "machine" || s.kind === "flow") &&
      s.span.file === absolute(file),
  );
  // Keep the rendered value and the next behaviour request in the same state,
  // even when a source read, run event and explicit selection settle together.
  const entry = entries.some((e) => e.name === preferredEntry)
    ? preferredEntry
    : (entries[0]?.name ?? "");
  const snapshot = report?.snapshot.files.find(
    (s) => s.file === absolute(file),
  );
  const value = frozen
    ? (snapshot?.text ?? "")
    : (buffers[file] ??
      project?.files.find((f) => f.path === file)?.text ??
      "");
  const dirty =
    !!project &&
    project.files.find((f) => f.path === file)?.text !==
      (buffers[file] ?? project.files.find((f) => f.path === file)?.text);
  const sourceByPath = new Map(
    project?.files.map((source) => [source.path, source]) ?? [],
  );
  const selectedDisk = sourceByPath.get(file);
  const staleBuffer =
    !!selectedDisk &&
    !frozen &&
    buffers[file] !== undefined &&
    bufferBases.current.expected(file, selectedDisk.hash) !== selectedDisk.hash;
  const recoveryPayload = {
    drafts: project
      ? Object.entries(unsavedBuffers(buffers, project.files)).map(
          ([path, text]) => {
            const file = sourceByPath.get(path);
            return {
              path,
              text,
              baseHash: bufferBases.current.expected(
                path,
                file?.exists === false ? null : (file?.hash ?? null),
              ),
            };
          },
        )
      : [],
    context: {
      file,
      entry,
      tab,
      editorMode,
      settings,
      cursor,
      selectedRun,
      frozen,
      interfaceDraft,
      typeDraft,
      declarationDraft,
      operationDraft,
      implementationDrafts,
      rangeDrafts,
      newDesign,
    },
  };
  const recovery = useRecovery(project, recoveryPayload);
  const hasUnsavedWork = !!(
    recoveryPayload.drafts.length ||
    interfaceDraft ||
    typeDraft ||
    declarationDraft ||
    operationDraft ||
    implementationDrafts.length ||
    rangeDrafts.length ||
    newDesign
  );
  const historical =
    !!current &&
    (current.request.clientId !== clientId.current ||
      current.request.revision !== revision);
  const active = runs.find((r) => r.status === "running");
  const selectedEntry = entries.find((s) => s.name === entry);
  const scenarioOperations = useMemo(() => {
    const seen = new Set<string>(),
      queue = selectedEntry ? [selectedEntry.id] : [],
      outgoing = new Map<string, string[]>();
    for (const edge of report?.dependencies ?? [])
      if (edge.kind === "call" || edge.kind === "rule") {
        const list = outgoing.get(edge.from) ?? [];
        list.push(edge.to);
        outgoing.set(edge.from, list);
      }
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]!;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(...(outgoing.get(id) ?? []));
    }
    return symbols.filter((s) => s.kind === "op" && seen.has(s.id));
  }, [selectedEntry, symbols, report]);
  const completions = (site: CompletionSite | undefined) => [
    ...symbols
      .filter((s) => !s.visibleFrom || s.visibleFrom.includes(absolute(file)))
      .map((s) =>
        s.callable
          ? snippetCompletion(
              callableSnippet(
                s,
                completionCaller(symbols, absolute(file), site),
              ),
              {
                label: s.name,
                type:
                  s.kind === "flow" || s.kind === "op" ? "method" : "function",
                detail: s.signature,
                info:
                  "Inputs: " +
                  (s.callable.parameters
                    .map((p) => p.name + " — " + describeShape(p.shape))
                    .join("; ") || "none") +
                  ". Returns " +
                  describeShape(s.callable.result) +
                  ".",
              },
            )
          : {
              label: s.name,
              type: s.kind === "type" ? "type" : "variable",
              detail: s.signature,
            },
      ),
    ...blocks.map((block) =>
      snippetCompletion(block.template, {
        label: block.name,
        type: "keyword",
        detail: block.title,
        info: block.detail,
      }),
    ),
    ...[
      "type",
      "resource",
      "machine",
      "Result",
      "List",
      "Bool",
      "Nat",
      "Int",
      "String",
    ].map((label) => ({ label, type: "keyword" })),
  ];
  async function runCheck(
    kind: "check" | "simulate" | "verify" = "check",
    target = fileRef.current,
  ) {
    setError("");
    setNotice("");
    setFrozen(false);
    setRange(null);
    try {
      const local = kind === "check";
      if (local) lastLocalRequest.current = target + ":" + revisionRef.current;
      const created = readRun(
        await api("run", {
          clientId: clientId.current,
          revision: revisionRef.current,
          buffers: unsavedBuffers(buffersRef.current, sourceFilesRef.current),
          kind,
          ...scenario({
            file: target,
            entry: entry || "local",
            ...(local
              ? { seed: "42", maxSteps: 12, maxSamples: 1000, timeoutMs: 45000 }
              : settings),
            scope: local ? {} : (JSON.parse(settings.scope) as unknown),
          }),
          entry,
        }),
      );
      setSelectedRun(created.id);
      setRuns((old) => mergeRun(old, created));
      return created;
    } catch (e) {
      setError(String(e));
    }
  }
  useLayoutEffect(() => {
    if (!revealAnalysis.current) return;
    revealAnalysis.current = false;
    focusAnalysis();
  }, [tab]);
  useEffect(() => {
    setProjectTypes([]);
    if (!newFile) {
      setTypeCatalogue({ status: "idle", message: "" });
      return;
    }
    if (!file) {
      setTypeCatalogue({ status: "ready", message: "" });
      return;
    }
    if (!current?.report) {
      setTypeCatalogue({
        status: "loading",
        message: "Checking the current source for available types…",
      });
      return;
    }
    setTypeCatalogue({
      status: "loading",
      message: "Loading types from the checked design…",
    });
    let active = true;
    void api("interface", {
      action: "types",
      runId: current.id,
      file: absolute(file),
    })
      .then((raw) => {
        if (!object(raw) || !Array.isArray(raw.types))
          throw Error("Invalid checked type catalogue");
        const types: InterfaceContext["types"] = [];
        for (const value of raw.types) {
          if (
            !object(value) ||
            typeof value.name !== "string" ||
            typeof value.symbolId !== "string" ||
            typeof value.file !== "string"
          )
            throw Error("Invalid checked type");
          if (value.kind !== "record" && value.kind !== "choice") continue;
          types.push({
            name: value.name,
            symbolId: value.symbolId,
            file: relative(value.file),
            kind: value.kind,
          });
        }
        if (active) {
          setProjectTypes(types);
          setTypeCatalogue({ status: "ready", message: "" });
        }
      })
      .catch((e) => {
        if (active) setTypeCatalogue({ status: "error", message: String(e) });
      });
    return () => {
      active = false;
    };
  }, [newFile, current?.id, current?.report?.snapshot.id, file]);
  function openNewDesign() {
    setNewFile(true);
    if (file && !active) void runCheck();
  }
  async function applySourcePreview(
    preview: SourceEditPreview,
    message: string,
    name?: string,
  ) {
    const baseRevision = revisionRef.current;
    if (preview.importedSources?.length) {
      await api("declaration/imports", {
        sources: preview.importedSources,
        buffers: unsavedBuffers(buffersRef.current, project?.files ?? []),
      });
      if (revisionRef.current !== baseRevision)
        throw Error(
          "The design changed while its imported types were being checked. Preview again before applying.",
        );
    }
    for (const change of preview.files) {
      const target = relative(change.file);
      const current =
        buffersRef.current[target] ??
        project?.files.find((file) => file.path === target)?.text;
      if (current !== change.before)
        throw Error(
          "The file " +
            target +
            " changed while this form was open. Close and resume the form to review both changes. No files were applied.",
        );
    }
    const target = relative(preview.file),
      next = { ...buffersRef.current };
    for (const change of preview.files)
      next[relative(change.file)] = change.text;
    buffersRef.current = next;
    setBuffers(next);
    setFile(target);
    fileRef.current = target;
    revisionRef.current++;
    setRevision(revisionRef.current);
    await runCheck("check", target);
    setNotice(message);
    setAppliedFocus({ file: target, text: preview.text, name });
  }
  function closeDeclaration() {
    declarationGeneration.current++;
    setDeclarationOpen(false);
  }
  const operationGeneration = useRef(0);
  function closeOperation() {
    operationGeneration.current++;
    setOperationSession(null);
  }
  async function openOperation(symbolId?: string) {
    const symbol = symbolId
      ? symbols.find(
          (item) => item.id === symbolId && ["op", "flow"].includes(item.kind),
        )
      : undefined;
    if (symbolId && !symbol) {
      setError("Check the current source before editing this operation.");
      return;
    }
    const name = symbol?.name ?? operationDraft?.name ?? operationSession?.name;
    const target = symbol
      ? relative(symbol.span.file)
      : (operationDraft?.file ?? operationSession?.file);
    if (!name || !target) return;
    if (
      operationDraft &&
      (operationDraft.file !== target || operationDraft.name !== name)
    ) {
      setNotice(
        "Another operation form is unfinished. Resume or discard it before opening this operation.",
      );
      return;
    }
    const generation = ++operationGeneration.current;
    if (!(await openFile(target, false))) {
      setOperationSession(null);
      return;
    }
    if (generation !== operationGeneration.current) return;
    setOperationSession({ file: target, name });
    const run = await runCheck("check", target);
    if (operationGeneration.current !== generation) return;
    setOperationSession(
      run
        ? { file: target, name, runId: run.id }
        : {
            file: target,
            name,
            error:
              "The source could not be checked. Keep the form, correct the source and check again.",
          },
    );
  }
  async function openResource(symbolId: string) {
    const symbol = symbols.find(
      (item) => item.id === symbolId && item.kind === "resource",
    );
    if (!symbol) {
      setError("Check the current source before editing this lifecycle.");
      return;
    }
    if (
      declarationDraft &&
      (!declarationDraft.resourceEdit ||
        declarationDraft.resourceEdit.name !== symbol.name ||
        declarationDraft.file !== relative(symbol.span.file))
    ) {
      setError(
        "Another declaration form is unfinished. Resume or discard it before editing this lifecycle.",
      );
      return;
    }
    await openDeclaration(symbol.name);
  }
  async function openDeclaration(
    resourceName = declarationDraft?.resourceEdit?.name,
  ) {
    const target = declarationDraft?.file ?? fileRef.current;
    const generation = ++declarationGeneration.current;
    setDeclarationSession({
      file: target,
      ...(resourceName ? { resourceName } : {}),
    });
    setDeclarationOpen(true);
    const run = await runCheck("check", target);
    if (generation !== declarationGeneration.current) return;
    setDeclarationSession(
      run
        ? {
            file: target,
            runId: run.id,
            ...(resourceName ? { resourceName } : {}),
          }
        : {
            file: target,
            ...(resourceName ? { resourceName } : {}),
            error:
              "The source could not be checked. Keep the form and correct the source, then try again.",
          },
    );
  }
  async function openType(symbolId?: string) {
    if (typeDraft && symbolId) {
      const symbol = symbols.find((item) => item.id === symbolId);
      if (
        !symbol ||
        symbol.name !== typeDraft.name ||
        relative(symbol.span.file) !== typeDraft.file
      ) {
        setNotice(
          "An unfinished data-shape form is already saved. Resume or discard it before opening another shape.",
        );
        return;
      }
    }
    const generation = ++typeRequestGeneration.current;
    const checked = await runCheck("check", typeDraft?.file ?? file);
    if (checked && generation === typeRequestGeneration.current)
      setPendingType({
        runId: checked.id,
        generation,
        ...(symbolId ? { symbolId } : {}),
        draft: typeDraft,
      });
  }
  function cancelTypeOpening() {
    typeRequestGeneration.current++;
    setPendingType(null);
  }
  useEffect(() => {
    if (!pendingType) return;
    const checked = runs.find((run) => run.id === pendingType.runId);
    if (!checked || checked.status === "running") return;
    const controller = new AbortController(),
      requested = pendingType;
    const target = requested.draft
      ? checked.symbols.find(
          (symbol) =>
            symbol.kind === "type" &&
            symbol.name === requested.draft!.name &&
            relative(symbol.span.file) === requested.draft!.file,
        )?.id
      : requested.symbolId;
    if (!checked.report || !target) {
      setError(
        "This data shape could not be found in the current source. Your saved form is retained; restore the shape or download the draft before replacing it.",
      );
      setPendingType(null);
      return;
    }
    void api(
      "interface",
      { action: "type", runId: checked.id, symbolId: target },
      controller.signal,
    )
      .then(async (raw) => {
        const description = readTypeDefinition(raw);
        if (!description.definition)
          throw Error(
            description.unsupported ??
              "This data shape cannot be edited in the form.",
          );
        const catalog = await api(
          "interface",
          { action: "types", runId: checked.id, file: description.file },
          controller.signal,
        );
        if (!object(catalog) || !Array.isArray(catalog.types))
          throw Error("The available types could not be read.");
        const knownTypes = catalog.types.flatMap((entry) =>
          object(entry) &&
          typeof entry.name === "string" &&
          typeof entry.symbolId === "string" &&
          (entry.kind === "record" || entry.kind === "choice")
            ? [
                {
                  name: entry.name,
                  symbolId: entry.symbolId,
                  kind: entry.kind as "record" | "choice",
                },
              ]
            : [],
        );
        if (
          !controller.signal.aborted &&
          requested.generation === typeRequestGeneration.current
        )
          setTypeSession({ runId: checked.id, description, knownTypes });
      })
      .catch((error) => {
        if (
          !controller.signal.aborted &&
          requested.generation === typeRequestGeneration.current
        )
          setError(String(error));
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          requested.generation === typeRequestGeneration.current
        )
          setPendingType((pending) => (pending === requested ? null : pending));
      });
    return () => controller.abort();
  }, [pendingType, runs]);
  async function resumeInterface() {
    if (!interfaceDraft) return;
    const checked = await runCheck("check", interfaceDraft.file);
    if (checked)
      setPendingInterface({
        runId: checked.id,
        symbolId: interfaceDraft.symbolId,
        draft: interfaceDraft,
      });
  }
  async function openInterface(symbolId?: string) {
    if (interfaceDraft) {
      await resumeInterface();
      return;
    }
    // A checked block already supplies its identity. During automatic checking
    // the current symbol list can be temporarily empty; revalidate that identity
    // in the new run instead of silently dropping the user's action.
    const target = symbolId ?? authoringSymbol()?.id;
    if (!target) return;
    const checked = await runCheck("check");
    if (checked) setPendingInterface({ runId: checked.id, symbolId: target });
  }
  useEffect(() => {
    if (!pendingInterface) return;
    const checked = runs.find((r) => r.id === pendingInterface.runId);
    if (!checked || checked.status === "running") return;
    const requested = pendingInterface;
    setPendingInterface(null);
    if (!checked.report) {
      setError("The source could not be checked for interface editing.");
      return;
    }
    void api("interface", {
      action: requested.draft ? "resume" : "describe",
      ...requested,
    })
      .then((raw) => {
        let restored: InterfaceDraft | undefined;
        if (requested.draft) {
          if (
            !object(raw) ||
            !Array.isArray(raw.conflicts) ||
            !raw.conflicts.every((c) => typeof c === "string")
          )
            throw Error("Invalid interface resume response");
          if (raw.conflicts.length) {
            const candidates = Array.isArray(raw.candidates)
              ? raw.candidates.filter(
                  (c): c is { symbolId: string; name: string } =>
                    object(c) &&
                    typeof c.symbolId === "string" &&
                    typeof c.name === "string",
                )
              : [];
            setInterfaceConflict({
              runId: requested.runId,
              draft: requested.draft,
              description: raw.description
                ? readSignatureDescription(raw.description)
                : null,
              conflicts: raw.conflicts as string[],
              candidates,
            });
            return;
          }
          restored = readInterfaceDraft(raw.draft);
        }
        const description = readSignatureDescription(
          requested.draft && object(raw) ? raw.description : raw,
        );
        setInterfaceDraft(
          restored ?? {
            baseline: {
              ...(description.headerHash
                ? { headerHash: description.headerHash }
                : {}),
              signature: {
                name: description.name,
                inputs: description.inputs,
                output: description.output,
                effects: description.effects,
              },
              types: [],
            },
            file: relative(description.file),
            symbolId: description.symbolId,
            snapshotId: description.snapshotId,
            edit: {
              name: description.name,
              inputs: description.inputs,
              output: description.output,
              effects: description.effects,
            },
          },
        );
        const source = checked.report!.snapshot.files.find(
          (s) => s.file === description.file,
        );
        if (!source)
          throw Error("The checked interface source is unavailable.");
        setInterfaceSession({
          runId: requested.runId,
          description,
          baseText: source.text,
        });
      })
      .catch((e) => setError(String(e)));
  }, [pendingInterface, runs]);
  useEffect(() => {
    const controller = new AbortController();
    void api("project", undefined, controller.signal)
      .then(readProject)
      .then((data) => {
        const files = [...data.files];
        const recovered = Object.fromEntries(
          files.filter((f) => f.loaded !== false).map((f) => [f.path, f.text]),
        );
        let conflicts = 0;
        for (const draft of data.recovery.drafts) {
          const index = files.findIndex((f) => f.path === draft.path);
          if (index >= 0) {
            if (draft.baseHash !== files[index]!.hash) {
              conflicts++;
              files[index] = {
                ...files[index]!,
                hash: draft.baseHash ?? files[index]!.hash,
              };
            }
          } else
            files.push({
              path: draft.path,
              text: "",
              hash: draft.baseHash ?? "",
              exists: false,
            });
          recovered[draft.path] = draft.text;
        }
        for (const source of files)
          bufferBases.current.loaded(
            source.path,
            source.exists === false ? null : source.hash,
          );
        for (const draft of data.recovery.drafts)
          bufferBases.current.loaded(draft.path, draft.baseHash);
        sourceFilesRef.current = files;
        setProject({ ...data, files });
        if (
          !workspaceViewChosen.current &&
          !files.length &&
          data.architectureAvailable
        ) {
          setArchitectureVisited(true);
          setArchitectureOpen(true);
        }
        setBuffers(recovered);
        buffersRef.current = recovered;
        const context = data.recovery.context;
        const initial =
          (context?.file && files.some((f) => f.path === context.file)
            ? context.file
            : null) ??
          (data.defaultFile &&
          files.some((f) => f.path === data.defaultFile && f.loaded !== false)
            ? data.defaultFile
            : null) ??
          files.find((f) => f.loaded !== false)?.path ??
          "";
        if (context) {
          setEntry(context.entry);
          setTab(context.tab);
          setEditorMode(context.editorMode ?? "text");
          setSettings(context.settings);
          setCursor(context.cursor ?? 0);
          setInterfaceDraft(context.interfaceDraft ?? null);
          setTypeDraft(context.typeDraft ?? null);
          setDeclarationDraft(
            context.declarationDraft
              ? declarationDraftSchema.parse(context.declarationDraft)
              : null,
          );
          setOperationDraft(
            context.operationDraft
              ? operationDraftSchema.parse(context.operationDraft)
              : null,
          );
          setImplementationDrafts(context.implementationDrafts ?? []);
          setRangeDrafts(context.rangeDrafts ?? []);
          setNewDesign(context.newDesign ?? null);
        }
        if (data.recovery.drafts.length)
          setRecoveryNotice(
            `Recovered ${data.recovery.drafts.length} unsaved file${data.recovery.drafts.length === 1 ? "" : "s"}.${conflicts ? " Files also changed on disk; review the conflict before saving." : ""}`,
          );
        setFile(initial);
        fileRef.current = initial;
        setRuns(data.runs);
        setConnected(true);
        if (
          context?.selectedRun &&
          data.runs.some((r) => r.id === context.selectedRun)
        ) {
          setSelectedRun(context.selectedRun);
          setFrozen(context.frozen ?? false);
          if (initial && context.editorMode === "blocks" && !context.frozen)
            void runCheck("check", initial);
        } else if (initial) void runCheck("check", initial);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      });
    void events((event) => {
      setConnected(true);
      if (event.kind === "recovery") recovery.observeExternal(event);
      else if (event.kind === "run") setRuns((old) => mergeRun(old, event.run));
      else {
        const pending = pendingSaves.current.get(event.file.path);
        if (pending?.text === event.file.text)
          bufferBases.current.acknowledged(
            event.file.path,
            pending.expectedHash,
            event.file.hash,
          );
        else
          bufferBases.current.observed(
            event.file,
            buffersRef.current[event.file.path],
          );
        setProject((old) =>
          old
            ? {
                ...old,
                files: [
                  event.file,
                  ...old.files.filter((f) => f.path !== event.file.path),
                ].sort((a, b) => a.path.localeCompare(b.path)),
              }
            : old,
        );
      }
    }, controller.signal).catch((e) => {
      if (!controller.signal.aborted) {
        setConnected(false);
        setError(
          "Workspace connection lost. Your editor buffers are still here. " +
            String(e),
        );
      }
    });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (
      !auto ||
      frozen ||
      !file ||
      lastLocalRequest.current === file + ":" + revision
    )
      return;
    const timer = setTimeout(() => void runCheck(), 300);
    return () => clearTimeout(timer);
  }, [revision, auto]);
  function edit(text: string) {
    if (frozen) return;
    setBuffers((old) => ({ ...old, [file]: text }));
    buffersRef.current = { ...buffersRef.current, [file]: text };
    const next = revisionRef.current + 1;
    revisionRef.current = next;
    setRevision(next);
    setRange(null);
  }
  function rememberDeletedFile(path: string) {
    const prior = sourceFilesRef.current.find((source) => source.path === path);
    const missing = {
      ...(prior ?? { path, text: "", hash: "" }),
      exists: false,
    };
    const update = (files: typeof sourceFilesRef.current) =>
      files.map((source) => (source.path === path ? missing : source));
    sourceFilesRef.current = update(sourceFilesRef.current);
    setProject((old) => (old ? { ...old, files: update(old.files) } : old));
    setDiskConflict(missing);
    return missing;
  }
  async function openFile(path: string, check = true) {
    const request = ++sourceOpenRequest.current;
    let notice = "";
    if (sourceFilesRef.current.find((f) => f.path === path)?.exists !== false) {
      try {
        const loaded = readSourceFile(
          await api("source?file=" + encodeURIComponent(path)),
        );
        if (request !== sourceOpenRequest.current) return;
        const prior = sourceFilesRef.current.find((f) => f.path === path);
        const buffer = buffersRef.current[path];
        const changedBuffer = buffer !== undefined && buffer !== prior?.text;
        if (changedBuffer && prior?.hash !== loaded.hash) {
          // Keep the old base until the user explicitly resolves both versions.
          setDiskConflict(loaded);
          if (!check) return false;
        } else {
          const update = (files: typeof sourceFilesRef.current) =>
            files.some((f) => f.path === path)
              ? files.map((f) => (f.path === path ? loaded : f))
              : [...files, loaded];
          sourceFilesRef.current = update(sourceFilesRef.current);
          setProject((old) =>
            old ? { ...old, files: update(old.files) } : old,
          );
          if (!changedBuffer) {
            bufferBases.current.loaded(path, loaded.hash);
            setBuffers((old) => ({ ...old, [path]: loaded.text }));
            buffersRef.current = { ...buffersRef.current, [path]: loaded.text };
            if (prior?.loaded !== false && prior?.hash !== loaded.hash)
              notice = "Reloaded external changes in " + basename(path);
          }
        }
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status === 404 &&
          buffersRef.current[path] !== undefined
        ) {
          rememberDeletedFile(path);
          setError("");
          if (!check) return false;
        } else {
          setError(String(error));
          return;
        }
      }
    }
    setFile(path);
    fileRef.current = path;
    setEntry("");
    setSettings((old) => ({ ...old, scope: "{}" }));
    setRange(null);
    setFrozen(false);
    setNotice(notice);
    if (check) void runCheck("check", path);
    return true;
  }
  function jump(span: Span) {
    sourceOpenRequest.current++;
    const path = relative(span.file);
    setFile(path);
    fileRef.current = path;
    const original = report?.snapshot.files.find(
      (f) => f.file === span.file,
    )?.text;
    setFrozen(original !== buffersRef.current[path]);
    setRange({ start: span.start, end: span.end });
  }
  function acknowledgeSave(
    saved: import("../../src/studio/protocol").StudioFile,
    expectedHash: string | null,
  ) {
    bufferBases.current.acknowledged(saved.path, expectedHash, saved.hash);
    setProject((old) => {
      if (!old) return old;
      const known = old.files.find((file) => file.path === saved.path);
      // A late response must not replace a newer disk event in the file list.
      if (known && known.hash !== expectedHash && known.hash !== saved.hash)
        return { ...old };
      return {
        ...old,
        files: [
          ...old.files.filter((file) => file.path !== saved.path),
          saved,
        ].sort((a, b) => a.path.localeCompare(b.path)),
      };
    });
  }
  async function save() {
    if (!project || frozen) return;
    setError("");
    const target = file;
    const original = project.files.find((f) => f.path === target);
    const text = buffersRef.current[target] ?? original?.text ?? "";
    const expectedHash = bufferBases.current.expected(
      target,
      original?.exists === false ? null : (original?.hash ?? null),
    );
    const pending = { text, expectedHash };
    pendingSaves.current.set(target, pending);
    try {
      const saved = readSourceFile(
        await api("save", { path: target, text, expectedHash }),
      );
      acknowledgeSave(saved, expectedHash);
      setLastSave({ path: target, newer: buffersRef.current[target] !== text });
    } catch (e) {
      setError(String(e));
      if (String(e).includes("File was deleted on disk")) {
        rememberDeletedFile(target);
        return;
      }
      if (String(e).includes("File changed on disk")) {
        try {
          const latest = readProject(await api("project")).files.find(
            (f) => f.path === target,
          );
          if (latest) setDiskConflict(latest);
        } catch {
          /* Original save error remains visible. */
        }
      }
    } finally {
      if (pendingSaves.current.get(target) === pending)
        pendingSaves.current.delete(target);
    }
  }
  function exportReport() {
    if (!report) return;
    const copy = structuredClone(report);
    if (!includeSource)
      copy.snapshot.files = copy.snapshot.files.map((f) => ({
        ...f,
        text: "",
      }));
    const blob = new Blob(
        [
          JSON.stringify(
            {
              format: "pymtheg.export/v1",
              containsSource: includeSource,
              report: copy,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `pymtheg-${current?.request.kind ?? "report"}-${report.snapshot.id.slice(0, 8)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  async function exportScaffold(previewOnly = false, manifestOnly = false) {
    try {
      if (!current) return;
      const raw = await api("scaffold", {
        id: current.id,
        target: scaffoldTarget,
        body: scaffoldBody,
        mode: scaffoldMode,
      });
      if (
        !object(raw) ||
        typeof raw.source !== "string" ||
        typeof raw.extension !== "string" ||
        !Array.isArray(raw.omitted)
      )
        throw Error("Invalid scaffold response");
      if (previewOnly) {
        setScaffoldPreview({
          runId: current.id,
          target: scaffoldTarget,
          body: scaffoldBody,
          mode: scaffoldMode,
          source: raw.source,
          omitted: raw.omitted.length,
        });
        return;
      }
      if (
        manifestOnly &&
        (raw.omitted.length > 0 ||
          current.report?.diagnostics.some((d) => d.severity === "error"))
      )
        throw Error(
          "Baseline not saved: repair the unresolved contracts or source errors before saving a comparison baseline.",
        );
      const blob = new Blob(
          [
            manifestOnly
              ? JSON.stringify(
                  contractManifestSchema.parse(raw.contractManifest),
                  null,
                  2,
                )
              : raw.source,
          ],
          { type: "text/plain" },
        ),
        url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = manifestOnly
        ? "contracts.manifest.json"
        : "contracts" + raw.extension;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(
        `Downloaded ${manifestOnly ? "contract comparison baseline" : scaffoldMode === "contracts" ? "regenerable contracts without implementation bodies" : scaffoldTarget + " scaffold with " + (scaffoldBody === "fail-fast" ? "fail-fast stubs" : "empty bodies")}. ${raw.omitted.length} unresolved or unsupported declarations omitted. Returns, effects and cleanup still need implementation.`,
      );
    } catch (e) {
      setError(String(e));
    }
  }
  async function compareScaffold(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !current) return;
    setScaffoldDrift(null);
    try {
      if (file.size > 16 * 1024 * 1024)
        throw Error("Contract manifest exceeds 16 MiB");
      const previous = JSON.parse(
        decodeUtf8(await file.arrayBuffer(), file.name),
      );
      const raw = await api("scaffold", {
        id: current.id,
        target: scaffoldTarget,
        body: scaffoldBody,
        mode: scaffoldMode,
      });
      if (!object(raw)) throw Error("Invalid scaffold response");
      setScaffoldDrift(
        compareContractManifests(
          previous,
          contractManifestSchema.parse(raw.contractManifest),
        ),
      );
    } catch (error) {
      setError(String(error));
    }
    event.target.value = "";
  }
  async function importReport(event: React.ChangeEvent<HTMLInputElement>) {
    const upload = event.target.files?.[0];
    if (!upload) return;
    try {
      if (upload.size > 8 * 1024 * 1024) throw Error("Report exceeds 8 MiB.");
      const raw: unknown = JSON.parse(
        decodeUtf8(await upload.arrayBuffer(), upload.name).replace(
          /^\uFEFF/,
          "",
        ),
      );
      const imported = readReport(
        object(raw) && raw.format === "pymtheg.export/v1" ? raw.report : raw,
      );
      const r: StudioRun = {
        sequence: 1,
        id: crypto.randomUUID(),
        request: {
          clientId: "imported",
          revision: -1,
          file: relative(imported.snapshot.files[0]?.file ?? ""),
          buffers: {},
          kind: "check",
          entry: "",
          seed: "",
          maxSteps: 1,
          maxSamples: 1,
        },
        status: "completed",
        phase: "finished",
        report: imported,
        symbols: [],
        error: null,
      };
      setRuns((old) => [r, ...old].slice(0, 10));
      setSelectedRun(r.id);
      setFrozen(true);
      setFile(relative(imported.snapshot.files[0]?.file ?? ""));
      setTab("findings");
    } catch (e) {
      setError(String(e));
    }
    event.target.value = "";
  }
  async function createRecipe(draft: RecipeDraft) {
    const path = sourceFileName(draft.path);
    const prepared = await api("format", { file: path, text: draft.source });
    if (!object(prepared) || typeof prepared.text !== "string")
      throw Error("Could not prepare the recipe source.");
    draft = { ...draft, source: prepared.text };
    const saved = await api("save", {
      path,
      text: draft.source,
      expectedHash: null,
    });
    if (
      !object(saved) ||
      typeof saved.path !== "string" ||
      typeof saved.text !== "string" ||
      typeof saved.hash !== "string"
    )
      throw Error("The saved file response could not be read.");
    const sourceFile = { path: saved.path, text: saved.text, hash: saved.hash };
    bufferBases.current.loaded(sourceFile.path, sourceFile.hash);
    setProject((old) =>
      old
        ? {
            ...old,
            files: [
              ...old.files.filter((f) => f.path !== sourceFile.path),
              sourceFile,
            ].sort((a, b) => a.path.localeCompare(b.path)),
          }
        : old,
    );
    setBuffers((old) => ({ ...old, [path]: draft.source }));
    buffersRef.current = { ...buffersRef.current, [path]: draft.source };
    setFile(path);
    fileRef.current = path;
    setEntry("");
    setSettings((old) => ({ ...old, scope: "{}" }));
    setRange(null);
    setFrozen(false);
    setTab("findings");
    setFilter("all");
    setRecipeDraft({ ...draft, path });
    setNewFile(false);
    setNewDesign(null);
    setAuto(true);
    await runCheck("check", path);
  }
  useEffect(() => {
    if (
      !setupOpen &&
      !help &&
      !newFile &&
      !settingsOpen &&
      !referenceSymbol &&
      !diskConflict &&
      !connectHelp &&
      !interfaceSession &&
      !typeSession &&
      !pendingType &&
      !declarationOpen &&
      !operationSession &&
      !interfaceConflict &&
      !recoveryReview
    )
      return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>("[role=dialog]");
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
        ) ?? [],
      );
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHelp(false);
        setSetupOpen(false);
        setConnectHelp(false);
        setNewFile(false);
        setInterfaceSession(null);
        setTypeSession(null);
        cancelTypeOpening();
        closeDeclaration();
        closeOperation();
        setInterfaceConflict(null);
        setSettingsOpen(false);
        setReferenceSymbol(null);
        setDiskConflict(null);
        setRecoveryReview(null);
      }
      if (event.key === "Tab") {
        const nodes = focusable(),
          first = nodes[0],
          last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [
    setupOpen,
    help,
    newFile,
    settingsOpen,
    referenceSymbol,
    diskConflict,
    connectHelp,
    interfaceSession,
    typeSession,
    pendingType,
    declarationOpen,
    !!operationSession,
    interfaceConflict,
    recoveryReview,
  ]);
  const findings = [...(report?.diagnostics ?? [])]
    .sort(
      (a, b) =>
        ({ error: 0, warning: 1, info: 2 })[a.severity] -
        { error: 0, warning: 1, info: 2 }[b.severity],
    )
    .filter(
      (d) =>
        (filter === "all" || d.severity === filter) &&
        `${d.code} ${d.message} ${d.span.file}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
  const explain = useMemo(
    () => (report ? findingPresenter(report) : null),
    [report],
  );
  const lineIndex = useMemo(
    () =>
      new Map(
        (report?.snapshot.files ?? []).map((s) => {
          const starts = [0];
          for (let i = 0; i < s.text.length; i++)
            if (s.text[i] === "\n") starts.push(i + 1);
          return [s.file, starts] as const;
        }),
      ),
    [report],
  );
  function sourceLocation(span: Span) {
    if (
      report?.snapshot.files.some((f) => f.file === span.file && f.text === "")
    )
      return `${basename(span.file)} · offset ${span.start} (source omitted)`;
    const starts = lineIndex.get(span.file) ?? [0];
    let lo = 0,
      hi = starts.length;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid]! <= span.start) lo = mid;
      else hi = mid;
    }
    return `${basename(span.file)}:${lo + 1}:${span.start - starts[lo]! + 1}`;
  }
  const costs = report?.results.filter((r) => r.analysisKind === "cost") ?? [],
    behaviour =
      report?.results.filter((r) => r.analysisKind === "behaviour") ?? [];
  const traceResult =
    behaviour.find((r) => r.propertyId === selectedResult) ??
    behaviour.find(
      (r) =>
        object(r.witnessOrDerivation) &&
        Array.isArray(r.witnessOrDerivation.states),
    );
  const witness =
    traceResult && object(traceResult.witnessOrDerivation)
      ? traceResult.witnessOrDerivation
      : null;
  const states =
      witness && Array.isArray(witness.states)
        ? witness.states.filter(object)
        : [],
    traceEvents =
      witness && Array.isArray(witness.events)
        ? witness.events.filter(object)
        : [];
  const lastStateValues = states.at(-1)?.values;
  const lastValues = object(lastStateValues) ? lastStateValues : null;
  const index = Math.min(traceIndex, Math.max(0, states.length - 1)),
    state = states[index],
    previous = states[index - 1];
  const oldReport = runs.find((r) => r.id === baseline)?.report;
  const oldCosts = new Map(
    oldReport?.results.map((r) => [r.propertyId, r]) ?? [],
  );
  const issues =
    report?.diagnostics.filter((d) => d.severity === "error").length ?? 0;
  const pending =
    report?.results.filter((r) => r.completion !== "complete").length ?? 0;
  function traceStep(next: number) {
    setTraceIndex(next);
    const event =
      traceEvents[
        states.slice(1, next + 1).filter((s) => s.event !== -1).length - 1
      ];
    if (
      event &&
      object(event.span) &&
      typeof event.span.file === "string" &&
      typeof event.span.start === "number" &&
      typeof event.span.end === "number"
    )
      jump(event.span as unknown as Span);
  }
  function authoringSymbol() {
    const prefix = value.slice(0, cursor),
      call = prefix.match(/\bcall\s+([A-Za-z_]\w*)\s*\([^;{}]*$/);
    if (call) {
      const matched = symbols.find((s) => s.name === call[1] && s.callable);
      if (matched) return matched;
    }
    const atCursor = symbolAt(cursor);
    return (
      (atCursor?.callable ? atCursor : undefined) ??
      selectedEntry ??
      symbols.find((s) => s.span.file === absolute(file) && s.callable)
    );
  }
  function symbolAt(offset: number) {
    if (historical && !frozen) return undefined;
    const path = absolute(file);
    return (
      symbols.find((s) =>
        s.references?.some(
          (r) => r.file === path && r.start <= offset && offset <= r.end,
        ),
      ) ??
      symbols.find(
        (s) =>
          s.span.file === path &&
          s.span.start <= offset &&
          offset <= s.span.end,
      )
    );
  }
  function navigate(offset: number, references: boolean) {
    const s = symbolAt(offset);
    if (!s) {
      setNotice(
        "No resolved declaration at this position. Check the current buffer first.",
      );
      return;
    }
    if (references) setReferenceSymbol(s);
    else jump(s.span);
  }
  async function formatBuffer() {
    try {
      const formatted = await api("format", { file, text: value });
      if (object(formatted) && typeof formatted.text === "string")
        edit(formatted.text);
    } catch (e) {
      setError(String(e));
    }
  }
  async function reloadFile() {
    const target = fileRef.current;
    const request = ++sourceOpenRequest.current;
    try {
      const data = readProject(await api("project"));
      let fresh = data.files.find((f) => f.path === target);
      if (!fresh)
        throw Error("File no longer exists on disk; your buffer is preserved.");
      if (fresh.loaded === false)
        fresh = readSourceFile(
          await api("source?file=" + encodeURIComponent(target)),
        );
      if (request !== sourceOpenRequest.current || target !== fileRef.current)
        return;
      if (
        buffersRef.current[target] !== undefined &&
        buffersRef.current[target] !==
          project?.files.find((f) => f.path === target)?.text
      ) {
        setDiskConflict(fresh);
        return;
      }
      bufferBases.current.loaded(target, fresh.hash);
      setProject({
        ...data,
        files: data.files.map((entry) =>
          entry.path === target ? fresh! : entry,
        ),
      });
      edit(fresh.text);
      setNotice("Reloaded " + basename(target));
      void runCheck("check", target);
    } catch (e) {
      setError(String(e));
    }
  }
  function chooseScenario(name: string) {
    const chosen = project?.config.scenarios[name];
    if (!chosen) return;
    setFile(chosen.file);
    fileRef.current = chosen.file;
    setEntry(chosen.entry);
    setSettings({
      seed: chosen.seed,
      maxSteps: chosen.maxSteps,
      maxSamples: chosen.maxSamples,
      timeoutMs: chosen.timeoutMs,
      scope: JSON.stringify(chosen.scope, null, 2),
    });
    setSettingsError("");
    void runCheck("check", chosen.file);
  }
  async function saveScenario() {
    try {
      const problems = scopeProblems(
        selectedEntry,
        scenarioOperations,
        settings.scope,
      );
      if (problems.length) throw Error(problems.join(" "));
      const saved = await api("scenario", {
        name: scenarioName,
        expectedHash: project?.configHash ?? null,
        scenario: scenario({
          file,
          entry: entry || "local",
          ...settings,
          scope: JSON.parse(settings.scope) as unknown,
        }),
      });
      if (
        !object(saved) ||
        !(saved.hash === null || typeof saved.hash === "string")
      )
        throw Error("Invalid configuration response");
      const config = projectConfig(saved.config);
      setProject((old) =>
        old ? { ...old, config, configHash: saved.hash as string | null } : old,
      );
      setScenarioSaved(`Saved “${scenarioName.trim()}” in the project.`);
      setSettingsError("");
    } catch (e) {
      setSettingsError(String(e));
    }
  }
  const shellQuote = (text: string) =>
    "'" + text.replaceAll("'", "'\"'\"'") + "'";
  const command = `${publicIdentity.cli} simulate ${shellQuote(file)} --entry ${shellQuote(entry)} --seed ${settings.seed} --max-steps ${settings.maxSteps} --max-samples ${settings.maxSamples} --timeout ${settings.timeoutMs}ms --scope scenario.json`;
  function exportScope() {
    try {
      const scope = JSON.parse(settings.scope) as unknown;
      scenario({ file, entry: entry || "local", ...settings, scope });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(scope, null, 2) + "\n"], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "scenario.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setSettingsError(String(e));
    }
  }
  const modalOpen =
    setupOpen ||
    help ||
    newFile ||
    settingsOpen ||
    !!referenceSymbol ||
    !!diskConflict ||
    connectHelp ||
    declarationOpen ||
    !!operationSession ||
    !!interfaceSession ||
    !!typeSession ||
    !!pendingType ||
    !!interfaceConflict ||
    !!recoveryReview;
  useEffect(() => {
    if (editorMode !== "blocks" || modalOpen || architectureOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();
        if (file && !frozen) void save();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editorMode, modalOpen, architectureOpen, file, frozen, project]);
  useEffect(() => {
    if (!appliedFocus || modalOpen) return;
    if (appliedFocus.file !== file || appliedFocus.text !== value) {
      setAppliedFocus(null);
      return;
    }
    if (
      editorMode !== "text" ||
      current?.status !== "completed" ||
      !current.report?.snapshot.files.some(
        (s) => s.text === appliedFocus.text && s.file === absolute(file),
      )
    )
      return;
    if (document.activeElement === document.body)
      document
        .querySelector<HTMLElement>(
          ".text-editor-container:not([hidden]) .cm-content",
        )
        ?.focus();
    setAppliedFocus(null);
  }, [appliedFocus, modalOpen, file, value, current, editorMode]);
  return (
    <div className={`app-shell ${architectureOpen ? "architecture-mode" : ""}`}>
      <header className="topbar" inert={modalOpen}>
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            setTab("findings");
          }}
        >
          <span className="brand-mark" aria-hidden="true">
            P<span>15</span>
          </span>
          <span>
            Pymtheg<small>DESIGN WORKSPACE</small>
          </span>
        </a>
        <div className="project-breadcrumb">
          <span className="breadcrumb-dot" />
          <span
            className="project-title"
            title={project?.workspace?.name ?? project?.root}
          >
            {project
              ? (project.workspace?.name ?? basename(project.root))
              : "Opening workspace"}
          </span>
          <span className="local-pill">LOCAL</span>
        </div>
        <div className="top-actions">
          {project && (
            <button className="quiet-action" onClick={() => setSetupOpen(true)}>
              Project setup
            </button>
          )}
          {project?.trust === "unanswered" && (
            // D22: a checkout with no trust answer on this machine (a clone)
            // runs nothing until the question is answered.
            <button
              className="quiet-action trust-unanswered"
              title="No build tool runs on this repository until you answer."
              onClick={() => setSetupOpen(true)}
            >
              Do you trust this repository? Answer
            </button>
          )}
          <button
            type="button"
            className="quiet-action"
            onClick={() => reportInput.current?.click()}
          >
            Import check report
          </button>
          <input
            ref={reportInput}
            hidden
            type="file"
            accept=".json"
            onChange={(e) => void importReport(e)}
          />
          <button
            className="quiet-action"
            onClick={() => {
              setConnectHelp(true);
              setConnectionNotice("");
            }}
          >
            Connect agent
          </button>
          <button
            className="quiet-action"
            aria-pressed={!architectureOpen}
            onClick={() => {
              workspaceViewChosen.current = true;
              setArchitectureOpen(false);
            }}
          >
            Design editor
          </button>
          <button
            className="quiet-action"
            aria-pressed={architectureOpen}
            onClick={() => {
              workspaceViewChosen.current = true;
              setArchitectureVisited(true);
              setArchitectureOpen(true);
            }}
          >
            Architecture
          </button>
          <button className="quiet-action" onClick={() => setHelp(true)}>
            Guide <kbd>?</kbd>
          </button>
          <span
            className={`connection ${connected ? "online" : ""}`}
            title={connected ? "Connected to local workspace" : "Disconnected"}
          >
            {connected ? "Connected" : "Offline"}
          </span>
        </div>
      </header>
      <aside className="sidebar" inert={modalOpen} hidden={architectureOpen}>
        <div className="section-label">
          EXPLORER
          <button
            aria-label="Create source file"
            title="New source file"
            onClick={openNewDesign}
          >
            ＋
          </button>
        </div>
        <div className="workspace-name">
          {project
            ? (project.workspace?.name ?? basename(project.root))
            : "Your project"}
          <span>{project?.files.length ?? 0} files</span>
        </div>
        <div className="file-list" role="navigation" aria-label="Source files">
          <input
            className="file-search"
            aria-label="Find source files"
            placeholder="Find a source file…"
            value={fileQuery}
            onChange={(e) => {
              setFileQuery(e.target.value);
              setFileLimit(200);
            }}
          />
          {project?.files
            .filter((f) =>
              f.path.toLowerCase().includes(fileQuery.toLowerCase()),
            )
            .sort(
              (a, b) =>
                a.path.localeCompare(b.path, "en", { numeric: true }) ||
                (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
            )
            .slice(0, fileLimit)
            .map((f) => (
              <button
                key={f.path}
                className={`file-row ${file === f.path ? "selected" : ""}`}
                onClick={() => openFile(f.path)}
                title={f.path}
              >
                <span className="file-icon">p</span>
                <span>
                  <strong>{basename(f.path)}</strong>
                  {f.path.includes("/") && (
                    <small>{f.path.slice(0, f.path.lastIndexOf("/"))}</small>
                  )}
                </span>
                {buffers[f.path] !== undefined &&
                  buffers[f.path] !== f.text && (
                    <i className="dirty-dot" aria-label="Unsaved changes" />
                  )}
              </button>
            ))}
          {(project?.files.filter((f) =>
            f.path.toLowerCase().includes(fileQuery.toLowerCase()),
          ).length ?? 0) > fileLimit && (
            <button onClick={() => setFileLimit((n) => n + 200)}>
              Show 200 more files
            </button>
          )}
        </div>
        <div className="sidebar-bottom">
          <span className="section-label">YOUR DESIGN, EARLIER</span>
          <p>
            Find missing cases, multiplied work and unfinished lifecycles while
            the design is still easy to change.
          </p>
          <button className="text-link" onClick={() => setHelp(true)}>
            How this workspace works ↗
          </button>
        </div>
      </aside>
      <main className="main-workspace" inert={modalOpen}>
        {!!project?.inventoryWarnings?.length && (
          <details className="message notice-message">
            <summary>
              Source inventory notes ({project.inventoryWarnings.length})
            </summary>
            {project.inventoryWarnings.map((note, i) => (
              <p key={i}>{note}</p>
            ))}
          </details>
        )}
        {(architectureVisited || architectureOpen) && (
          <div hidden={!architectureOpen}>
            <ArchitectureView
              implementationDrafts={implementationDrafts}
              onImplementationDrafts={setImplementationDrafts}
              recoverySaved={recovery.currentAcknowledged}
              refresh={architectureRefresh}
              checkedRunId={
                current?.status === "completed" ? current.id : undefined
              }
              onOpenSource={(file) => {
                void openFile(file);
                setArchitectureOpen(false);
              }}
            />
          </div>
        )}
        {!architectureOpen && (
          <>
            {(!!file || !project || project.files.length > 0) && (
              <nav className="tabs" aria-label="Analysis views">
                {analysisViews.map(([id, label]) => (
                  <button
                    key={id}
                    aria-pressed={tab === id}
                    className={tab === id ? "active" : ""}
                    aria-controls="analysis-content"
                    onClick={() => {
                      if (window.matchMedia("(max-width: 920px)").matches) {
                        if (tab === id) focusAnalysis();
                        else revealAnalysis.current = true;
                      }
                      setTab(id);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </nav>
            )}
            {file && (
              <div className="workspace-toolbar">
                <div className="current-file">
                  <span className="file-icon">p</span>
                  <strong>{basename(file) || "Open a specification"}</strong>
                  <span
                    className="file-save-state muted"
                    role={
                      !modalOpen && lastSave?.path === file
                        ? "status"
                        : undefined
                    }
                  >
                    <span aria-hidden="true">
                      {dirty
                        ? "Unsaved"
                        : lastSave?.path === file
                          ? "Saved"
                          : ""}
                    </span>
                    <span className="sr-only">
                      {dirty
                        ? lastSave?.path === file && lastSave.newer
                          ? `Saved ${basename(file)}; newer edits remain in your buffer.`
                          : `Unsaved changes in ${basename(file)}`
                        : lastSave?.path === file
                          ? `Saved ${basename(file)}`
                          : ""}
                    </span>
                  </span>
                  {frozen && (
                    <span className="badge snapshot">RUN SNAPSHOT</span>
                  )}
                </div>
                <div className="run-controls">
                  <select
                    aria-label="Behaviour entry point"
                    value={entry}
                    onChange={(e) => {
                      setEntry(e.target.value);
                      setSettings((old) => ({ ...old, scope: "{}" }));
                    }}
                  >
                    <option value="">Select entry</option>
                    {entries.map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name} · {s.kind}
                      </option>
                    ))}
                  </select>
                  {selectedEntry?.kind === "flow" && (
                    <button
                      className="button secondary"
                      aria-pressed={tryOpen}
                      onClick={() => setTryOpen((v) => !v)}
                    >
                      Try inputs
                    </button>
                  )}
                  <button
                    className="button secondary"
                    onClick={() => setSettingsOpen(true)}
                  >
                    Scenario
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => void save()}
                    disabled={!dirty || frozen}
                  >
                    Save
                  </button>
                  <button
                    className="button primary"
                    onClick={() => void runCheck()}
                    disabled={!file || !connected}
                  >
                    ✓ Check design
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => void runCheck("simulate")}
                    disabled={
                      !file ||
                      !entries.some((s) => s.name === entry) ||
                      !connected
                    }
                  >
                    ▷ Simulate
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => void runCheck("verify")}
                    disabled={
                      !file ||
                      !entries.some((s) => s.name === entry) ||
                      !connected
                    }
                    title="Exhaustive finite-state checking"
                  >
                    Verify
                  </button>
                  {active && (
                    <button
                      className="button stop"
                      onClick={() =>
                        void api("cancel", { id: active.id }).catch((e) =>
                          setError(String(e)),
                        )
                      }
                    >
                      ■ Cancel
                    </button>
                  )}
                </div>
              </div>
            )}
            {recovery.status === "error" && (
              <div className="message error-message" role="alert">
                {recovery.error}
                <button
                  onClick={() =>
                    void api("recovery")
                      .then((data) => {
                        const checked = readProject({
                          ...project,
                          recovery: data,
                        });
                        setRecoveryReview(checked.recovery);
                      })
                      .catch((e) => setError(String(e)))
                  }
                >
                  Review recovery and retry
                </button>
              </div>
            )}
            {current?.persistenceError && (
              <div className="message error-message" role="alert">
                {current.persistenceError}
              </div>
            )}
            {newDesign && !newFile && (
              <div className="message notice-message" role="status">
                Unfinished new design: {newDesign.path}.
                <button
                  onClick={() => {
                    openNewDesign();
                  }}
                >
                  Resume new design
                </button>
                <button onClick={() => setNewDesign(null)}>
                  Discard new design
                </button>
              </div>
            )}
            {interfaceDraft && !interfaceSession && (
              <div className="message notice-message" role="status">
                Unfinished interface: {interfaceDraft.edit.name} (
                {interfaceDraft.file}). Your form fields are saved locally.
                <button onClick={() => void resumeInterface()}>
                  Resume interface form
                </button>
                <button
                  onClick={() =>
                    (() => {
                      const url = URL.createObjectURL(
                        new Blob([JSON.stringify(interfaceDraft, null, 2)], {
                          type: "application/json",
                        }),
                      );
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "interface-draft.json";
                      a.click();
                      URL.revokeObjectURL(url);
                    })()
                  }
                >
                  Download form
                </button>
                <button onClick={() => setInterfaceDraft(null)}>
                  Discard form
                </button>
              </div>
            )}
            {declarationDraft && !declarationOpen && (
              <section
                className="message recovery-warning"
                aria-label="Unfinished new declaration"
              >
                <p>
                  Unfinished{" "}
                  {declarationDraft.resourceEdit
                    ? "lifecycle edit"
                    : declarationDraft.declaration.kind}{" "}
                  in {declarationDraft.file}. Your form is saved separately from
                  source.
                </p>
                <button
                  className="button secondary"
                  onClick={() => void openDeclaration()}
                >
                  Resume declaration form
                </button>
                <button
                  className="text-link"
                  onClick={() => setDeclarationDraft(null)}
                >
                  Discard declaration form
                </button>
              </section>
            )}
            {operationDraft && !operationSession && (
              <section
                className="message recovery-warning"
                aria-label="Unfinished operation contract"
              >
                <p>
                  Unfinished operation contract: {operationDraft.name} (
                  {operationDraft.file}). Your form is saved separately from
                  source.
                </p>
                <button
                  className="button secondary"
                  onClick={() => void openOperation()}
                >
                  Resume operation form
                </button>
                <button
                  onClick={() => {
                    const url = URL.createObjectURL(
                      new Blob([JSON.stringify(operationDraft, null, 2)], {
                        type: "application/json",
                      }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "operation-draft.json";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Download operation form
                </button>
                <button
                  className="text-link"
                  onClick={() => setOperationDraft(null)}
                >
                  Discard operation form
                </button>
              </section>
            )}
            {typeDraft && !typeSession && (
              <div className="message notice-message" role="status">
                Unfinished data shape: {typeDraft.name} ({typeDraft.file}). Your
                form fields are saved locally.
                <button onClick={() => void openType()}>
                  Resume data-shape form
                </button>
                <button
                  onClick={() => {
                    const url = URL.createObjectURL(
                      new Blob([JSON.stringify(typeDraft, null, 2)], {
                        type: "application/json",
                      }),
                    );
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = "data-shape-draft.json";
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Download data-shape draft
                </button>
                <button onClick={() => setTypeDraft(null)}>
                  Discard data-shape form
                </button>
              </div>
            )}
            {rangeDrafts.length > 0 && (
              <div
                className="message notice-message"
                role="region"
                aria-label="Unfinished range edits"
              >
                <strong>
                  {rangeDrafts.length} unfinished range edit
                  {rangeDrafts.length === 1 ? "" : "s"}
                </strong>
                {rangeDrafts.map((draft) => (
                  <div key={`${draft.file}/${draft.key}`}>
                    <span>
                      {draft.file} · {draft.label}: {draft.min || "(blank)"} to{" "}
                      {draft.max || "(blank)"}
                    </span>
                    <button
                      onClick={() => {
                        setEditorMode("blocks");
                        void openFile(draft.file);
                      }}
                    >
                      Open range for {draft.label}
                    </button>
                    <button
                      onClick={() =>
                        setRangeDrafts((old) =>
                          old.filter((item) => item !== draft),
                        )
                      }
                    >
                      Discard range for {draft.label}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {recoveryNotice && (
              <div className="message notice-message" role="status">
                {recoveryNotice}
                <button
                  aria-label="Dismiss recovery notice"
                  onClick={() => setRecoveryNotice("")}
                >
                  ×
                </button>
              </div>
            )}
            {staleBuffer && (
              <section
                className="message notice-message"
                role="status"
                aria-label="Source changed in another window"
              >
                <span>
                  {file} changed in another window. Your buffer was kept; reload
                  or compare before saving.
                </span>
                <button className="text-link" onClick={() => void reloadFile()}>
                  Compare saved version
                </button>
              </section>
            )}
            {(error || notice) && (
              <div
                className={`message ${error ? "error-message" : "notice-message"}`}
                role={error ? "alert" : "status"}
              >
                {error || notice}
                <button
                  aria-label="Dismiss message"
                  onClick={() => {
                    setError("");
                    setNotice("");
                  }}
                >
                  ×
                </button>
              </div>
            )}
            {!file && project && project.files.length === 0 ? (
              <section className="first-use">
                <span className="eyebrow">
                  WORK OUT THE DESIGN BEFORE THE CODE
                </span>
                <h1>Bring your design together</h1>
                <p>
                  Keep the whole architecture in one place, then check the parts
                  where a decision needs testing.
                </p>
                <div className="first-use-doors">
                  <article>
                    <h2>Plan your architecture</h2>
                    <p>
                      Bring existing documents, requirements and decisions
                      together. Link plans to contracts and keep track of
                      changes and open questions.
                    </p>
                    <button
                      className="button primary"
                      onClick={() => {
                        setArchitectureOpen(true);
                        setArchitectureVisited(true);
                      }}
                    >
                      Open architecture workspace
                    </button>
                  </article>
                  <article>
                    <h2>Try a small design</h2>
                    <p>
                      Describe inputs, a business decision or a retry. See
                      missing cases and repeated work with a guided example.
                    </p>
                    <button
                      className="button secondary"
                      onClick={openNewDesign}
                    >
                      Start with a recipe
                    </button>
                  </article>
                </div>
                <div className="first-use-steps">
                  <article>
                    <b>1. Choose a small question</b>
                    <p>For example: will these calls fit the budget?</p>
                  </article>
                  <article>
                    <b>2. Describe the inputs and steps</b>
                    <p>
                      Use a form or edit the design text. No service is run.
                    </p>
                  </article>
                  <article>
                    <b>3. Check, change, check again</b>
                    <p>
                      See the consequence of one decision while it is easy to
                      change.
                    </p>
                  </article>
                </div>
              </section>
            ) : (
              <div className="work-area">
                <section className="source-pane">
                  <div className="source-mode-bar">
                    <div
                      role="group"
                      aria-label="Editor mode"
                      className="source-mode-switch"
                    >
                      <button
                        aria-pressed={editorMode === "text"}
                        onClick={() => setEditorMode("text")}
                      >
                        Text
                      </button>
                      <button
                        aria-pressed={editorMode === "blocks"}
                        onClick={() => {
                          setEditorMode("blocks");
                          if (
                            current?.request.clientId !== clientId.current ||
                            !report?.snapshot.files.some(
                              (s) =>
                                s.file === absolute(file) && s.text === value,
                            )
                          )
                            void runCheck();
                        }}
                      >
                        Blocks
                      </button>
                      <button
                        className="text-link"
                        disabled={!dirty || frozen}
                        onClick={() => void reloadFile()}
                      >
                        Revert to saved…
                      </button>
                    </div>
                    <span>One design · two ways to edit</span>
                  </div>
                  {!frozen &&
                    project?.files.find((source) => source.path === file)
                      ?.exists === false && (
                      <div className="message" role="status">
                        This file was deleted on disk. Your editor copy is
                        preserved.
                        <button
                          className="text-link"
                          onClick={() => rememberDeletedFile(file)}
                        >
                          Review save options
                        </button>
                      </div>
                    )}
                  <div
                    className="text-editor-container"
                    hidden={editorMode !== "text"}
                  >
                    <Editor
                      key={`${absolute(file)}:${frozen ? current?.id : "buffer"}`}
                      initialCursor={cursor}
                      insertion={blockInsertion}
                      onInsertionHandled={(serial) =>
                        setBlockInsertion((old) =>
                          old?.serial === serial ? null : old,
                        )
                      }
                      documentId={`${absolute(file)}:${frozen ? current?.id : "buffer"}`}
                      value={value}
                      readonly={frozen}
                      range={range}
                      checkedText={
                        report?.snapshot.files.find(
                          (source) => source.file === absolute(file),
                        )?.text
                      }
                      completions={completions}
                      onChange={edit}
                      onCheck={() => void runCheck()}
                      onSave={() => void save()}
                      onNavigate={navigate}
                      onCursor={setCursor}
                      hover={(offset) => symbolAt(offset)?.signature ?? null}
                      onActions={(actions) => {
                        editorActions.current = actions;
                      }}
                    />
                  </div>
                  {editorMode === "text" && (
                    <div className="pane-heading">
                      <span>SPECIFICATION</span>
                      <div className="navigation-actions">
                        <details className="block-menu">
                          <summary>Add a block</summary>
                          <div>
                            {blocks.map((block) => (
                              <button
                                key={block.name}
                                className="block-option"
                                disabled={frozen}
                                onClick={(e) => {
                                  setBlockInsertion((previous) => ({
                                    serial: (previous?.serial ?? 0) + 1,
                                    template: block.template,
                                    documentId: `${absolute(file)}:${frozen ? current?.id : "buffer"}`,
                                  }));
                                  e.currentTarget
                                    .closest("details")
                                    ?.removeAttribute("open");
                                }}
                              >
                                <strong>{block.title}</strong>
                                <span>{block.detail}</span>
                              </button>
                            ))}
                          </div>
                        </details>

                        <button
                          className="text-link"
                          disabled={frozen}
                          onClick={() => void formatBuffer()}
                        >
                          Format
                        </button>
                        <button
                          className="text-link"
                          onClick={() => navigate(cursor, false)}
                        >
                          Definition
                        </button>
                        <button
                          className="text-link"
                          onClick={() => navigate(cursor, true)}
                        >
                          References
                        </button>
                        <button
                          className="text-link"
                          onClick={() => void reloadFile()}
                        >
                          Reload disk
                        </button>
                      </div>
                      <div>
                        {frozen ? (
                          <button
                            className="text-link"
                            onClick={() => {
                              setFrozen(false);
                              setRange(null);
                            }}
                          >
                            Back to editing ↩
                          </button>
                        ) : (
                          <label className="auto-label">
                            <input
                              type="checkbox"
                              checked={auto}
                              onChange={(e) => setAuto(e.target.checked)}
                            />{" "}
                            Check as I edit
                          </label>
                        )}
                      </div>
                    </div>
                  )}
                  {editorMode === "text" && (
                    <InterfaceHint
                      symbol={authoringSymbol()}
                      {...(!frozen && !pendingInterface
                        ? { onEdit: () => void openInterface() }
                        : {})}
                      current={
                        !!report?.snapshot.files.some(
                          (s) => s.file === absolute(file) && s.text === value,
                        )
                      }
                    />
                  )}
                  {editorMode === "blocks" && (
                    <BlockEditor
                      key={`${absolute(file)}:${frozen ? current?.id : "buffer"}`}
                      file={file}
                      runId={
                        current?.status === "completed" &&
                        current.request.clientId === clientId.current
                          ? current.id
                          : undefined
                      }
                      value={value}
                      readonly={frozen}
                      rangeDrafts={rangeDrafts}
                      onRangeDrafts={setRangeDrafts}
                      range={range}
                      onChange={edit}
                      onCheck={() => void runCheck()}
                      onText={(start) => {
                        setEditorMode("text");
                        if (start !== undefined)
                          setRange({ start, end: start });
                      }}
                      onInterface={(symbolId) => void openInterface(symbolId)}
                      onType={(symbolId) => void openType(symbolId)}
                      onResource={(symbolId) => void openResource(symbolId)}
                      onOperation={(symbolId) => void openOperation(symbolId)}
                      onCreate={() => void openDeclaration()}
                      appliedFocus={
                        !modalOpen ? (appliedFocus ?? undefined) : undefined
                      }
                      onAppliedFocus={() => setAppliedFocus(null)}
                      onUndo={() => {
                        editorActions.current?.undo();
                        void runCheck();
                      }}
                      onRedo={() => {
                        editorActions.current?.redo();
                        void runCheck();
                      }}
                    />
                  )}
                  {frozen && snapshot && !snapshot.text && (
                    <div className="source-empty">
                      This shared report contains no source text.
                    </div>
                  )}
                  <div className="editor-footer">
                    <span>
                      {frozen ? "Frozen source · read only" : "Pymtheg design"}
                    </span>
                    <span>
                      {value.split("\n").length} lines ·{" "}
                      {value.length.toLocaleString()} characters
                    </span>
                  </div>
                </section>
                <section className="analysis-pane">
                  <div className="analysis-heading">
                    <div>
                      <span className="eyebrow">DESIGN ANALYSIS</span>
                      <h1>
                        {active
                          ? "Checking your design"
                          : report
                            ? "See what your design implies"
                            : "A clearer design starts here"}
                      </h1>
                      <p>
                        {active
                          ? `Current phase: ${active.phase}`
                          : report
                            ? "Follow each finding back to its source and evidence."
                            : "Open a source file and run your first check."}
                      </p>
                    </div>
                    <span
                      className={`run-state ${current?.status === "running" ? "working" : report && reportStatus(report) !== "Requested checks finished" ? "needs-review" : ""}`}
                    >
                      {current?.status === "running"
                        ? "Running"
                        : report
                          ? reportStatus(report)
                          : (current?.status ?? "Ready")}
                    </span>
                  </div>
                  {current?.error && (
                    <div className="message error-message" role="alert">
                      Run failed: {current.error}
                    </div>
                  )}
                  {report && (
                    <>
                      <div className="summary-strip">
                        <button
                          onClick={() => {
                            setTab("findings");
                            setFilter("error");
                          }}
                        >
                          <strong className={issues ? "issue-number" : ""}>
                            {issues}
                          </strong>
                          <span>Design issues</span>
                        </button>
                        <button
                          onClick={() => {
                            setTab("evidence");
                          }}
                        >
                          <strong className={pending ? "pending-number" : ""}>
                            {pending}
                          </strong>
                          <span>Pending checks</span>
                        </button>
                        <button
                          onClick={() => {
                            setTab("costs");
                          }}
                        >
                          <strong>{costs.length}</strong>
                          <span>Work estimates</span>
                        </button>
                      </div>
                      {(historical || report.session.staleFiles.length > 0) && (
                        <div className="snapshot-banner">
                          ◷{" "}
                          {current?.request.clientId === "imported"
                            ? "Imported report. Its recorded evidence has not been rerun in this session."
                            : historical
                              ? "This result is from an earlier buffer revision."
                              : "Files changed on disk during this run."}{" "}
                          <button onClick={() => void runCheck()}>
                            Check current source
                          </button>
                        </div>
                      )}
                    </>
                  )}
                  {recipeDraft?.path === file && !frozen && (
                    <RecipeCoach
                      draft={recipeDraft}
                      report={report}
                      current={
                        !!report?.snapshot.files.some(
                          (s) => s.file === absolute(file) && s.text === value,
                        )
                      }
                      editable={value === recipeDraft.source}
                      onView={(view) => {
                        if (view === "try") setTryOpen(true);
                        else if (view === "scaffold") {
                          setTab("code");
                          void exportScaffold(true);
                        } else setTab(view);
                      }}
                      onSimulate={() => void runCheck("simulate")}
                      onUpdate={async (options, source) => {
                        const prepared = await api("format", {
                          file,
                          text: source,
                        });
                        if (
                          !object(prepared) ||
                          typeof prepared.text !== "string"
                        )
                          throw Error("Could not prepare the recipe source.");
                        source = prepared.text;
                        edit(source);
                        setRecipeDraft({ ...recipeDraft, options, source });
                        void runCheck();
                      }}
                    />
                  )}
                  {tryOpen && selectedEntry?.kind === "flow" && current && (
                    <TryInputs
                      entry={selectedEntry}
                      runId={current.id}
                      current={
                        !!report?.snapshot.files.some(
                          (s) => s.file === absolute(file) && s.text === value,
                        )
                      }
                    />
                  )}

                  <div
                    className="analysis-content"
                    id="analysis-content"
                    ref={analysisContent}
                    tabIndex={-1}
                    role="region"
                    aria-label={`${analysisViews.find(([id]) => id === tab)?.[1] ?? tab} analysis`}
                  >
                    {tab === "findings" && (
                      <>
                        {report?.consumers &&
                          report.consumers.diagnostics.length > 0 && (
                            <details className="consumer-findings">
                              <summary>
                                Related-file findings:{" "}
                                {report.consumers.diagnostics.length}{" "}
                                {report.consumers.diagnostics.length === 1
                                  ? "finding"
                                  : "findings"}
                              </summary>
                              <p>
                                These files import the selected design. This
                                list includes confirmed dependencies and
                                unresolved references. Their findings are
                                separate from this file’s check result.
                              </p>
                              {!!report.consumers.incompleteFiles?.length && (
                                <p>
                                  Caller checks are incomplete for{" "}
                                  {report.consumers.incompleteFiles
                                    .map((file) => basename(file))
                                    .join(", ")}
                                  . Repair these source files to discover their
                                  callers and obligations.
                                </p>
                              )}
                              {report.consumers.diagnostics
                                .slice(0, 200)
                                .map(
                                  (d, i) =>
                                    explain && (
                                      <FindingCard
                                        key={`consumer-${i}`}
                                        finding={explain(d)}
                                        onJump={jump}
                                      />
                                    ),
                                )}
                              {report.consumers.diagnostics.length > 200 && (
                                <p>
                                  Showing the first 200 caller findings. Open
                                  the affected files to check them directly.
                                </p>
                              )}
                            </details>
                          )}
                        <div className="filter-bar">
                          <div className="segments">
                            {["all", "error", "warning", "info"].map((x) => (
                              <button
                                key={x}
                                className={filter === x ? "active" : ""}
                                onClick={() => setFilter(x)}
                              >
                                {x === "all"
                                  ? "All"
                                  : x === "error"
                                    ? "Issues"
                                    : x === "warning"
                                      ? "Review"
                                      : "Info"}
                              </button>
                            ))}
                          </div>
                          <input
                            className="search"
                            aria-label="Search findings"
                            placeholder="Search findings…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                        </div>
                        {findings
                          .slice(0, 200)
                          .map(
                            (d, i) =>
                              explain && (
                                <FindingCard
                                  key={`${d.code}-${d.span.start}-${i}`}
                                  finding={explain(d)}
                                  onJump={jump}
                                />
                              ),
                          )}
                        {findings.length > 200 && (
                          <p className="muted">
                            Showing 200 of {findings.length} findings. Narrow
                            the search to inspect more.
                          </p>
                        )}
                        {!findings.length && (
                          <div className="empty-state">
                            <span className="empty-symbol">◇</span>
                            <h2>
                              {report
                                ? "No findings in this view"
                                : "Describe, check, refine"}
                            </h2>
                            <p>
                              {report
                                ? "Review the evidence and pending checks to understand what was established."
                                : "Run a check to explore your design’s types, effects, lifecycles and work."}
                            </p>
                            {!report && (
                              <button
                                className="button primary"
                                onClick={() => void runCheck()}
                                disabled={!file}
                              >
                                Check this specification
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    {tab === "costs" && (
                      <>
                        <div className="view-intro">
                          <h2>Understand the work</h2>
                          {costs.length > 200 && (
                            <p>
                              Showing the first 200 work results. Export the
                              full report for every property.
                            </p>
                          )}
                          <p>
                            Structural counters under declared assumptions.
                            These are not elapsed-time predictions.
                          </p>
                          <select
                            aria-label="Compare work with run"
                            value={baseline}
                            onChange={(e) => setBaseline(e.target.value)}
                          >
                            <option value="">
                              Choose a previous run to compare
                            </option>
                            {runs
                              .filter((r) => r.id !== current?.id && r.report)
                              .map((r) => (
                                <option key={r.id} value={r.id}>
                                  {basename(r.request.file)} · revision{" "}
                                  {r.request.revision}
                                </option>
                              ))}
                          </select>
                        </div>
                        {costs.slice(0, 200).map((r) => {
                          const w = object(r.witnessOrDerivation)
                              ? r.witnessOrDerivation
                              : {},
                            old = oldCosts.get(r.propertyId),
                            prior =
                              old && object(old.witnessOrDerivation)
                                ? old.witnessOrDerivation
                                : null;
                          return (
                            <article className="cost-card" key={r.propertyId}>
                              <div>
                                <span className="badge">
                                  {String(w.classification ?? "unknown")}
                                </span>
                                <small>
                                  {short(r.propertyId).split("/cost/")[0]}
                                </small>
                              </div>
                              <div className="formula">
                                {String(w.expression ?? "?")}
                              </div>
                              <strong>{String(w.metric ?? "work")}</strong>
                              <p>
                                {w.maximum !== null
                                  ? `At most ${String(w.maximum)} under the declared bounds.`
                                  : "A bound cannot yet be evaluated."}
                              </p>
                              {prior && (
                                <p className="comparison">
                                  Previous: {String(prior.expression)} ·{" "}
                                  {String(prior.maximum ?? "unknown")}
                                  <br />
                                  <small>
                                    {old && compareCost(r, old).comparable
                                      ? "Input bounds and cost assumptions match."
                                      : old
                                        ? `Not directly comparable: ${compareCost(r, old).reasons.join("; ")}`
                                        : ""}
                                  </small>
                                </p>
                              )}
                              <details>
                                <summary>Derivation & assumptions</summary>
                                <p>
                                  {Array.isArray(w.contributors)
                                    ? w.contributors.join(" → ")
                                    : ""}
                                </p>
                                <ul>
                                  {r.assumptions.map((a) => (
                                    <li key={a}>{a}</li>
                                  ))}
                                </ul>
                                <pre>
                                  {JSON.stringify(w.bounds ?? {}, null, 2)}
                                </pre>
                              </details>
                            </article>
                          );
                        })}
                        {!costs.length && (
                          <div className="empty-state">
                            <h2>No work metric in this run</h2>
                            <p>
                              Give abstract operations a cost such as{" "}
                              <code>cost remote_calls exact 1</code> to see how
                              calls compose.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                    {tab === "trace" && (
                      <>
                        <div className="view-intro">
                          <h2>Walk the counterexample</h2>
                          <p>
                            Inspect what happened, what changed, and where it
                            happened in the source.
                          </p>
                        </div>
                        {behaviour.length > 0 && (
                          <select
                            aria-label="Trace property"
                            value={traceResult?.propertyId ?? ""}
                            onChange={(e) => {
                              setSelectedResult(e.target.value);
                              setTraceIndex(0);
                            }}
                          >
                            {behaviour.map((r) => (
                              <option value={r.propertyId} key={r.propertyId}>
                                {short(r.propertyId)} · {r.outcome}
                              </option>
                            ))}
                          </select>
                        )}
                        {traceResult && states.length > 0 && (
                          <section className="trace-summary">
                            <div>
                              <strong>{outcomeLabel(traceResult)}</strong>
                              <p>
                                {typeof lastValues?.violation === "string"
                                  ? lastValues.violation
                                  : (traceResult.diagnostics[0]?.message ??
                                    "Inspect the state changes and original source below.")}
                              </p>
                              <small>
                                {traceResult.method === "simulation"
                                  ? "Found by sampling within the recorded limits."
                                  : "Found in the selected finite model."}{" "}
                                Witness:{" "}
                                {traceResult.witnessValidation.replaceAll(
                                  "_",
                                  " ",
                                )}
                                .
                              </small>
                            </div>
                            <button
                              className="button secondary"
                              onClick={() => traceStep(states.length - 1)}
                            >
                              Show where it fails
                            </button>
                          </section>
                        )}
                        {states.length > 0 ? (
                          <>
                            <div className="trace-controls">
                              <button
                                className="button secondary"
                                disabled={index === 0}
                                onClick={() => traceStep(index - 1)}
                              >
                                ← Previous
                              </button>
                              <strong>
                                Step {index} of {states.length - 1}
                              </strong>
                              <button
                                className="button primary"
                                disabled={index === states.length - 1}
                                onClick={() => traceStep(index + 1)}
                              >
                                Next →
                              </button>
                            </div>
                            <div className="trace-timeline">
                              {states.map((_, i) => (
                                <button
                                  key={i}
                                  aria-label={`Go to trace step ${i}`}
                                  aria-current={
                                    index === i ? "step" : undefined
                                  }
                                  className={i === index ? "selected" : ""}
                                  onClick={() => traceStep(i)}
                                >
                                  {i}
                                </button>
                              ))}
                            </div>
                            <div className="trace-event">
                              <span className="eyebrow">
                                {index === 0 ? "INITIAL STATE" : "SOURCE EVENT"}
                              </span>
                              <h3>
                                {index === 0
                                  ? "Before execution"
                                  : String(
                                      traceEvents[
                                        states
                                          .slice(1, index + 1)
                                          .filter((s) => s.event !== -1)
                                          .length - 1
                                      ]?.operation ?? "Stutter",
                                    )}
                              </h3>
                              <span className="badge">
                                {traceResult?.witnessValidation}
                              </span>
                            </div>
                            <table className="data-table">
                              <thead>
                                <tr>
                                  <th>State</th>
                                  <th>Previous</th>
                                  <th>Current</th>
                                </tr>
                              </thead>
                              <tbody>
                                {object(state?.values) &&
                                  Object.entries(state.values).map(
                                    ([key, val]) => {
                                      const old = object(previous?.values)
                                        ? previous.values[key]
                                        : undefined;
                                      return (
                                        <tr
                                          key={key}
                                          className={
                                            old !== undefined && old !== val
                                              ? "changed"
                                              : ""
                                          }
                                        >
                                          <th>{key}</th>
                                          <td>
                                            {old === undefined
                                              ? "—"
                                              : String(old)}
                                          </td>
                                          <td>{String(val)}</td>
                                        </tr>
                                      );
                                    },
                                  )}
                              </tbody>
                            </table>
                          </>
                        ) : (
                          <div className="empty-state">
                            <span className="empty-symbol">↝</span>
                            <h2>No counterexample selected</h2>
                            <p>
                              Select a machine or supported flow and run
                              Simulate or Verify. A no-counterexample result
                              describes its explored scope, not all possible
                              programs.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                    {tab === "structure" && (
                      <Structure
                        symbols={symbols}
                        report={report}
                        onJump={jump}
                      />
                    )}
                    {tab === "evidence" && (
                      <EvidenceView
                        projectRoot={project?.root ?? ""}
                        report={report}
                        symbols={symbols}
                        onJump={jump}
                      />
                    )}
                    {tab === "compare" && (
                      <CompareView
                        current={current}
                        runs={runs}
                        baseline={baseline}
                        onBaseline={setBaseline}
                        onInspect={(run, span) => {
                          setSelectedRun(run.id);
                          setFile(relative(span.file));
                          setFrozen(true);
                          setRange({ start: span.start, end: span.end });
                          setTab("findings");
                        }}
                      />
                    )}
                    {tab === "code" && (
                      <section className="scaffold-export">
                        <h3>
                          {scaffoldMode === "contracts"
                            ? "Keep implementation aligned with the design"
                            : "Start implementation from this design"}
                        </h3>
                        <p>
                          {scaffoldMode === "contracts"
                            ? "Download data types and an interface to implement in a separate file. Compare a saved baseline to see which contracts changed."
                            : "Download types and signatures. Every default stub stops with “Not implemented” when called. This does not generate working business logic."}
                        </p>
                        <label>
                          Output language
                          <select
                            aria-label="Scaffold language"
                            value={scaffoldTarget}
                            onChange={(e) => setScaffoldTarget(e.target.value)}
                          >
                            {(
                              project?.outputTargets ??
                              outputTargetIds.map((id) => ({
                                id,
                                label: outputTargets[id].label,
                                builtin: true,
                              }))
                            ).map(({ id, label }) => (
                              <option key={id} value={id}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Output purpose
                          <select
                            aria-label="Output purpose"
                            value={scaffoldMode}
                            onChange={(event) => {
                              setScaffoldMode(event.target.value as OutputMode);
                              setScaffoldDrift(null);
                            }}
                          >
                            <option value="stubs">Start with stubs</option>
                            <option value="contracts">
                              Maintain separate contracts
                            </option>
                          </select>
                        </label>
                        {scaffoldMode === "contracts" && (
                          <div>
                            <p>
                              Keep this generated file separate from handwritten
                              code. Implement PymthegContracts in your own file;
                              regenerate the contracts after design changes.
                            </p>
                            {scaffoldTarget === "typescript" ? (
                              <p>
                                To catch added inputs as well as changed types,
                                add{" "}
                                <code>
                                  export type ContractCheck =
                                  PymthegImplementation&lt;YourImplementation&gt;;
                                </code>{" "}
                                in your implementation file and import that
                                type. A bare <code>implements</code> clause does
                                not check exact input lists.
                              </p>
                            ) : scaffoldTarget === "go" ? (
                              <p>
                                Add{" "}
                                <code>
                                  var _ PymthegContracts =
                                  (*YourImplementation)(nil)
                                </code>{" "}
                                in your implementation file so Go checks the
                                interface.
                              </p>
                            ) : scaffoldTarget === "rust" ? (
                              <p>
                                Implement the generated trait; Rust checks its
                                method signatures.
                              </p>
                            ) : (
                              <p>
                                Follow this output plugin’s contract integration
                                instructions.
                              </p>
                            )}
                            <p>
                              These checks cover declared interfaces, not
                              business behaviour.
                            </p>
                            {current &&
                              (scaffoldTarget === "typescript" ||
                                scaffoldTarget === "rust" ||
                                scaffoldTarget === "go") && (
                                <ImplementationCheck
                                  key={scaffoldTarget}
                                  runId={current.id}
                                  target={scaffoldTarget}
                                />
                              )}
                          </div>
                        )}
                        {scaffoldMode === "stubs" && (
                          <label>
                            Function bodies
                            <select
                              aria-label="Scaffold function bodies"
                              value={scaffoldBody}
                              onChange={(e) =>
                                setScaffoldBody(
                                  e.target.value as ScaffoldBodyMode,
                                )
                              }
                            >
                              <option value="fail-fast">
                                Fail fast: Not implemented (compiles)
                              </option>
                              <option value="empty">
                                Empty bodies (may not compile)
                              </option>
                            </select>
                          </label>
                        )}
                        <button
                          className="button secondary"
                          disabled={!report}
                          onClick={() => void exportScaffold(true)}
                        >
                          Preview types and signatures
                        </button>
                        <button
                          className="button secondary"
                          disabled={!report}
                          onClick={() => void exportScaffold()}
                        >
                          {scaffoldMode === "contracts"
                            ? "Download contracts"
                            : "Download scaffold"}
                        </button>
                        <button
                          className="button secondary"
                          disabled={!report}
                          onClick={() => void exportScaffold(false, true)}
                        >
                          Save contract comparison baseline
                        </button>
                        <label>
                          Compare with a saved contract baseline
                          <input
                            type="file"
                            accept=".json"
                            disabled={!report}
                            onChange={(event) => void compareScaffold(event)}
                          />
                        </label>
                        {scaffoldDrift && (
                          <section aria-label="Contract changes">
                            {!!report?.diagnostics.some(
                              (d) => d.severity === "error",
                            ) && (
                              <p role="alert">
                                The current design has errors. Matching
                                signatures do not establish a valid design.
                                Resolve the findings before relying on these
                                contracts.
                              </p>
                            )}
                            <h4>
                              {scaffoldDrift.matches
                                ? "Declared contracts match"
                                : "Declared contracts changed"}
                            </h4>
                            {scaffoldDrift.added.map((id) => (
                              <p key={id}>Added: {id}</p>
                            ))}
                            {scaffoldDrift.removed.map((id) => (
                              <p key={id}>Removed: {id}</p>
                            ))}
                            {scaffoldDrift.changed.map((item) => (
                              <details key={item.id}>
                                <summary>Changed: {item.id}</summary>
                                {item.details.map((detail, i) => (
                                  <p key={i}>{detail}</p>
                                ))}
                                <details>
                                  <summary>Inspect exact contract data</summary>
                                  <h5>Previous contract</h5>
                                  <pre>
                                    {JSON.stringify(
                                      JSON.parse(item.before),
                                      null,
                                      2,
                                    )}
                                  </pre>
                                  <h5>Current contract</h5>
                                  <pre>
                                    {JSON.stringify(
                                      JSON.parse(item.after),
                                      null,
                                      2,
                                    )}
                                  </pre>
                                </details>
                              </details>
                            ))}
                            {scaffoldDrift.incomplete.map((item) => (
                              <p key={item.name}>
                                Unresolved: {item.name} — {item.reason}
                              </p>
                            ))}
                            <p>
                              Signature comparison does not verify
                              implementation behaviour.
                            </p>
                          </section>
                        )}
                        <p className="muted">
                          Uses the selected run’s checked contracts. Older
                          restored runs may need a fresh check. Other languages
                          are available when the workspace is launched with a
                          trusted output plugin.
                        </p>
                        {scaffoldPreview?.runId === current?.id &&
                          scaffoldPreview?.target === scaffoldTarget &&
                          scaffoldPreview?.body === scaffoldBody &&
                          scaffoldPreview?.mode === scaffoldMode && (
                            <div className="scaffold-preview">
                              <p>
                                {scaffoldPreview.omitted} declarations omitted.
                                Bodies are unfinished; no business logic is
                                generated.
                              </p>
                              <pre>{scaffoldPreview.source}</pre>
                            </div>
                          )}
                      </section>
                    )}
                    {tab === "history" && (
                      <>
                        <div className="view-intro">
                          <h2>Explore previous runs</h2>
                          <p>
                            Snapshots stay attached to their own evidence.
                            Selecting an old run never changes your current
                            buffers.
                          </p>
                        </div>
                        {runs.map((r) => (
                          <button
                            className={`history-card ${r.id === current?.id ? "selected" : ""}`}
                            key={r.id}
                            onClick={() => {
                              setSelectedRun(r.id);
                              setFile(r.request.file);
                              setFrozen(true);
                              setRange(null);
                            }}
                          >
                            <span className="history-icon">◷</span>
                            <span>
                              <strong>{basename(r.request.file)}</strong>
                              <small>
                                {r.request.kind} · revision {r.request.revision}{" "}
                                ·{" "}
                                {r.report?.snapshot.id.slice(0, 8) ??
                                  "building snapshot"}
                              </small>
                            </span>
                            <span className="badge">{r.status}</span>
                          </button>
                        ))}
                        <div className="export-box">
                          <h3>Share an evidence report</h3>
                          <p>
                            Reports include findings, file paths, assumptions
                            and trace values. Source text is optional.
                          </p>
                          <label>
                            <input
                              type="checkbox"
                              checked={includeSource}
                              onChange={(e) =>
                                setIncludeSource(e.target.checked)
                              }
                            />{" "}
                            Include source text
                          </label>
                          <button
                            className="button secondary"
                            disabled={!report}
                            onClick={exportReport}
                          >
                            ↓ Export report
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </section>
              </div>
            )}
            <footer
              className="statusbar"
              data-run-id={current?.id ?? ""}
              data-recovery-revision={recovery.acknowledgedRevision ?? ""}
              data-recovery-current={recovery.currentAcknowledged}
            >
              <span>
                <i className={active ? "status-busy" : "status-ready"} />
                {active
                  ? `Running ${active.request.kind} · ${active.phase}`
                  : current
                    ? `${current.status} · ${current.request.kind}`
                    : "Ready"}
              </span>
              <span>
                {report
                  ? `Snapshot ${report.snapshot.id.slice(0, 12)}`
                  : "No run yet"}{" "}
                · Buffer revision {revision}
                <span className="status-separator">|</span>
                <span aria-live="polite">
                  {recovery.status === "saved"
                    ? hasUnsavedWork
                      ? "Draft saved locally"
                      : "No unsaved draft"
                    : recovery.status === "saving"
                      ? hasUnsavedWork
                        ? "Saving local draft…"
                        : "Saving workspace state…"
                      : recovery.status === "error"
                        ? "Recovery unavailable"
                        : "Loading recovery"}
                </span>
              </span>
            </footer>
          </>
        )}
      </main>
      {connectHelp && (
        <div className="modal-backdrop">
          <section
            className="modal agent-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-title"
          >
            <span className="eyebrow">USE YOUR CODING AGENT</span>
            <h2 id="agent-title">Let your agent check the design</h2>
            <p>
              Add this server to your agent’s MCP configuration. Your agent can
              check specifications, read findings and counterexamples, and
              generate typed scaffolds with fail-fast stubs.
            </p>
            <pre className="connection-config">
              {JSON.stringify(
                { mcpServers: { pymtheg: project?.agentConnection } },
                null,
                2,
              )}
            </pre>
            <p>
              The connection is local and limited to this project. Pymtheg does
              not write source files or generate business logic. Configuration
              formats vary by client; nothing is installed automatically.
            </p>
            <p role="status">{connectionNotice}</p>
            <div className="modal-actions">
              <button
                className="button secondary"
                onClick={() => setConnectHelp(false)}
              >
                Close
              </button>
              <button
                className="button primary"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(
                      JSON.stringify(
                        { mcpServers: { pymtheg: project?.agentConnection } },
                        null,
                        2,
                      ),
                    )
                    .then(() =>
                      setConnectionNotice(
                        "Configuration copied. Paste it into your agent’s MCP settings.",
                      ),
                    )
                    .catch(() =>
                      setConnectionNotice(
                        "Copy was unavailable. Select and copy the configuration above.",
                      ),
                    )
                }
              >
                Copy configuration
              </button>
            </div>
          </section>
        </div>
      )}
      {referenceSymbol && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="references-title"
          >
            <h2 id="references-title">References to {referenceSymbol.name}</h2>
            <p>{referenceSymbol.signature}</p>
            {(referenceSymbol.references ?? []).slice(0, 200).map((span, i) => (
              <button
                key={i}
                className="reference-row"
                onClick={() => {
                  jump(span);
                  setReferenceSymbol(null);
                }}
              >
                {sourceLocation(span)} <span>Go to source ↗</span>
              </button>
            ))}
            {!referenceSymbol.references?.length && (
              <p>No resolved call references in this snapshot.</p>
            )}
            <button
              className="button secondary"
              onClick={() => setReferenceSymbol(null)}
            >
              Close references
            </button>
          </section>
        </div>
      )}
      {recoveryReview && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recovery-title"
          >
            <h2 id="recovery-title">Review the saved recovery draft</h2>
            <p>
              Your current editor buffers are unchanged. Another window may have
              saved the versions below. Download them before replacing recovery
              if you need both. Original source files will not change.
            </p>
            {recoveryReview.drafts.length === 0 ? (
              <p>No unsaved files in the saved recovery record.</p>
            ) : (
              recoveryReview.drafts.map((d) => (
                <details key={d.path}>
                  <summary>{d.path}</summary>
                  <h3>Saved recovery</h3>
                  <pre className="disk-preview">{d.text}</pre>
                  <h3>This window</h3>
                  <pre className="disk-preview">
                    {buffers[d.path] ?? "No buffer open for this file."}
                  </pre>
                </details>
              ))
            )}
            <div className="modal-actions">
              <button
                className="button secondary"
                onClick={() => setRecoveryReview(null)}
              >
                Keep both unchanged
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(recoveryReview, null, 2)], {
                      type: "application/json",
                    }),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = "pymtheg-recovery.json";
                  link.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download saved recovery
              </button>
              <button
                className="button primary"
                onClick={() => {
                  recovery.resume(recoveryReview.revision);
                  setRecoveryReview(null);
                }}
              >
                Use this window for recovery
              </button>
            </div>
          </section>
        </div>
      )}
      {diskConflict && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="disk-title"
          >
            <h2 id="disk-title">
              {diskConflict.exists === false
                ? "This file was deleted on disk"
                : diskConflict.hash ===
                    bufferBases.current.expected(diskConflict.path, null)
                  ? "Discard unsaved changes?"
                  : "This file changed on disk"}
            </h2>
            <p>
              <code>{diskConflict.path}</code>
            </p>
            <p>
              {diskConflict.exists === false
                ? "Your editor copy is preserved. Save it separately, or recreate the original path if it is still free."
                : "Your editor buffer and the saved file are both preserved. Compare them before choosing which version to continue editing."}
            </p>
            {rangeDrafts.length > 0 && (
              <p>
                {rangeDrafts.length} unfinished range edit
                {rangeDrafts.length === 1 ? "" : "s"} will be kept. Reverting
                the source does not discard these form drafts.
              </p>
            )}
            {diskConflict.exists !== false && (
              <details>
                <summary>Compare disk version</summary>
                <pre className="disk-preview">{diskConflict.text}</pre>
              </details>
            )}
            <details>
              <summary>Compare unsaved editor version</summary>
              <pre className="disk-preview">
                {buffers[diskConflict.path] ?? ""}
              </pre>
            </details>
            <label>
              Save my buffer as a new file
              <input
                className="text-input"
                aria-label="Save copy path"
                placeholder={sourceFileName("my-design-copy")}
                value={copyPath}
                onChange={(e) => setCopyPath(e.target.value)}
              />
            </label>
            <button
              className="button secondary"
              disabled={!copyPath.trim()}
              onClick={() =>
                void api("save", {
                  path: sourceFileName(copyPath),
                  text: buffersRef.current[diskConflict.path] ?? "",
                  expectedHash: null,
                })
                  .then(() => {
                    setError("");
                    setNotice(
                      "Saved a separate copy; the external file is unchanged.",
                    );
                    setDiskConflict(null);
                    setCopyPath("");
                  })
                  .catch((e) => setError(String(e)))
              }
            >
              Save separate copy
            </button>
            <div className="modal-actions">
              <button
                className="button secondary"
                onClick={() => setDiskConflict(null)}
              >
                Keep my buffer
              </button>
              {diskConflict.exists === false ? (
                <button
                  className="button primary"
                  onClick={() =>
                    void api("save", {
                      path: diskConflict.path,
                      text: buffersRef.current[diskConflict.path] ?? "",
                      expectedHash: null,
                    })
                      .then((raw) => {
                        const saved = readSourceFile(raw);
                        bufferBases.current.loaded(saved.path, saved.hash);
                        acknowledgeSave(saved, saved.hash);
                        setError("");
                        setNotice("Recreated " + basename(diskConflict.path));
                        setDiskConflict(null);
                      })
                      .catch((error) => setError(String(error)))
                  }
                >
                  Save to this path again
                </button>
              ) : (
                <button
                  className="button primary"
                  onClick={() => {
                    bufferBases.current.loaded(
                      diskConflict.path,
                      diskConflict.hash,
                    );
                    setProject((p) =>
                      p
                        ? {
                            ...p,
                            files: p.files.map((f) =>
                              f.path === diskConflict.path ? diskConflict : f,
                            ),
                          }
                        : p,
                    );
                    edit(diskConflict.text);
                    setAppliedFocus({
                      file: diskConflict.path,
                      text: diskConflict.text,
                    });
                    setDiskConflict(null);
                    void runCheck("check", diskConflict.path);
                  }}
                >
                  {diskConflict.hash ===
                  bufferBases.current.expected(diskConflict.path, null)
                    ? "Discard edits and use saved version"
                    : "Use disk version"}
                </button>
              )}
            </div>
          </section>
        </div>
      )}
      {settingsOpen && (
        <div className="modal-backdrop">
          <form
            className="modal scenario-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="scenario-title"
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const problems = scopeProblems(
                  selectedEntry,
                  scenarioOperations,
                  settings.scope,
                );
                if (problems.length) throw Error(problems.join(" "));
                scenario({
                  file,
                  entry: entry || "local",
                  ...settings,
                  scope: JSON.parse(settings.scope) as unknown,
                });
                setSettingsError("");
                setSettingsOpen(false);
              } catch (error) {
                setSettingsError(String(error));
              }
            }}
          >
            <span className="eyebrow">REPRODUCIBLE EXPLORATION</span>
            <h2 id="scenario-title">Choose what to explore</h2>
            <p>
              Every result records its scope, assumptions and engine. Local
              checks do not need a scenario.
            </p>
            {Object.keys(project?.config.scenarios ?? {}).length > 0 && (
              <label>
                Project scenario
                <select
                  aria-label="Project scenario"
                  defaultValue=""
                  onChange={(e) => chooseScenario(e.target.value)}
                >
                  <option value="" disabled>
                    Choose a saved scenario…
                  </option>
                  {Object.keys(project?.config.scenarios ?? {}).map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="scenario-grid">
              {(
                [
                  ["seed", "Seed"],
                  ["maxSteps", "Maximum steps"],
                  ["maxSamples", "Sampled traces"],
                  ["timeoutMs", "Checker budget (ms)"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    aria-label={label}
                    className="text-input"
                    inputMode="numeric"
                    value={settings[key]}
                    onChange={(e) =>
                      setSettings((old) => ({
                        ...old,
                        [key]:
                          key === "seed"
                            ? e.target.value
                            : Number(e.target.value),
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <ScopeEditor
              entry={selectedEntry}
              operations={scenarioOperations}
              value={settings.scope}
              onChange={(scope) => setSettings((old) => ({ ...old, scope }))}
            />
            <section className="save-scenario">
              <label>
                Save this scenario as
                <input
                  className="text-input"
                  aria-label="Scenario name"
                  value={scenarioName}
                  onChange={(e) => {
                    setScenarioName(e.target.value);
                    setScenarioSaved("");
                  }}
                  placeholder="For example, small valid order"
                />
              </label>
              <button
                type="button"
                className="button secondary"
                disabled={!scenarioName.trim()}
                onClick={() => void saveScenario()}
              >
                Save scenario to project
              </button>
              {scenarioSaved && <p role="status">{scenarioSaved}</p>}
            </section>
            <details>
              <summary>Reproduce from the command line</summary>
              <p>
                Save the current source buffers first; download the scope beside
                your project.
              </p>
              <pre>{command}</pre>
              <button
                type="button"
                className="button secondary"
                onClick={exportScope}
              >
                Download scenario.json
              </button>
            </details>
            {settingsError && (
              <p role="alert" className="settings-error">
                {settingsError}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setSettingsOpen(false)}
              >
                Close
              </button>
              <button className="button primary">Apply scenario</button>
            </div>
          </form>
        </div>
      )}
      {setupOpen && project && (
        <ProjectSetup
          name={basename(project.root)}
          workspace={project.workspace ?? null}
          trust={project.trust ?? null}
          onClose={() => setSetupOpen(false)}
          onUpdate={(value) => {
            setProject((old) =>
              old
                ? {
                    ...old,
                    workspace: value.workspace,
                    ...(value.trust ? { trust: value.trust } : {}),
                    architectureAvailable:
                      old.architectureAvailable ||
                      value.documentation.status === "imported" ||
                      value.documentation.status === "unchanged",
                  }
                : old,
            );
            if (value.documentation.status === "imported") {
              setArchitectureVisited(true);
              setArchitectureOpen(true);
              setArchitectureRefresh((old) => old + 1);
            }
          }}
        />
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="Close guide"
              onClick={() => setHelp(false)}
            >
              ×
            </button>
            <span className="eyebrow">GETTING STARTED</span>
            <h2 id="guide-title">Design with the consequences in view.</h2>
            <ol className="guide-steps">
              <li>
                <b>Describe the boundaries.</b> Define types, operations,
                outcomes and effects in a {publicIdentity.extension} file.
              </li>
              <li>
                <b>Check the design.</b> Follow a finding to its source. Use
                Work, Structure and Evidence to understand why it matters.
              </li>
              <li>
                <b>Explore behaviour.</b> Select an entry, run a bounded
                simulation, and step through a counterexample.
              </li>
              <li>
                <b>Refine and repeat.</b> Edit the model, check again, and save
                when you are ready. Old evidence stays tied to its source.
              </li>
            </ol>
            <div className="shortcut-grid">
              <span>Check current file</span>
              <kbd>Ctrl / ⌘ Enter</kbd>
              <span>Save</span>
              <kbd>Ctrl / ⌘ S</kbd>
              <span>Completion</span>
              <kbd>Ctrl / ⌘ Space</kbd>
            </div>
            <p className="muted">
              Unknowns and unsupported checks are visible obligations. A
              completed run is not a universal correctness proof.
            </p>
          </section>
        </div>
      )}
      {interfaceConflict && (
        <InterfaceConflict
          value={interfaceConflict}
          onClose={() => setInterfaceConflict(null)}
          onChoose={async (symbolId) => {
            try {
              const description = readSignatureDescription(
                await api("interface", {
                  action: "describe",
                  runId: interfaceConflict.runId,
                  symbolId,
                }),
              );
              setInterfaceConflict((old) =>
                old ? { ...old, description } : old,
              );
            } catch (error) {
              setError(String(error));
            }
          }}
          onContinue={(combinedEdit) => {
            const { description, draft, runId } = interfaceConflict;
            if (!description) return;
            const checked = runs.find((r) => r.id === runId);
            const source = checked?.report?.snapshot.files.find(
              (s) => s.file === description.file,
            );
            if (!source) {
              setError(
                "This checked snapshot is unavailable. Keep the form and check again.",
              );
              return;
            }
            setInterfaceDraft({
              ...draft,
              edit: combinedEdit,
              symbolId: description.symbolId,
              file: relative(description.file),
              snapshotId: description.snapshotId,
              baseline: {
                signature: description,
                ...(description.headerHash
                  ? { headerHash: description.headerHash }
                  : {}),
                types: [],
              },
            });
            setInterfaceSession({ description, runId, baseText: source.text });
            setInterfaceConflict(null);
          }}
        />
      )}
      {interfaceSession && (
        <InterfaceEditor
          description={interfaceSession.description}
          projectRoot={project?.root ?? ""}
          runId={interfaceSession.runId}
          initialEdit={interfaceDraft?.edit}
          initialBaseline={interfaceDraft?.baseline}
          onEdit={(edit, types) =>
            setInterfaceDraft({
              file: relative(interfaceSession.description.file),
              symbolId: interfaceSession.description.symbolId,
              snapshotId: interfaceSession.description.snapshotId,
              baseline: {
                ...((interfaceDraft?.baseline?.headerHash ??
                interfaceSession.description.headerHash)
                  ? {
                      headerHash:
                        interfaceDraft?.baseline?.headerHash ??
                        interfaceSession.description.headerHash!,
                    }
                  : {}),
                signature: interfaceDraft?.baseline?.signature ?? {
                  name: interfaceSession.description.name,
                  inputs: interfaceSession.description.inputs,
                  output: interfaceSession.description.output,
                  effects: interfaceSession.description.effects,
                },
                types,
              },
              edit,
            })
          }
          onClose={() => setInterfaceSession(null)}
          onApply={async (preview) => {
            await applySourcePreview(
              preview,
              "Interface changes are in the editor. Review the check results, then save when ready.",
              interfaceDraft?.edit.name ?? interfaceSession.description.name,
            );
            setInterfaceSession(null);
            setInterfaceDraft(null);
          }}
        />
      )}
      {pendingType && !typeSession && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Opening data shape"
          >
            <h2>Opening data shape</h2>
            <p>Checking the current source and loading its fields.</p>
            <button className="button secondary" onClick={cancelTypeOpening}>
              Close
            </button>
          </section>
        </div>
      )}
      {typeSession && (
        <TypeEditor
          key={typeSession.runId + typeSession.description.symbolId}
          runId={typeSession.runId}
          description={typeSession.description}
          file={relative(typeSession.description.file)}
          knownTypes={typeSession.knownTypes}
          initialDraft={typeDraft}
          onDraft={(draft) => setTypeDraft(readTypeDraft(draft))}
          onClose={() => setTypeSession(null)}
          onApply={async (preview) => {
            await applySourcePreview(
              preview,
              "Data-shape changes are in the editor. Review the check results, then save when ready.",
              typeSession.description.name,
            );
            setTypeSession(null);
            setTypeDraft(null);
          }}
        />
      )}
      {operationSession && (
        <OperationContractEditor
          file={operationSession.file}
          name={operationSession.name}
          symbolId={
            absolute(operationSession.file) + "#" + operationSession.name
          }
          runId={
            runs.find((r) => r.id === operationSession.runId)?.status ===
            "completed"
              ? operationSession.runId
              : undefined
          }
          loadError={
            operationSession.error ??
            runs.find((r) => r.id === operationSession.runId)?.error ??
            undefined
          }
          initialDraft={operationDraft}
          recoverySaved={recovery.currentAcknowledged}
          onDraft={(draft) =>
            setOperationDraft(operationDraftSchema.parse(draft))
          }
          onClose={closeOperation}
          onRefresh={() => void openOperation()}
          onApply={async (preview) => {
            await applySourcePreview(
              preview,
              "Operation changes are in the editor. Review affected callers before saving.",
              operationSession.name,
            );
            setOperationDraft(null);
            closeOperation();
            setEditorMode("blocks");
          }}
        />
      )}
      {declarationOpen && declarationSession && (
        <DeclarationEditor
          file={declarationSession.file}
          resourceName={declarationSession.resourceName}
          runId={
            runs.find((r) => r.id === declarationSession.runId)?.status ===
            "completed"
              ? declarationSession.runId
              : undefined
          }
          loadError={
            declarationSession.error ??
            runs.find((r) => r.id === declarationSession.runId)?.error ??
            undefined
          }
          initialDraft={declarationDraft}
          onDraft={(draft) =>
            setDeclarationDraft(declarationDraftSchema.parse(draft))
          }
          recoverySaved={recovery.currentAcknowledged}
          onClose={closeDeclaration}
          onRefresh={() =>
            void openDeclaration(declarationSession.resourceName)
          }
          onApply={async (preview) => {
            await applySourcePreview(
              preview,
              declarationSession.resourceName
                ? "Lifecycle changes are in the editor. Review affected callers before saving."
                : "Declaration added to the editor. Review the check results before saving.",
              declarationDraft?.declaration.kind === "component" ||
                declarationDraft?.declaration.kind === "operation"
                ? declarationDraft.declaration.signature.name
                : declarationDraft?.declaration.kind === "type"
                  ? (
                      declarationDraft.declaration.definition as {
                        name: string;
                      }
                    ).name
                  : declarationDraft?.declaration.name,
            );
            setDeclarationDraft(null);
            closeDeclaration();
            setEditorMode("blocks");
          }}
        />
      )}
      {newFile && (
        <RecipeForm
          initialDraft={newDesign}
          onDraft={setNewDesign}
          typeCatalogue={typeCatalogue}
          onReloadTypes={() => {
            void runCheck();
          }}
          projectTypes={projectTypes}
          existingPaths={project?.files.map((f) => f.path) ?? []}
          onClose={() => setNewFile(false)}
          onCreate={createRecipe}
        />
      )}
    </div>
  );
}
function Structure({
  symbols,
  report,
  onJump,
}: {
  symbols: SymbolView[];
  report: Report | null;
  onJump: (span: Span) => void;
}) {
  const [query, setQuery] = useState(""),
    [focus, setFocus] = useState("");
  const edges = report?.dependencies ?? [];
  const filtered = symbols.filter((s) =>
    `${s.name} ${s.kind}`.toLowerCase().includes(query.toLowerCase()),
  );
  const affected = useMemo(() => {
    const seen = new Set<string>(),
      queue = focus ? [focus] : [];
    const reverse = new Map<string, string[]>();
    for (const e of edges) {
      const list = reverse.get(e.to) ?? [];
      list.push(e.from);
      reverse.set(e.to, list);
    }
    for (let i = 0; i < queue.length; i++)
      for (const from of reverse.get(queue[i]!) ?? [])
        if (!seen.has(from) && from !== focus) {
          seen.add(from);
          queue.push(from);
        }
    return seen;
  }, [focus, edges]);
  const resource = symbols.find((s) => s.id === focus && s.kind === "resource");
  return (
    <>
      <div className="view-intro">
        <h2>See the shape of the design</h2>
        <p>
          Explore declarations and the consumers that could be affected by a
          change.
        </p>
        <input
          className="search"
          aria-label="Search components"
          placeholder="Search components, rules or resources…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <DependencyMap
        symbols={symbols}
        edges={edges}
        selected={focus}
        onSelect={setFocus}
        onOpen={(symbol) => onJump(symbol.span)}
      />
      {focus && (
        <div className="impact-summary">
          <b>{short(focus)}</b>
          <span>{affected.size} dependent components</span>
          <button className="text-link" onClick={() => setFocus("")}>
            Clear selection
          </button>
        </div>
      )}
      {resource && (
        <article className="lifecycle-card">
          <h3>{resource.name} lifecycle</h3>
          <div className="state-list">
            {resource.states?.map((state) => (
              <span
                key={state}
                className={`resource-state ${resource.terminal?.includes(state) ? "terminal" : ""}`}
              >
                {resource.initial === state ? "→ " : ""}
                {state}
                {resource.terminal?.includes(state) ? " ✓" : ""}
              </span>
            ))}
          </div>
          <ul>
            {resource.transitions?.map((t, i) => (
              <li key={i}>
                {t.from} → {t.to}
              </li>
            ))}
          </ul>
          <p className="muted">
            Declared transitions; reachability alone does not prove eventual
            cleanup.
          </p>
        </article>
      )}
      {filtered.slice(0, 200).map((s) => (
        <article
          key={s.id}
          className={`symbol-card ${affected.has(s.id) ? "affected" : ""} ${focus === s.id ? "focused" : ""}`}
        >
          <button className="symbol-main" onClick={() => setFocus(s.id)}>
            <span className="symbol-kind">{s.kind}</span>
            <span>
              <strong>{s.name}</strong>
              <small>{s.signature}</small>
            </span>
            {affected.has(s.id) && (
              <span className="badge pending">affected</span>
            )}
          </button>
          <button
            className="source-link"
            aria-label={`Go to definition of ${s.name}`}
            onClick={() => onJump(s.span)}
          >
            ↗
          </button>
        </article>
      ))}
      {!filtered.length && (
        <div className="empty-state">
          <h2>No components in this view</h2>
          <p>Run a local check to load the typed structure of this file.</p>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
