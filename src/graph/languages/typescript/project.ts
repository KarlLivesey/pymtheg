import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, posix } from "node:path";
import ts from "typescript";
import { compare, matchesPattern } from "../../index.js";
import type { ContextFile, Diagnostic, GraphFile } from "../../types.js";
import {
  freshNames,
  renameShadowed,
  type FreshNames,
  type Renamed,
} from "./rename.js";

/**
 * Project model for the snapshot: which config owns each source, with which
 * compiler options, and a compiler host that serves only captured text.
 * Every project path is presented to the compiler as "/" + relative path.
 */
export const LIB_ROOT = "/__pymtheg_typescript_lib__";
const libDirectory = dirname(
  createRequire(import.meta.url).resolve("typescript"),
);
// Library declarations are package assets of the pinned compiler, never project files.
const libCache = new Map<string, ts.SourceFile | null>();
function libFile(path: string): ts.SourceFile | undefined {
  const name = path.slice(LIB_ROOT.length + 1);
  if (!/^lib\.[\w.]+\.d\.ts$|^lib\.d\.ts$/.test(name)) return undefined;
  if (!libCache.has(name)) {
    let text: string | undefined;
    try {
      text = readFileSync(`${libDirectory}/${name}`, "utf8");
    } catch {
      text = undefined;
    }
    libCache.set(
      name,
      text === undefined
        ? null
        : ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true),
    );
  }
  return libCache.get(name) ?? undefined;
}

export const toVirtual = (path: string) => "/" + path;
export const fromVirtual = (path: string): string | undefined =>
  path.startsWith(LIB_ROOT + "/") || !path.startsWith("/")
    ? undefined
    : path.slice(1);

export interface ProjectGroup {
  /** Owning config path, or null for the inferred project (no config includes the file). */
  config: string | null;
  options: ts.CompilerOptions;
  roots: string[];
  /** Limitations that make every owned file's facts partial. */
  limitations: string[];
  /** Non-fatal config diagnostics, recorded on owned files. */
  notes: string[];
  /** Whether the config names its own `files`/`include` (not inherited or default). */
  explicitSelection?: boolean;
  /** Why this config is unusable; every file it owns is failed with this message. */
  failure?: string;
}
export interface ProjectModel {
  groups: ProjectGroup[];
  owner: Map<string, ProjectGroup>;
  /**
   * Files that two or more configs own equally (same containment, depth and
   * name preference). Each is analysed under every tied config and the link
   * results are merged without picking one.
   */
  ties: Map<string, ProjectGroup[]>;
  /** Files failed by a broken config or package manifest, with the cause. */
  failures: Map<string, string>;
  /** Same-length renames applied to each JS file's compiler text. */
  renames: Map<string, Renamed>;
  /** The program-wide fresh names used by every rename. */
  fresh: FreshNames;
  /** Files the compiler's parser could not parse, with the cause. */
  parseFailures: Map<string, string>;
  /**
   * Files with a syntax error (a TypeScript parser diagnostic, or heritage
   * grammar the parser accepts but that has no meaning): failed, served to
   * every program as absent. Their diagnostics, and whether the file was a
   * script (its top-level declarations would be globals).
   */
  syntaxFailures: Map<string, SyntaxFailure>;
  /**
   * Fails a file whose program reported syntactic diagnostics beyond the
   * parser's (TypeScript-only syntax in a JS file); every later program
   * serves it as absent.
   */
  failSyntax: (path: string, extra: readonly ts.Diagnostic[]) => boolean;
  /** Failed files a host was asked for (roots or imports): unseen declarations. */
  requested: (host: ts.CompilerHost) => ReadonlySet<string>;
  /** A compiler host over the snapshot; a variant replaces some files' text. */
  host: (group: ProjectGroup, variant?: HostVariant) => ts.CompilerHost;
}

const INFERRED: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  allowJs: true,
  allowImportingTsExtensions: true,
  resolveJsonModule: false,
};
/** What a failed (syntax-error) file reports and contributes. */
export interface SyntaxFailure {
  diagnostics: Diagnostic[];
  /** Global names it declares: a script's top level and namespaces, `declare global`. */
  names: string[];
}

/**
 * A syntax error makes a file invalid: any syntactic diagnostic (the
 * parser's, the compiler's syntax-phase checks such as TypeScript-only
 * syntax in a JS file, passed as `extra`), or heritage grammar the compiler
 * rejects. Diagnostics are sorted by position and read like tsc's: line and
 * column by the compiler's own conversion on the text tsc parses (without a
 * byte-order mark), the compiler's message, and the offending text when the
 * diagnostic has a span (one line, at most 40 characters).
 */
export function syntaxFailure(
  path: string,
  text: string,
  extra: readonly ts.Diagnostic[] = [],
): SyntaxFailure | undefined {
  const bom = text.startsWith("\uFEFF") ? 1 : 0;
  const plain = text.slice(bom);
  const source = ts.createSourceFile(
    toVirtual(path),
    plain,
    ts.ScriptTarget.Latest,
    true,
  ) as ts.SourceFile & {
    parseDiagnostics?: readonly ts.Diagnostic[];
    externalModuleIndicator?: unknown;
    commonJsModuleIndicator?: unknown;
  };
  const at = (start: number, length: number, message: string) => {
    const { line, character } = source.getLineAndCharacterOfPosition(start);
    const found = plain
      .slice(start, start + length)
      .replace(/\s+/g, " ")
      .trim();
    const shown = found.length > 40 ? found.slice(0, 37) + "..." : found;
    return {
      message: `Syntax error at line ${line + 1}, column ${character + 1}: ${message}${shown ? ` Found: "${shown}".` : ""}`,
      range: {
        start: start + bom,
        end: Math.min(text.length, start + length + bom),
      },
    };
  };
  const seen = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  const push = (start: number, length: number, message: string) => {
    const key = `${start}\0${length}\0${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    diagnostics.push(at(start, length, message));
  };
  for (const diagnostic of source.parseDiagnostics ?? [])
    push(
      diagnostic.start ?? 0,
      diagnostic.length ?? 0,
      ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    );
  // Positions of `extra` are on the compiler's text (with the mark).
  for (const diagnostic of extra)
    push(
      Math.max(0, (diagnostic.start ?? 0) - bom),
      diagnostic.length ?? 0,
      ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    );
  for (const error of heritageErrors(source))
    push(error.start, error.length, error.message);
  if (!diagnostics.length) return undefined;
  diagnostics.sort(
    (a, b) => a.range!.start - b.range!.start || a.range!.end - b.range!.end,
  );
  // The global names it declares (as far as the parser read it): a
  // script's top-level and namespace declarations, and a module's
  // `declare global` blocks. A module's own top-level names are
  // module-scoped: no other file can reach them without importing it.
  const parsed = source as ts.SourceFile & {
    externalModuleIndicator?: unknown;
  };
  const script =
    !parsed.externalModuleIndicator &&
    !/(^|[^.\w$])(module\.exports|exports\.[\w$]+)\s*=|(^|[^.\w$])require\s*\(/.test(
      text,
    );
  const names = new Set<string>();
  const bindingNames = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) names.add(name.text);
    else
      for (const element of name.elements)
        if (!ts.isOmittedExpression(element)) bindingNames(element.name);
  };
  const collect = (statements: readonly ts.Statement[], global: boolean) => {
    for (const statement of statements) {
      if (global && ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations)
          bindingNames(declaration.name);
      else if (
        global &&
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement) ||
          ts.isEnumDeclaration(statement) ||
          ts.isModuleDeclaration(statement)) &&
        statement.name &&
        ts.isIdentifier(statement.name)
      )
        names.add(statement.name.text);
      if (ts.isModuleDeclaration(statement)) {
        const augmentsGlobal =
          (statement.flags & ts.NodeFlags.GlobalAugmentation) !== 0;
        let body = statement.body;
        while (body && ts.isModuleDeclaration(body)) body = body.body;
        if (body && ts.isModuleBlock(body) && (global || augmentsGlobal))
          collect(body.statements, true);
      }
    }
  };
  collect(source.statements, script);
  return {
    diagnostics,
    names: [...names].sort(),
  };
}

/**
 * Heritage grammar the compiler rejects, where and as tsc reports it:
 * a second base class (at that type), a second `extends` or `implements`
 * clause, `extends` after `implements` (at the clause), and `implements`
 * on an interface (at the clause).
 */
function heritageErrors(
  source: ts.SourceFile,
): { start: number; length: number; message: string }[] {
  const errors: { start: number; length: number; message: string }[] = [];
  const at = (node: ts.Node, message: string) =>
    errors.push({
      start: node.getStart(source),
      length: ts.isHeritageClause(node)
        ? node.token === ts.SyntaxKind.ExtendsKeyword
          ? "extends".length
          : "implements".length
        : node.end - node.getStart(source),
      message,
    });
  const visit = (node: ts.Node): void => {
    if (
      (ts.isClassLike(node) || ts.isInterfaceDeclaration(node)) &&
      node.heritageClauses?.length
    ) {
      let seenExtends = false;
      let seenImplements = false;
      for (const clause of node.heritageClauses) {
        if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
          if (ts.isClassLike(node)) {
            if (seenExtends) at(clause, "'extends' clause already seen.");
            else if (seenImplements)
              at(clause, "'extends' clause must precede 'implements' clause.");
            else if (clause.types.length > 1)
              at(clause.types[1]!, "Classes can only extend a single class.");
          }
          seenExtends = true;
        } else {
          if (ts.isInterfaceDeclaration(node))
            at(
              clause,
              "Interface declaration cannot have 'implements' clause.",
            );
          else if (seenImplements)
            at(clause, "'implements' clause already seen.");
          seenImplements = true;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return errors;
}

/** Options the snapshot analysis always overrides; recorded in the change note. */
/** A host serving other compiler text for some files (differential analysis). */
export interface HostVariant {
  /** Replacement compiler text by captured path. */
  texts: ReadonlyMap<string, string>;
  /** Reuses this host's parsed files for files whose text is not replaced. */
  base?: ts.CompilerHost;
  /** Where parser failures of this variant are recorded (not the model's). */
  failures: Map<string, string>;
}

function forced(options: ts.CompilerOptions): ts.CompilerOptions {
  const result: ts.CompilerOptions = {
    ...options,
    allowJs: true,
    noEmit: true,
    skipLibCheck: true,
    // Type packages live under node_modules, which is never captured.
    types: [],
    maxNodeModuleJsDepth: 0,
  };
  for (const key of [
    "composite",
    "incremental",
    "tsBuildInfoFile",
    "typeRoots",
    "plugins",
    "declarationDir",
    "outDir",
    "outFile",
    "rootDir",
    "build",
  ])
    delete result[key];
  return result;
}

const configPreference = (path: string) => {
  const base = posix.basename(path);
  return base === "tsconfig.json" ? 0 : base === "jsconfig.json" ? 1 : 2;
};
const isConfig = (path: string) => {
  const base = posix.basename(path);
  return /^(tsconfig|jsconfig).*\.json$/.test(base);
};
const isRelativeReference = (value: string) =>
  value.startsWith("./") ||
  value.startsWith("../") ||
  value === "." ||
  value === ".." ||
  value.startsWith("/");

class VirtualFileSystem {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>(["/"]);
  /** Virtual node_modules/<name> directory -> real workspace package directory. */
  readonly links = new Map<string, string>();
  add(path: string, text: string) {
    const name = toVirtual(path);
    this.files.set(name, text);
    for (
      let directory = posix.dirname(name);
      !this.directories.has(directory);
      directory = posix.dirname(directory)
    )
      this.directories.add(directory);
  }
  real(path: string): string {
    for (const [link, target] of this.links)
      if (path === link || path.startsWith(link + "/"))
        return target + path.slice(link.length);
    return path;
  }
  fileExists = (path: string) => this.files.has(this.real(path));
  readFile = (path: string) => this.files.get(this.real(path));
  directoryExists = (path: string) => {
    if (this.directories.has(this.real(path))) return true;
    // Ancestors of a virtual workspace link (e.g. /node_modules/@scope).
    for (const link of this.links.keys())
      if (link.startsWith(path.endsWith("/") ? path : path + "/")) return true;
    return false;
  };
  entries = (path: string) => {
    const directory = path === "/" ? "/" : path.replace(/\/$/, "");
    const files: string[] = [];
    const directories: string[] = [];
    for (const file of this.files.keys())
      if (posix.dirname(file) === directory) files.push(posix.basename(file));
    for (const child of this.directories)
      if (child !== directory && posix.dirname(child) === directory)
        directories.push(posix.basename(child));
    return {
      files: files.sort(compare),
      directories: directories.sort(compare),
    };
  };
}

interface Workspace {
  root: string;
  packages: Map<string, string>;
}
function workspaces(
  packages: { path: string; json: Record<string, unknown> }[],
): Workspace[] {
  const result: Workspace[] = [];
  for (const manifest of packages) {
    const declared = manifest.json.workspaces;
    const patterns = Array.isArray(declared)
      ? declared
      : declared && typeof declared === "object"
        ? (declared as { packages?: unknown }).packages
        : undefined;
    if (!Array.isArray(patterns)) continue;
    const root = posix.dirname(manifest.path);
    const prefix = root === "." ? "" : root + "/";
    const members = new Map<string, string>();
    for (const other of packages) {
      const directory = posix.dirname(other.path);
      if (other === manifest || !directory.startsWith(prefix)) continue;
      const relative = directory.slice(prefix.length);
      const name = other.json.name;
      if (
        typeof name === "string" &&
        patterns.some(
          (pattern) =>
            typeof pattern === "string" &&
            !pattern.startsWith("!") &&
            matchesPattern(
              relative,
              pattern.replace(/^\.\//, "").replace(/\/$/, ""),
            ) &&
            pattern.includes("/") === relative.includes("/"),
        )
      )
        members.set(name, directory);
    }
    result.push({ root, packages: members });
  }
  return result;
}

/** Context patterns; also used to tell a missing base from an uncaptured one. */
export const CONTEXT_PATTERNS = [
  "*tsconfig*.json",
  "*jsconfig*.json",
  "package.json",
] as const;
const isContextPath = (path: string) =>
  CONTEXT_PATTERNS.some((pattern) => matchesPattern(path, pattern));
/** Directory depth: the project root is 0, `a` is 1, `a/b` is 2. */
const depthOf = (directory: string) =>
  directory === "." ? 0 : directory.split("/").length;
const underDirectory = (path: string, directory: string) =>
  directory === "." || path.startsWith(directory + "/");
const hasNodeModulesSegment = (path: string) =>
  path.split("/").includes("node_modules");

/**
 * Builds the project model. A broken config or package manifest fails only the
 * files it could own (see `failures`); the model throws (a module-wide analysis
 * error) only when the compiler no longer exposes the file matcher, because then
 * no config's file list can be computed at all.
 */
export function projectModel(
  files: readonly GraphFile[],
  contexts: readonly ContextFile[],
): ProjectModel {
  const fs = new VirtualFileSystem();
  for (const file of contexts) fs.add(file.path, file.text);
  const manifests: { path: string; json: Record<string, unknown> }[] = [];
  /** Package directory -> why its manifest is unreadable. */
  const brokenManifests = new Map<string, string>();
  const packageDirectories: string[] = [];
  for (const file of contexts)
    if (posix.basename(file.path) === "package.json") {
      const directory = posix.dirname(file.path);
      packageDirectories.push(directory);
      let json: unknown;
      try {
        json = JSON.parse(file.text);
      } catch (error) {
        brokenManifests.set(
          directory,
          `Unreadable package manifest ${file.path}: ${(error as Error).message}`,
        );
        continue;
      }
      if (json === null || typeof json !== "object" || Array.isArray(json)) {
        brokenManifests.set(
          directory,
          `Unreadable package manifest ${file.path}: not an object`,
        );
        continue;
      }
      manifests.push({
        path: file.path,
        json: json as Record<string, unknown>,
      });
    }
  // JS files reach the compiler with locally bound require/module/exports
  // renamed (same length), so it never misreads them as CommonJS. Fresh names
  // are chosen once for the whole program, from every captured text.
  const fresh = freshNames(files.map((file) => file.text));
  const renames = new Map<string, Renamed>();
  const renameErrors = new Map<string, string>();
  const typeOf = (path: string) => {
    const manifest = manifests
      .filter((m) => underDirectory(path, posix.dirname(m.path)))
      .sort(
        (a, b) =>
          depthOf(posix.dirname(b.path)) - depthOf(posix.dirname(a.path)),
      )[0];
    return manifest?.json.type;
  };
  for (const file of files) {
    const esm =
      file.path.endsWith(".mjs") ||
      ((file.path.endsWith(".js") || file.path.endsWith(".jsx")) &&
        typeOf(file.path) === "module")
        ? true
        : undefined;
    const renamed = renameShadowed(
      file.path,
      file.text,
      fresh,
      esm ? { esm } : {},
    );
    if (renamed.error) renameErrors.set(file.path, renamed.error);
    else if (renamed.renamed.length || renamed.assumed.length)
      renames.set(file.path, renamed);
    fs.add(file.path, renamed.error ? file.text : renamed.text);
  }
  for (const workspace of workspaces(manifests))
    for (const [name, directory] of workspace.packages)
      fs.links.set(
        toVirtual(
          (workspace.root === "." ? "" : workspace.root + "/") +
            "node_modules/" +
            name,
        ),
        toVirtual(directory),
      );
  const matchFiles = (
    ts as unknown as {
      matchFiles?: (
        path: string,
        extensions: readonly string[] | undefined,
        excludes: readonly string[] | undefined,
        includes: readonly string[] | undefined,
        useCaseSensitiveFileNames: boolean,
        currentDirectory: string,
        depth: number | undefined,
        getFileSystemEntries: (path: string) => {
          files: readonly string[];
          directories: readonly string[];
        },
        realpath: (path: string) => string,
      ) => string[];
    }
  ).matchFiles;
  if (typeof matchFiles !== "function")
    throw Error("The pinned TypeScript compiler no longer exposes matchFiles");
  const parseHost: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: true,
    fileExists: fs.fileExists,
    readFile: fs.readFile,
    readDirectory: (root, extensions, excludes, includes, depth) =>
      matchFiles(
        root,
        extensions,
        excludes,
        includes,
        true,
        "/",
        depth,
        fs.entries,
        (path) => path,
      ),
  };
  const groups: ProjectGroup[] = [];
  const claimed = new Map<string, ProjectGroup[]>();
  const claim = (path: string, group: ProjectGroup) => {
    const list = claimed.get(path) ?? [];
    if (!list.includes(group)) list.push(group);
    claimed.set(path, list);
  };
  const unreadable: ProjectGroup[] = [];
  const configs = contexts
    .filter((file) => isConfig(file.path))
    .sort((a, b) => compare(a.path, b.path));
  const syntaxError = (source: ts.TsConfigSourceFile) => {
    const diagnostics = (
      source as ts.TsConfigSourceFile & {
        parseDiagnostics?: readonly ts.Diagnostic[];
      }
    ).parseDiagnostics;
    return diagnostics?.length
      ? ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, " ")
      : undefined;
  };
  for (const config of configs) {
    const group: ProjectGroup = {
      config: config.path,
      options: forced(INFERRED),
      roots: [],
      limitations: [],
      notes: [],
    };
    groups.push(group);
    const fail = (message: string) => {
      group.failure ??= message;
    };
    const source = ts.parseJsonText(toVirtual(config.path), config.text);
    const syntax = syntaxError(source);
    const raw = syntax
      ? undefined
      : (ts.convertToObject(source, []) as unknown);
    if (syntax) fail(`Unreadable TypeScript config ${config.path}: ${syntax}`);
    else if (raw === null || typeof raw !== "object" || Array.isArray(raw))
      fail(`Unreadable TypeScript config ${config.path}: not an object`);
    const object = (
      raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
    ) as Record<string, unknown>;
    // `files`, `include` and `exclude` must be arrays of strings.
    const badSelection = (["files", "include", "exclude"] as const).find(
      (key) =>
        key in object &&
        !(
          Array.isArray(object[key]) &&
          (object[key] as unknown[]).every((item) => typeof item === "string")
        ),
    );
    if (badSelection)
      fail(
        `TypeScript config ${config.path} has an invalid "${badSelection}" (expected an array of strings)`,
      );
    /** Malformed JSON, a non-object root or an invalid selection: its own file selection cannot be read. */
    const selectionUnreadable =
      !!syntax || object !== raw || badSelection !== undefined;
    group.explicitSelection = "files" in object || "include" in object;
    // Follow the extends chain ourselves first so missing bases are classified, not ignored.
    const pending: [string, unknown][] = [[config.path, object.extends]];
    const seen = new Set<string>();
    while (pending.length && !group.failure) {
      const [from, value] = pending.pop()!;
      for (const base of (Array.isArray(value)
        ? value
        : value === undefined
          ? []
          : [value]) as unknown[]) {
        if (typeof base !== "string") {
          fail(`TypeScript config ${from} has an invalid extends value`);
          break;
        }
        const outside = (detail: string) =>
          group.limitations.push(
            `${from} extends "${base}" ${detail}; node_modules is never captured, so those settings are missing`,
          );
        if (!isRelativeReference(base)) {
          outside("from an external package");
          continue;
        }
        let target = posix.normalize(
          posix.join(posix.dirname(toVirtual(from)), base),
        );
        if (hasNodeModulesSegment(target)) {
          outside("inside node_modules");
          continue;
        }
        if (!fs.fileExists(target) && fs.fileExists(target + ".json"))
          target += ".json";
        const path = fromVirtual(target);
        const context = contexts.find((file) => file.path === path);
        if (!context && path !== undefined && !isContextPath(path)) {
          // Context patterns are static: a base outside them is never captured,
          // so it may exist. Its settings are missing, which is a limitation.
          group.limitations.push(
            `${from} extends "${base}", which is not captured as project context (only ${CONTEXT_PATTERNS.join(", ")} are); its settings are missing`,
          );
          continue;
        }
        if (!context) {
          fail(
            `TypeScript config ${from} extends "${base}", which is missing from the snapshot`,
          );
          break;
        }
        if (seen.has(context.path)) continue;
        seen.add(context.path);
        const baseSource = ts.parseJsonText(
          toVirtual(context.path),
          context.text,
        );
        const baseSyntax = syntaxError(baseSource);
        if (baseSyntax) {
          fail(
            `TypeScript config ${from} extends ${context.path}, which is unreadable: ${baseSyntax}`,
          );
          break;
        }
        const parsed = ts.convertToObject(baseSource, []) as unknown;
        if (
          parsed === null ||
          typeof parsed !== "object" ||
          Array.isArray(parsed)
        ) {
          fail(
            `TypeScript config ${from} extends ${context.path}, which is unreadable: not an object`,
          );
          break;
        }
        pending.push([
          context.path,
          (parsed as Record<string, unknown>).extends,
        ]);
      }
    }
    // References are not passed to the compiler: a missing one is only a note.
    for (const reference of Array.isArray(object.references)
      ? object.references
      : []) {
      const value =
        reference && typeof reference === "object"
          ? (reference as { path?: unknown }).path
          : undefined;
      if (typeof value !== "string") {
        group.notes.push(
          `${config.path}: invalid project reference (ignored; references are not used for resolution)`,
        );
        continue;
      }
      const target = posix.normalize(
        posix.join(posix.dirname(toVirtual(config.path)), value),
      );
      if (
        !fs.fileExists(target) &&
        !fs.fileExists(posix.join(target, "tsconfig.json"))
      )
        group.notes.push(
          `${config.path}: references "${value}", which is missing from the snapshot (references are not used for resolution)`,
        );
    }
    if (!syntax) {
      const jsconfig = posix.basename(config.path).startsWith("jsconfig");
      const parsed = ts.parseJsonSourceFileConfigFileContent(
        source,
        parseHost,
        posix.dirname(toVirtual(config.path)),
        jsconfig
          ? {
              allowJs: true,
              allowSyntheticDefaultImports: true,
              skipLibCheck: true,
            }
          : {},
        toVirtual(config.path),
      );
      if (!group.failure) {
        group.notes.push(
          ...parsed.errors
            // 18003: "No inputs were found" is a normal state for solution-style configs.
            // 6053/5083: unreadable extends, already a limitation above.
            .filter(
              (error) =>
                error.code !== 18003 &&
                error.code !== 6053 &&
                error.code !== 5083,
            )
            .map(
              (error) =>
                `${config.path}: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`,
            ),
        );
        group.options = forced(parsed.options);
      }
      // A broken config still claims whatever its own file list names. A config
      // whose selection cannot be read claims nothing here: the compiler would
      // hand back its default input list (every file), so only the guarded
      // directory fallback below applies.
      if (!selectionUnreadable)
        for (const name of parsed.fileNames) {
          const path = fromVirtual(name);
          if (path !== undefined) claim(path, group);
        }
    }
    // Its own file selection cannot be read: it could own anything below its
    // directory (decided after every config, see below).
    if (group.failure && selectionUnreadable) unreadable.push(group);
  }
  // Never fall back onto files that a healthy config in the same directory
  // explicitly selects with its own `files`/`include`.
  for (const group of unreadable) {
    const directory = posix.dirname(group.config!);
    for (const file of files)
      if (
        underDirectory(file.path, directory) &&
        !(claimed.get(file.path) ?? []).some(
          (other) =>
            !other.failure &&
            other.explicitSelection &&
            posix.dirname(other.config!) === directory,
        )
      )
        claim(file.path, group);
  }
  const owner = new Map<string, ProjectGroup>();
  const ties = new Map<string, ProjectGroup[]>();
  const failures = new Map<string, string>();
  let inferred: ProjectGroup | undefined;
  for (const file of [...files].sort((a, b) => compare(a.path, b.path))) {
    // Ownership: a config whose directory contains the file, then the nearest
    // (deepest) directory, then tsconfig.json over jsconfig.json over other
    // names. Path order only orders configs that are still equal; those are a
    // genuine tie, analysed under each (see ties).
    const rank = (group: ProjectGroup) => {
      const directory = posix.dirname(group.config!);
      return [
        underDirectory(file.path, directory) ? 0 : 1,
        -depthOf(directory),
        configPreference(group.config!),
      ];
    };
    const candidates = (claimed.get(file.path) ?? []).sort((a, b) => {
      const [x, y] = [rank(a), rank(b)];
      return (
        x[0]! - y[0]! ||
        x[1]! - y[1]! ||
        x[2]! - y[2]! ||
        compare(a.config!, b.config!)
      );
    });
    const top = candidates[0] && rank(candidates[0]).join();
    const tied = candidates.filter((group) => rank(group).join() === top);
    let group = candidates[0];
    if (!group) {
      inferred ??= {
        config: null,
        options: forced(INFERRED),
        roots: [],
        limitations: [],
        notes: [],
      };
      group = inferred;
    }
    owner.set(file.path, group);
    // The nearest package manifest governs a file; a broken one fails just its package.
    const manifest = packageDirectories
      .filter((directory) => underDirectory(file.path, directory))
      .sort((a, b) => depthOf(b) - depthOf(a))[0];
    const failure =
      renameErrors.get(file.path) ??
      tied.find((candidate) => candidate.failure)?.failure ??
      group.failure ??
      (manifest === undefined ? undefined : brokenManifests.get(manifest));
    if (failure) failures.set(file.path, failure);
    else if (tied.length > 1) {
      ties.set(file.path, tied);
      for (const candidate of tied) candidate.roots.push(toVirtual(file.path));
    } else group.roots.push(toVirtual(file.path));
  }
  if (inferred) groups.push(inferred);
  const parseFailures = new Map<string, string>();
  const syntaxFailures = new Map<string, SyntaxFailure>();
  const caches = new WeakMap<ts.CompilerHost, Map<string, ts.SourceFile>>();
  const asked = new WeakMap<ts.CompilerHost, Set<string>>();
  const originals = new Map(files.map((file) => [file.path, file.text]));
  const host = (
    group: ProjectGroup,
    variant?: HostVariant,
  ): ts.CompilerHost => {
    const sources = new Map<string, ts.SourceFile>();
    const failures = variant?.failures ?? parseFailures;
    const shared = variant?.base && caches.get(variant.base);
    const requested = new Set<string>();
    const created: ts.CompilerHost = {
      getSourceFile(name, languageVersion) {
        if (name.startsWith(LIB_ROOT + "/")) return libFile(name);
        const real = fs.real(name);
        const override = variant?.texts.get(real.slice(1));
        const text = override ?? fs.files.get(real);
        if (text === undefined) return undefined;
        // A file the parser or binder could not handle, or with a syntax
        // error, stays out of every program: it is absent, not empty.
        if (failures.has(real.slice(1))) {
          requested.add(real.slice(1));
          return undefined;
        }
        // An unchanged file reuses the base host's parse (and binding).
        let file =
          sources.get(real) ??
          (override === undefined ? shared?.get(real) : undefined);
        if (!file) {
          // Each file parses in its own guard: a parser stack overflow (e.g.
          // thousands of nested parentheses) fails that file only.
          try {
            file = ts.createSourceFile(real, text, languageVersion, true);
          } catch (error) {
            failures.set(
              real.slice(1),
              error instanceof RangeError && /call stack/i.test(error.message)
                ? "The TypeScript parser exhausted its stack on this file"
                : `The TypeScript parser threw on this file: ${error instanceof Error ? error.message : String(error)}`,
            );
            requested.add(real.slice(1));
            return undefined;
          }
          // A file that cannot be read is not valid code: it has failed.
          const path = real.slice(1);
          const errors =
            ((file as ts.SourceFile & { parseDiagnostics?: unknown[] })
              .parseDiagnostics?.length ?? 0) > 0 ||
            heritageErrors(file).length > 0;
          const failure = errors
            ? syntaxFailure(path, originals.get(path) ?? text)
            : undefined;
          if (failure) {
            syntaxFailures.set(path, failure);
            failures.set(
              path,
              "This file has a syntax error: it is not valid code",
            );
            requested.add(path);
            return undefined;
          }
        }
        sources.set(real, file);
        return file;
      },
      getDefaultLibLocation: () => LIB_ROOT,
      getDefaultLibFileName: (options) =>
        `${LIB_ROOT}/${ts.getDefaultLibFileName(options)}`,
      writeFile() {
        throw Error("The snapshot compiler host never writes");
      },
      getCurrentDirectory: () =>
        group.config ? posix.dirname(toVirtual(group.config)) : "/",
      getCanonicalFileName: (name) => name,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
      fileExists: (name) =>
        name.startsWith(LIB_ROOT + "/")
          ? libFile(name) !== undefined
          : fs.fileExists(name),
      readFile: (name) =>
        name.startsWith(LIB_ROOT + "/")
          ? libFile(name)?.text
          : fs.readFile(name),
      directoryExists: (name) => name === LIB_ROOT || fs.directoryExists(name),
      getDirectories: (name) => fs.entries(fs.real(name)).directories,
      realpath: (name) => fs.real(name),
    };
    caches.set(created, sources);
    asked.set(created, requested);
    return created;
  };
  return {
    groups,
    owner,
    ties,
    failures,
    renames,
    fresh,
    parseFailures,
    syntaxFailures,
    requested: (host) => asked.get(host) ?? new Set(),
    failSyntax: (path, extra) => {
      if (syntaxFailures.has(path)) return false;
      const failure = syntaxFailure(path, originals.get(path) ?? "", extra);
      if (!failure) return false;
      syntaxFailures.set(path, failure);
      parseFailures.set(
        path,
        "This file has a syntax error: it is not valid code",
      );
      return true;
    },
    host,
  };
}
