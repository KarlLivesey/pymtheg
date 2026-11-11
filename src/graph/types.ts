/** All paths are project-relative POSIX paths; positions are half-open UTF-16 offsets. */
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
  /** Unique within this file; used by links, not used as the persistent ID. */
  key: string;
  name: string;
  /** Open vocabulary: function, method, type, module, file, variable, etc. */
  kind: string;
  range: SourceRange;
  /** Optional language-specific, serializable facts for cross-file resolution. */
  data?: Json;
}
export interface LinkDraft {
  /** null for file-level relationships such as imports. */
  sourceKey: string | null;
  /** Open vocabulary: calls, imports, contains, implements, references, etc. */
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
export interface GraphFile {
  path: string;
  hash: string;
  module: string;
  version: string;
  /** Kept once so resolution uses the exact text that was parsed. */
  text: string;
  result: ParseResult;
}
export interface GraphSymbol extends SymbolDraft {
  id: string;
  file: string;
  module: string;
}
export interface GraphLink extends LinkDraft {
  id: string;
  file: string;
  module: string;
  sourceId: string | null;
  targetId: string | null;
  resolution: "resolved" | "unresolved";
}
export interface ResolutionContext {
  /** Entire captured project, including persisted unchanged facts. Never reparse. */
  files: readonly GraphFile[];
  symbols: readonly GraphSymbol[];
  /** Only this module's links, always presented unresolved. */
  links: readonly GraphLink[];
}
export interface LinkResolution {
  linkId: string;
  targetId: string;
}
export interface LanguageModule {
  /** Stable unique identifier and parser/resolver revision; bump version to invalidate hashes. */
  id: string;
  version: string;
  extensions: readonly string[];
  filenames?: readonly string[];
  parse(source: SourceInput): ParseResult | Promise<ParseResult>;
  /** Return only definite targets. Omitted links remain explicitly unresolved. */
  resolve(
    context: ResolutionContext,
  ): readonly LinkResolution[] | Promise<readonly LinkResolution[]>;
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
/** Backends may be local/synchronous or remote/asynchronous; no database handles escape. */
export type StorageResult<T> = T | Promise<T>;
export interface GraphStorage {
  readonly projectId: string;
  files(): StorageResult<GraphFile[]>;
  getFile(path: string): StorageResult<GraphFile | undefined>;
  replaceFile(file: GraphFile): StorageResult<void>;
  removeFile(path: string): StorageResult<void>;
  findSymbols(query?: SymbolQuery): StorageResult<GraphSymbol[]>;
  links(): StorageResult<GraphLink[]>;
  outgoing(id: string, kind?: string): StorageResult<GraphLink[]>;
  incoming(id: string, kind?: string): StorageResult<GraphLink[]>;
  unresolved(): StorageResult<GraphLink[]>;
  /** Atomically replace all definite targets; omitted links become unresolved. */
  resolveLinks(resolutions: readonly LinkResolution[]): StorageResult<void>;
  neighbourhood(
    id: string,
    depth: number,
    kind?: string,
  ): StorageResult<Neighbourhood>;
  close(): StorageResult<void>;
}
