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
export interface GraphLink extends LinkDraft {
  id: string;
  file: string;
  module: string;
  origin: "parse" | "analysis";
  sourceId: string | null;
  targetId: string | null;
  resolution: "resolved" | "unresolved" | "ambiguous";
  candidates: { id: string; status: ParseStatus }[];
  sourceStatus: ParseStatus;
  targetStatus: ParseStatus | null;
}
export type LinkResolution = { linkId: string } & (
  | { targetId: string | null; candidateIds?: never }
  | { candidateIds: readonly string[]; targetId?: never }
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
}
export interface ResolutionResult {
  resolutions: readonly LinkResolution[];
  links: readonly AddedLink[];
}
export interface ResolutionContext {
  projectId: string;
  /** Entire captured graph. Resolve from facts or the program constructed by analyze, never disk. */
  files: readonly GraphFile[];
  contextFiles: readonly ContextFile[];
  symbols: readonly GraphSymbol[];
  /** Only this module's parsed links, presented unresolved. Derived links are rebuilt each invocation. */
  links: readonly GraphLink[];
}
export interface ProjectAnalysisContext {
  projectId: string;
  /** All this module's captured sources, including unchanged/reopened files. */
  files: readonly GraphFile[];
  /** All matching declared context files, including unchanged ones. Missing files are absent. */
  contextFiles: readonly ContextFile[];
  changedFiles: readonly string[];
  /** Includes deleted context paths. Analysis runs even when this list is empty. */
  changedContextFiles: readonly string[];
}
export interface AnalyzedFile {
  path: string;
  result: ParseResult;
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
  parse?: (source: SourceInput) => ParseResult | Promise<ParseResult>;
  /** Explicit whole-program phase. May construct a compiler program from the supplied snapshot. */
  analyze?: (
    context: ProjectAnalysisContext,
  ) => readonly AnalyzedFile[] | Promise<readonly AnalyzedFile[]>;
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
export interface Neighbourhood {
  symbols: GraphSymbol[];
  links: GraphLink[];
}
export type StorageResult<T> = T | Promise<T>;
export interface GraphStorage {
  readonly projectId: string;
  files(): StorageResult<GraphFile[]>;
  getFile(path: string): StorageResult<GraphFile | undefined>;
  contexts(): StorageResult<ContextFile[]>;
  replaceContexts(files: readonly ContextFile[]): StorageResult<void>;
  replaceFile(file: GraphFile): StorageResult<void>;
  removeFile(path: string): StorageResult<void>;
  findSymbols(query?: SymbolQuery): StorageResult<GraphSymbol[]>;
  links(): StorageResult<GraphLink[]>;
  outgoing(id: string, kind?: string): StorageResult<GraphLink[]>;
  /** Includes candidate mentions, explicitly marked ambiguous. */
  incoming(id: string, kind?: string): StorageResult<GraphLink[]>;
  unresolved(): StorageResult<GraphLink[]>;
  ambiguous(): StorageResult<GraphLink[]>;
  resolveLinks(resolutions: readonly LinkResolution[]): StorageResult<void>;
  /** Atomically replace this module's derived links and all its target decisions. */
  replaceAnalysis(
    module: string,
    result: ResolutionResult,
  ): StorageResult<void>;
  neighbourhood(
    id: string,
    depth: number,
    kind?: string,
  ): StorageResult<Neighbourhood>;
  close(): StorageResult<void>;
}
