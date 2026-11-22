// SPDX-License-Identifier: MIT
/** Project-relative POSIX paths. Ranges are half-open UTF-16 code-unit offsets, never bytes. */
export interface SourceRange {
  start: number;
  end: number;
}
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type ParseStatus = "clean" | "partial" | "failed";
export interface Diagnostic {
  message: string;
  range?: SourceRange;
}
export interface SymbolDraft {
  /** Unique file-local key for connecting link sources. Not persistent identity. */
  key: string;
  name: string;
  kind: string;
  /** Position-independent scoped identity, e.g. Class.method or (*B).String. */
  identity: string;
  range: SourceRange;
  data?: Json;
}
export interface LinkDraft {
  sourceKey: string | null;
  kind: string;
  targetName: string;
  range: SourceRange;
  data?: Json;
}
export interface ParseResult {
  status: ParseStatus;
  /** Returned failures describe content by default. Operational failures must opt out
   * of content caching here, or throw (including cancellation/time/budget errors). */
  failureKind?: "content" | "transient";
  diagnostics: Diagnostic[];
  symbols: SymbolDraft[];
  links: LinkDraft[];
  data?: Json;
}
export interface SourceInput {
  path: string;
  text: string;
}
export interface ContextFile extends SourceInput {
  /** Hash of original bytes, even when decoding failed. */
  hash: string;
  status: "clean" | "failed";
  diagnostics: Diagnostic[];
  dependency?: import("./dependency-inputs.js").DependencyStamp;
}
export interface GraphFile extends SourceInput {
  hash: string;
  module: string;
  version: string;
  result: ParseResult;
}
export interface GraphSymbol extends SymbolDraft {
  id: string;
  ordinal: number;
  file: string;
  module: string;
  status: ParseStatus;
}
/**
 * How the source proves a library target. Kinds that name only a unit, or
 * only make the target possible, are restricted (see libraryEvidence).
 */
export type LibraryEvidence =
  /** An import/use statement names the unit by its path. Unit only. */
  | "import-path"
  /** A name bound by an import of the unit, and the member selected from it. */
  | "import-binding"
  /** A fully qualified path written in the source names the unit and symbol. */
  | "qualified-path"
  /** An explicit trait or interface qualification (`<T as Trait>::m`). */
  | "explicit-trait"
  /** A language-declared builtin, intrinsic or global, by its declared name. */
  | "declared-builtin"
  /** A reference directive naming a declaration unit (`/// <reference lib>`). */
  | "reference-directive"
  /** A glob/dot import puts the unit in scope; the symbol is only possible. Candidate sets only. */
  | "glob-import"
  /**
   * The member's declaring owner is proven: the declaration was established
   * after alias, deref, trait or embedding selection, or by the type checker.
   * Never the receiver's type alone. Symbol required.
   */
  | "declaring-owner";
/**
 * A target outside the checkout: a library unit (level 1) or a symbol in it
 * (level 2). Never read from dependency sources, the network or a resolver.
 */
export interface LibraryTarget {
  /** Lowercase id, e.g. go, go-std, cargo, rust-std, npm, node, dom, typescript-lib. */
  ecosystem: string;
  /** Module path, crate or package name, or standard-library unit. */
  unit: string;
  /** Symbol path within the unit, as the unit spells it; absent for the unit itself. */
  symbol?: string;
  /** Only when the checkout's manifest or lockfile states it; never guessed. */
  version?: string;
  /**
   * Required with a version, and only then: the project path of the clean
   * context file (manifest or lockfile) in the snapshot that states it.
   */
  versionSource?: string;
  evidence: LibraryEvidence;
}
/** A stored library target: its deterministic, project-independent identity. */
export interface GraphLibrary extends LibraryTarget {
  id: string;
}
export interface GraphLink extends LinkDraft {
  id: string;
  file: string;
  module: string;
  origin: "parse" | "analysis";
  sourceId: string | null;
  targetId: string | null;
  /**
   * resolved: a target in the checkout; library: exactly one library target
   * and nothing else; ambiguous: a candidate set of at least two targets,
   * which may mix checkout symbols and library targets.
   */
  resolution: "resolved" | "library" | "unresolved" | "ambiguous";
  candidates: { id: string; status: ParseStatus }[];
  /** Present only when the link has library targets (sorted by id). */
  libraries?: GraphLibrary[];
  sourceStatus: ParseStatus;
  targetStatus: ParseStatus | null;
}
export type LinkResolution = { linkId: string } & (
  | {
      targetId: string | null;
      candidateIds?: never;
      library?: never;
      libraries?: never;
    }
  | {
      library: LibraryTarget;
      targetId?: never;
      candidateIds?: never;
      libraries?: never;
    }
  | {
      /** Checkout candidates; with libraries, at least two targets in total. */
      candidateIds: readonly string[];
      libraries?: readonly LibraryTarget[];
      targetId?: never;
      library?: never;
    }
);
/** A relationship discovered after file parsing (e.g. implicit implements). */
export interface AddedLink {
  key: string;
  file: string;
  sourceId: string | null;
  kind: string;
  targetName: string;
  range: SourceRange;
  data?: Json;
  targetId?: string;
  candidateIds?: readonly string[];
  /** A definite library target. */
  library?: LibraryTarget;
  /** Library members of a candidate set (with candidateIds). */
  libraries?: readonly LibraryTarget[];
}
export interface ResolutionResult {
  resolutions: readonly LinkResolution[];
  links: readonly AddedLink[];
  /** Reason for an open parsed link whose analysis stored no explanation. */
  missingLinkReason?: string;
}
export type ResolutionFile = Pick<GraphFile, "path" | "module"> & {
  result: Pick<ParseResult, "status" | "diagnostics" | "data" | "links">;
};
export interface ResolutionContext {
  projectId: string;
  signal?: AbortSignal;
  /** Entire captured graph. Resolve from facts or the program constructed by analyze, never disk. */
  files: readonly ResolutionFile[];
  contextFiles: readonly ContextFile[];
  symbols: readonly GraphSymbol[];
  /** Parsed links to decide, presented unresolved. Other files' parse facts remain available in files. */
  links: readonly GraphLink[];
  /** If present, return decisions and derived links only for these files. */
  resolutionFiles?: ReadonlySet<string>;
}
/**
 * The opt-in toolchain route for one module (`graph.toolchain.<module id>` in
 * .pymtheg/settings.json, passed as IndexOptions.toolchains). Absent when the
 * project has not opted in: running a toolchain is as trusted as building the
 * project. The module may read the project from disk under `root` and run its
 * language's own build chain; it must still return results for the supplied
 * snapshot.
 */
export interface ToolchainRequest {
  /** Absolute project root on disk. */
  root: string;
  /** The module's setting, as written (e.g. true, or an absolute tool path). */
  setting: Json;
  /** A rebuildable directory the module may use (built helpers, caches). */
  workDir: string;
  /** The caller's environment, for locating the user's own toolchain only. */
  environment: Readonly<Record<string, string | undefined>>;
  signal?: AbortSignal;
  /** Adds a note to the index report (`toolchains`). */
  note(note: Json): void;
}
export interface ProjectAnalysisContext {
  projectId: string;
  signal?: AbortSignal;
  /** Present only when the project opted in for this module's toolchain. */
  toolchain?: ToolchainRequest;
  dependencyInputs?: import("./dependency-inputs.js").DependencyInputs;
  /** All this module's captured sources, including unchanged/reopened files. */
  files: readonly GraphFile[];
  /** All matching declared context files, including unchanged ones. Missing files are absent. */
  contextFiles: readonly ContextFile[];
  changedFiles: readonly string[];
  /** Prior facts for every edited file. Present only when a scoped result can be used. */
  previousFiles?: ReadonlyMap<string, GraphFile>;
  /** Includes deleted context paths. Analysis runs even when this list is empty. */
  changedContextFiles: readonly string[];
  /** Reports which analysis path ran and why a cheaper one was not used. */
  notePath?: (note: AnalysisPath) => void;
}
/**
 * The analysis path a module took for one index (C-38), shown in the index
 * report: `reused` built no program, `scoped` extracted only the edited
 * files, `full` analysed every file; `declined` lists, in order, why a
 * scoped analysis was not used.
 */
export interface AnalysisPath {
  path: "reused" | "scoped" | "full";
  declined?: readonly string[];
  /** Why the path needs no reason, such as "no previous index". */
  note?: string;
}
export interface AnalyzedFile {
  path: string;
  result: ParseResult;
}
export interface ScopedAnalysis {
  files: readonly AnalyzedFile[];
  /** All files whose decisions must be replaced, including every edited and analyzed file. */
  resolutionFiles: readonly string[];
}
export interface LanguageModule {
  id: string;
  version: string;
  /** Production discovery skips marked fixture modules without knowing their names. */
  testOnly?: boolean;
  extensions: readonly string[];
  filenames?: readonly string[];
  /** Globs: *, ?, **; basename match unless the pattern contains /. */
  patterns?: readonly string[];
  /** Optional path-based decline, before specificity selection. Must be deterministic. */
  accepts?: (path: string) => boolean;
  /** Snapshot-only project context. Same glob rules as patterns, independent of source claims. */
  contextFiles?: readonly string[];
  /** Requests a read-only, resolver-driven snapshot of installed declarations. */
  dependencyInputs?: true;
  /** Accepts previousFiles and can prove that some files' decisions still hold. */
  incrementalAnalysis?: true;
  /** For scoped resolution only, the file-level parsed link kinds read across files. */
  scopedFileLinkKinds?: readonly string[];
  /** This resolver uses symbol and link facts without reading file records. */
  resolutionNeedsFiles?: false;
  parse?: (source: SourceInput) => ParseResult | Promise<ParseResult>;
  /** Explicit whole-program phase. May construct a compiler program from the supplied snapshot. */
  analyze?: (
    context: ProjectAnalysisContext,
  ) =>
    | readonly AnalyzedFile[]
    | ScopedAnalysis
    | Promise<readonly AnalyzedFile[] | ScopedAnalysis>;
  resolve?: (
    context: ResolutionContext,
  ) =>
    | readonly LinkResolution[]
    | ResolutionResult
    | Promise<readonly LinkResolution[] | ResolutionResult>;
}
export interface SymbolQuery {
  name?: string;
  kind?: string;
  file?: string;
}
/** The stored origin and validity of a symbol, used to validate decisions. */
export type SymbolReference = Pick<
  GraphSymbol,
  "id" | "file" | "key" | "status"
>;
export interface Neighbourhood {
  symbols: GraphSymbol[];
  links: GraphLink[];
}
export type StorageResult<T> = T | Promise<T>;
/** First diagnostic and its optional half-open UTF-16 range in a failed source. */
export interface FailedFile {
  path: string;
  language: string;
  reason: string;
  range?: SourceRange;
}
/**
 * One module's resolution as the store writes it, validated from the present
 * state (C-22): `current` is analysisLinks(module), `desired` is
 * resolutionFacts over the same links and the present symbols.
 */
export interface ValidatedAnalysis {
  current: readonly GraphLink[];
  desired: readonly GraphLink[];
}
export interface GraphStorage {
  readonly projectId: string;
  /**
   * Declared by a store whose six record reads (files, getFile, filesAt,
   * findSymbols, links, moduleLinks) return freshly decoded records that share
   * nothing with the store or with earlier reads. Other reads (e.g. contexts)
   * are not covered. The indexer then hands them to a
   * module as they are; otherwise it hands the module a deep copy.
   */
  readonly independentReads?: true;
  files(): StorageResult<GraphFile[]>;
  getFile(path: string): StorageResult<GraphFile | undefined>;
  /** Optional: the stored files at these paths (absent paths are skipped), decoding no others. */
  filesAt?(paths: readonly string[]): StorageResult<GraphFile[]>;
  /** Compact resolution input, with only the requested parsed link kinds. */
  resolutionFiles?(
    linkKinds: readonly string[],
  ): StorageResult<ResolutionFile[]>;
  /**
   * Optional light listing (path, module, status) that decodes no records.
   * The indexer otherwise derives it from files().
   */
  fileSummaries?(): StorageResult<
    {
      path: string;
      module: string;
      status: ParseStatus;
      hash?: string;
      version?: string;
    }[]
  >;
  /** Optional: one module's parsed links, as links() reports them. */
  moduleLinks?(module: string): StorageResult<GraphLink[]>;
  /**
   * Optional (C-22): one module's parsed links as a resolver receives them,
   * each a moduleLinks() record with no target, candidates or library
   * targets and resolution "unresolved". Fresh records, as independentReads.
   */
  moduleInputLinks?(module: string): StorageResult<GraphLink[]>;
  /**
   * Optional (C-22): every link of one module, parsed and added, as links()
   * reports them. With it, the indexer validates once and hands
   * replaceAnalysis the result (ValidatedAnalysis).
   */
  analysisLinks?(module: string): StorageResult<GraphLink[]>;
  /** Supports a validated replaceAnalysis for just the supplied paths. */
  analysisLinksAt?(
    module: string,
    paths: ReadonlySet<string>,
  ): StorageResult<GraphLink[]>;
  /** The parsed resolver input for just the supplied paths. */
  moduleInputLinksAt?(
    module: string,
    paths: ReadonlySet<string>,
  ): StorageResult<GraphLink[]>;
  /** Optional row counts; the indexer otherwise counts decoded reads. */
  counts?(): StorageResult<{
    symbols: number;
    links: number;
    unresolved: number;
    ambiguous: number;
    library?: number;
  }>;
  contexts(): StorageResult<ContextFile[]>;
  replaceContexts(files: readonly ContextFile[]): StorageResult<void>;
  /** Optional capability for backends predating failed-parse caching. */
  isParseFailure?(path: string): StorageResult<boolean>;
  /**
   * Optional (C-22): an index run marks the store before its first write
   * and clears the mark with its last. A mark found at the start means the
   * previous run did not finish; no stored analysis is then reused.
   */
  unfinishedIndexRun?(): StorageResult<boolean>;
  /**
   * Begins a run owned by this call; true when a mark of another run was
   * found (and taken over). Each later write of the run proves it still owns
   * the store, or throws without writing.
   */
  beginIndexRun?(): StorageResult<boolean>;
  /** Writes the run's mark at once if it has not written yet (C-38). */
  claimIndexRun?(): StorageResult<void>;
  /** Module versions whose completed decisions this run found in its opening snapshot. */
  completedAnalysis?(): StorageResult<ReadonlyMap<string, string>>;
  /** An incomplete run retains its mark. A successful owned run records reusable module decisions. */
  finishIndexRun?(
    incomplete?: boolean,
    completed?: ReadonlyMap<string, string>,
  ): StorageResult<void>;
  /**
   * Runs `action` with its writes grouped into fewer, bounded commits
   * (C-37). Each write still succeeds or fails on its own.
   */
  writeBatch?<T>(action: () => Promise<T>): Promise<T>;
  failedFiles?(): StorageResult<FailedFile[]>;
  /** parseFailure distinguishes cacheable parser failures from retryable project failures. */
  replaceFile(file: GraphFile, parseFailure?: boolean): StorageResult<void>;
  removeFile(path: string): StorageResult<void>;
  findSymbols(query?: SymbolQuery): StorageResult<GraphSymbol[]>;
  symbolReferences?(ids: ReadonlySet<string>): StorageResult<SymbolReference[]>;
  links(): StorageResult<GraphLink[]>;
  outgoing(id: string, kind?: string): StorageResult<GraphLink[]>;
  /** Includes candidate mentions, explicitly marked ambiguous. */
  incoming(id: string, kind?: string): StorageResult<GraphLink[]>;
  unresolved(): StorageResult<GraphLink[]>;
  ambiguous(): StorageResult<GraphLink[]>;
  resolveLinks(resolutions: readonly LinkResolution[]): StorageResult<void>;
  /**
   * Atomically replace this module's derived links and all its target
   * decisions. `validated`, when given, is what the store would derive from
   * `result` (C-22); a store may ignore it and derive its own.
   */
  replaceAnalysis(
    module: string,
    result: ResolutionResult,
    validated?: ValidatedAnalysis,
  ): StorageResult<void>;
  neighbourhood(
    id: string,
    depth: number,
    kind?: string,
  ): StorageResult<Neighbourhood>;
  close(): StorageResult<void>;
}
