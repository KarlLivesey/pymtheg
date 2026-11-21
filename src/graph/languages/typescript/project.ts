// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { entryBuildContext } from "./entry-build.js";
import { createRequire } from "node:module";
import { dirname, posix } from "node:path";
import ts from "typescript";
import { compare, matchesPattern } from "../../index.js";
import type { ContextFile, Diagnostic, GraphFile } from "../../types.js";
import type { DependencyInputs } from "../../dependency-inputs.js";
import { denoConfigPatterns, denoImports, importMapNames } from "./deno.js";
import {
  workspaceLinks,
  type Manifest,
  type WorkspaceCatalogs,
} from "./workspace.js";
import {
  workspaceEntries,
  type OutputProof,
  type UnbuiltEntry,
} from "./workspace-entries.js";
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

export const matchesPathAlias = (text: string, patterns: readonly string[]) =>
  patterns.some((pattern) => {
    const star = pattern.indexOf("*");
    return star < 0
      ? pattern === text
      : text.length >= pattern.length - 1 &&
          text.startsWith(pattern.slice(0, star)) &&
          text.endsWith(pattern.slice(star + 1));
  });

export interface ProjectGroup {
  /** Owning config path, or null for the inferred project (no config includes the file). */
  config: string | null;
  options: ts.CompilerOptions;
  /** The parsed config selected ambient packages before the snapshot host forced defaults. */
  explicitTypes?: boolean;
  references?: readonly ts.ProjectReference[];
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
  dependencyLimit(group: ProjectGroup): boolean;
  groups: ProjectGroup[];
  manifests: readonly Manifest[];
  workspaceRoots: ReadonlySet<string>;
  workspaceBoundaries: ReadonlySet<string>;
  workspaceCatalogs: WorkspaceCatalogs;
  hasWorkspacePackages: boolean;
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
  /**
   * Readable files left out of every program because their project holds
   * more source than one program may (MAX_PROGRAM_SOURCE), with the reason.
   * They are also in `parseFailures`: served to every program as absent.
   */
  omitted: Map<string, string>;
  /**
   * Why this program did not load a checkout file: what it had loaded
   * already would pass MAX_PROGRAM_SOURCE (files it imports count, not only
   * its roots). Only in this program; the file's own project may still
   * read it.
   */
  refusedIn: (group: ProjectGroup, path: string) => string | undefined;
  /** The global names a readable file declares (`declaredGlobalNames`), cached. */
  globalNames: (path: string) => readonly string[];
  /** Failed files a host was asked for (roots or imports): unseen declarations. */
  requested: (host: ts.CompilerHost) => ReadonlySet<string>;
  /** A compiler host over the snapshot; a variant replaces some files' text. */
  host: (group: ProjectGroup, variant?: HostVariant) => ts.CompilerHost;
  unbuiltEntries: (
    host: ts.CompilerHost,
  ) => ReadonlyMap<ts.ResolvedModuleFull, UnbuiltEntry> | undefined;
  workspaceReason: (
    specifier: string,
    from: string,
    lookups: readonly string[],
    includeInstalled?: boolean,
  ) => string | undefined;
  workspaceBoundaryKnown: (from: string) => boolean;
  hasDenoImports: boolean;
  selectSpecifier: (specifier: string, from: string) => string | undefined;
}

/**
 * The most source text (UTF-16 code units of the captured files it owns) one
 * compiler program is given. A program's memory grows with its source: one
 * over 150 million characters does not fit in Node's default heap. A
 * project with more has its largest files left out (failed, with the
 * reason) until the rest fits. A fixed number, so the outcome depends only
 * on the snapshot, never on the machine. See docs/changes/C-13.md.
 */
export const MAX_PROGRAM_SOURCE = 50_000_000;

/** 1234567 -> "1,234,567". */
const grouped = (value: number) =>
  String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

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
  return { diagnostics, names: globalNames(source, text) };
}

/**
 * The global names a file declares (as far as the parser read it): a
 * script's top-level and namespace declarations, and a module's `declare
 * global` blocks. A module's own top-level names are module-scoped: no other
 * file can reach them without importing it. Sorted.
 */
function globalNames(source: ts.SourceFile, text: string): string[] {
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
  return [...names].sort();
}

/**
 * The global names a file without a syntax error declares, from its original
 * text (see `globalNames`); none when the parser cannot read it.
 */
export function declaredGlobalNames(path: string, text: string): string[] {
  const bom = text.startsWith("\uFEFF") ? 1 : 0;
  try {
    const source = ts.createSourceFile(
      toVirtual(path),
      text.slice(bom),
      ts.ScriptTarget.Latest,
      true,
    );
    return globalNames(source, text);
  } catch {
    return [];
  }
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
  plainWorkspaceEntries?: boolean;
}

function forced(options: ts.CompilerOptions): ts.CompilerOptions {
  const result: ts.CompilerOptions = {
    ...options,
    allowJs: true,
    noEmit: true,
    skipLibCheck: true,
    // The host still excludes installed node_modules. Explicit local type
    // roots can supply declarations from the captured snapshot.
    ...(!options.types && !options.typeRoots ? { types: [] } : {}),
    maxNodeModuleJsDepth: 0,
  };
  for (const key of [
    "composite",
    "incremental",
    "tsBuildInfoFile",
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

/** Virtual paths must not turn a host path outside the checkout into a
 * captured input or output by normalizing it against the virtual `/`. */
function scopedConfigPath(config: string, from: string, value: unknown) {
  if (
    typeof value !== "string" ||
    posix.isAbsolute(value) ||
    value.includes("\\") ||
    /^[A-Za-z]:/.test(value)
  )
    return false;
  const checkout = "/__checkout__";
  const token = "${configDir}";
  const path =
    value === token || value.startsWith(token + "/")
      ? posix.resolve(
          checkout,
          posix.dirname(config),
          "." + value.slice(token.length),
        )
      : posix.resolve(checkout, posix.dirname(from), value);
  return path === checkout || path.startsWith(checkout + "/");
}

function scopedEmitOptions(
  config: string,
  from: string,
  object: Record<string, unknown>,
) {
  const options = object.compilerOptions as Record<string, unknown> | undefined;
  const inputs = [object.files, object.include].flatMap((field) =>
    Array.isArray(field) ? field : [],
  );
  const values = [
    options?.outDir,
    options?.outFile,
    options?.rootDir,
    options?.declarationDir,
    ...inputs,
  ];
  return values.every(
    (value) => value === undefined || scopedConfigPath(config, from, value),
  );
}

class VirtualFileSystem {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>(["/"]);
  /** Virtual node_modules/<name> directory -> real workspace package directory. */
  readonly links = new Map<string, string>();
  readonly linkDirectories = new Set<string>();
  readonly outputs = new Set<string>();
  private readonly listings = new Map<
    string,
    { files: string[]; directories: string[] }
  >();
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
    const marker = "/node_modules/";
    for (
      let at = path.lastIndexOf(marker);
      at >= 0;
      at = path.lastIndexOf(marker, at - 1)
    ) {
      const start = at + marker.length;
      let end = path.indexOf("/", start);
      if (path[start] === "@" && end >= 0) end = path.indexOf("/", end + 1);
      const link = end === -1 ? path : path.slice(0, end);
      const target = this.links.get(link);
      if (target !== undefined)
        return end < 0 ? target : posix.join(target, path.slice(end));
      if (at === 0) break;
    }
    return path;
  }
  link(path: string, target: string) {
    this.links.set(path, target);
    for (
      let directory = posix.dirname(path);
      !this.directories.has(directory) && !this.linkDirectories.has(directory);
      directory = posix.dirname(directory)
    )
      this.linkDirectories.add(directory);
  }
  fileExists = (path: string) => this.files.has(this.real(path));
  readFile = (path: string) => this.files.get(this.real(path));
  directoryExists = (path: string) =>
    this.directories.has(this.real(path)) || this.linkDirectories.has(path);
  workspaceRoute(
    specifier: string,
    from: string,
    physicalWorkspace: (link: string) => string | false | undefined,
  ) {
    const name = /^(@[^/]+\/[^/]+|[^/@#.][^/]*)/.exec(specifier)?.[1];
    if (!name) return undefined;
    for (
      let directory = posix.dirname(toVirtual(from));
      ;
      directory = posix.dirname(directory)
    ) {
      const link = posix.join(directory, "node_modules", name);
      const physical = physicalWorkspace(link);
      if (physical === false) return undefined;
      const target = physical ?? this.links.get(link);
      if (target !== undefined)
        return { link, target, installed: physical !== undefined };
      if (directory === "/") return undefined;
    }
  }
  entries = (path: string) => {
    const directory = path === "/" ? "/" : path.replace(/\/$/, "");
    const cached = this.listings.get(directory);
    if (cached) return cached;
    const files: string[] = [];
    const directories: string[] = [];
    for (const file of this.files.keys())
      if (posix.dirname(file) === directory) files.push(posix.basename(file));
    for (const child of this.directories)
      if (child !== directory && posix.dirname(child) === directory)
        directories.push(posix.basename(child));
    const listing = {
      files: files.sort(compare),
      directories: directories.sort(compare),
    };
    this.listings.set(directory, listing);
    return listing;
  };
}

/** Context patterns; also used to tell a missing base from an uncaptured one. */
export const CONTEXT_PATTERNS = [
  "*tsconfig*.json",
  "*jsconfig*.json",
  "package.json",
  "pnpm-workspace.yaml",
  ...entryBuildContext,
  ...denoConfigPatterns,
  ...importMapNames,
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
  dependencies?: DependencyInputs,
  /** The program budget (MAX_PROGRAM_SOURCE; tests pass a small one). */
  budgetCharacters: number = MAX_PROGRAM_SOURCE,
): ProjectModel {
  const programBudget = { characters: budgetCharacters };
  const fs = new VirtualFileSystem();
  const deno = denoImports(contexts);
  for (const file of contexts) fs.add(file.path, file.text);
  const manifests: Manifest[] = [];
  /** Package directory -> why its manifest is unreadable. */
  const brokenManifests = new Map<string, string>();
  const packageDirectories: string[] = [];
  for (const file of contexts)
    if (posix.basename(file.path) === "package.json") {
      const directory = posix.dirname(file.path);
      packageDirectories.push(directory);
      let json: unknown;
      try {
        // A leading byte-order mark is not part of the JSON text (npm and
        // the compiler's own readers ignore it too).
        json = JSON.parse(file.text.replace(/^\uFEFF/, ""));
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
  const workspace = workspaceLinks(manifests, contexts, [
    ...brokenManifests.keys(),
  ]);
  for (const [link, target] of workspace.links) {
    const separation = link.lastIndexOf("node_modules/");
    const name = link.slice(separation + "node_modules/".length);
    let directory = link.slice(0, separation).replace(/\/$/, "") || ".";
    const supplied = () =>
      dependencies?.directoryExists(
        posix.join(directory, "node_modules", name),
      );
    // An install can override a declared workspace dependency, including
    // through a hoisted copy. Keep synthetic links only for absent packages.
    while (directory !== "." && !supplied())
      directory = posix.dirname(directory);
    if (!supplied())
      fs.link(toVirtual(link), target === "." ? "/" : toVirtual(target));
  }
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
  const dependencyPath = (name: string) => fromVirtual(name) ?? "";
  const declarationPath = (name: string) => /\.d\.(?:ts|mts|cts)$/.test(name);
  const dependencyFile = (name: string) =>
    declarationPath(name) || name.endsWith(".json");
  const real = (name: string) => {
    if (fs.files.has(name) || fs.directories.has(name)) return name;
    const installed = dependencies?.realpath(dependencyPath(name));
    if (installed !== undefined) return toVirtual(installed);
    return fs.real(name);
  };
  const fileExists = (name: string) =>
    fs.files.has(real(name)) ||
    (dependencyFile(name) &&
      (dependencies?.fileExists(dependencyPath(name)) ?? false));
  const readFile = (name: string) =>
    fs.files.get(real(name)) ??
    (dependencyFile(name)
      ? dependencies?.read(dependencyPath(name))
      : undefined);
  const directoryExists = (name: string) =>
    fs.directoryExists(name) ||
    (dependencies?.directoryExists(dependencyPath(name)) ?? false);
  let installedConfigRead = false;
  const parseHost: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: true,
    fileExists,
    readFile(name) {
      const text = readFile(name);
      if (
        text !== undefined &&
        !fs.files.has(real(name)) &&
        hasNodeModulesSegment(name)
      )
        installedConfigRead = true;
      return text;
    },
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
  // Reference redirects reuse the parsed snapshot config across programs.
  const parsedConfigs = new Map<string, ts.ParsedCommandLine>();
  const emitConfigs = new Map<string, ts.ParsedCommandLine>();
  const claimed = new Map<string, ProjectGroup[]>();
  const claim = (path: string, group: ProjectGroup) => {
    const list = claimed.get(path) ?? [];
    if (!list.includes(group)) list.push(group);
    claimed.set(path, list);
  };
  const unreadable: ProjectGroup[] = [];
  // Configs another config extends, and configs a project reference names:
  // together they decide which configs are only shared bases (below).
  const extended = new Set<string>();
  const referenced = new Set<string>();
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
    let emitPathsScoped = scopedEmitOptions(config.path, config.path, object);
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
          emitPathsScoped = false;
          outside("from an external package");
          continue;
        }
        emitPathsScoped &&= scopedConfigPath(config.path, from, base);
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
        extended.add(context.path);
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
        const baseConfig = parsed as Record<string, unknown>;
        emitPathsScoped &&= scopedEmitOptions(
          config.path,
          context.path,
          baseConfig,
        );
        pending.push([context.path, baseConfig.extends]);
      }
    }
    // Missing references are recorded without adding roots outside the snapshot.
    for (const reference of Array.isArray(object.references)
      ? object.references
      : []) {
      const value =
        reference && typeof reference === "object"
          ? (reference as { path?: unknown }).path
          : undefined;
      if (typeof value !== "string") {
        group.notes.push(`${config.path}: invalid project reference (ignored)`);
        continue;
      }
      emitPathsScoped &&= scopedConfigPath(config.path, config.path, value);
      const target = posix.normalize(
        posix.join(posix.dirname(toVirtual(config.path)), value),
      );
      const named = fromVirtual(
        fs.fileExists(target) ? target : posix.join(target, "tsconfig.json"),
      );
      if (named !== undefined) referenced.add(named);
      if (
        !fs.fileExists(target) &&
        !fs.fileExists(posix.join(target, "tsconfig.json"))
      )
        group.notes.push(
          `${config.path}: references "${value}", which is missing from the snapshot`,
        );
    }
    if (!syntax) {
      installedConfigRead = false;
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
        if (
          installedConfigRead &&
          !parsed.errors.some(({ code }) => code === 6053 || code === 5083)
        )
          group.limitations = group.limitations.filter(
            (note) =>
              !note.endsWith(
                "node_modules is never captured, so those settings are missing",
              ),
          );
        if (!group.limitations.length) {
          parsedConfigs.set(toVirtual(config.path), parsed);
          if (emitPathsScoped) emitConfigs.set(toVirtual(config.path), parsed);
        }
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
        group.explicitTypes = parsed.options.types !== undefined;
        if (!group.limitations.length)
          for (const output of [
            parsed.options.outDir,
            parsed.options.declarationDir,
          ])
            if (output && output !== posix.dirname(toVirtual(config.path)))
              fs.outputs.add(output);
        if (parsed.projectReferences?.length)
          group.references = parsed.projectReferences.filter((reference) =>
            fs.fileExists(ts.resolveProjectReferencePath(reference)),
          );
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
  // A shared base: a config that other configs extend, that names no files
  // of its own (so the compiler's default selects everything below it), and
  // that no tool opens as a project. The editor opens only `tsconfig.json`
  // and `jsconfig.json` files and the projects they reference; `tsc --build`
  // builds only referenced projects; a package script may name it with
  // `-p`. Such a config is never compiled as a project, so it does not
  // compete for a file that a project config also includes.
  // Config files a package script names (`tsc -p tsconfig.check.json`),
  // resolved from the package directory and any `cd` earlier in the script.
  const scriptConfigs = new Set<string>();
  const runnerConfigs = new Set<string>();
  for (const file of contexts) {
    if (posix.basename(file.path) !== "package.json") continue;
    let scripts: unknown;
    try {
      scripts = (
        JSON.parse(file.text.replace(/^\uFEFF/, "")) as { scripts?: unknown }
      ).scripts;
    } catch {
      continue;
    }
    if (!scripts || typeof scripts !== "object") continue;
    for (const script of Object.values(scripts)) {
      if (typeof script !== "string") continue;
      let directory = posix.dirname(file.path);
      for (const command of script.split(/&&|\|\||;/)) {
        const words = command
          .trim()
          .split(/[\s"'=]+/)
          .filter(Boolean);
        if (words[0] === "cd" && words[1]) {
          directory = posix.normalize(posix.join(directory, words[1]));
          continue;
        }
        for (const word of words)
          if (word.endsWith(".json"))
            scriptConfigs.add(posix.normalize(posix.join(directory, word)));
      }
    }
  }
  // Configs a test runner is told to type-check or compile with: Vitest's
  // `typecheck.tsconfig` and ts-jest's `tsconfig`, in a runner config file or
  // a manifest's `jest` block. Only literal paths are read; a runner config
  // whose `tsconfig` setting is not a literal could name any config, so then
  // no config counts as a shared base.
  let runnerUnreadable = false;
  const runnerPath = (directory: string, value: string) =>
    posix.normalize(posix.join(directory, value.replace(/^<rootDir>\//, "")));
  for (const file of files) {
    const name = posix.basename(file.path);
    if (
      !/^(?:vitest|vite|jest)(?:\.[\w-]+)*\.(?:config|workspace|projects)(?:\.[\w-]+)*\.[cm]?[jt]s$/.test(
        name,
      )
    )
      continue;
    const directory = posix.dirname(file.path);
    // The runner resolves the path from its root, which a config may move.
    const moved = [
      ...file.text.matchAll(/\broot(?:Dir)?\b["']?\s*:\s*([^,}\n]*)/g),
    ].some((match) => !/^["'`]\.?\/?["'`]$/.test(match[1]!.trim()));
    for (const match of file.text.matchAll(/\btsconfig\b["']?\s*:\s*(\S)/g)) {
      const quote = match[1]!;
      const rest = file.text.slice(match.index! + match[0].length);
      const literal =
        quote === '"' || quote === "'" || quote === "`"
          ? new RegExp(`^([^${quote}\\n$]*)${quote}`).exec(rest)?.[1]
          : undefined;
      if (literal === undefined || moved) runnerUnreadable = true;
      else runnerConfigs.add(runnerPath(directory, literal));
    }
  }
  for (const file of contexts) {
    if (posix.basename(file.path) !== "package.json") continue;
    let jest: unknown;
    try {
      jest = (
        JSON.parse(file.text.replace(/^\uFEFF/, "")) as { jest?: unknown }
      ).jest;
    } catch {
      continue;
    }
    const visit = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object")
        for (const [key, item] of Object.entries(value)) {
          if (key === "tsconfig") {
            if (typeof item === "string")
              runnerConfigs.add(runnerPath(posix.dirname(file.path), item));
            else if (item !== false) runnerUnreadable = true;
          } else visit(item);
        }
    };
    visit(jest);
  }
  const sharedBase = (group: ProjectGroup) => {
    const config = group.config;
    if (
      config === null ||
      runnerUnreadable ||
      group.failure ||
      group.explicitSelection ||
      !extended.has(config) ||
      referenced.has(config) ||
      scriptConfigs.has(config) ||
      runnerConfigs.has(config)
    )
      return false;
    const name = posix.basename(config);
    return name !== "tsconfig.json" && name !== "jsconfig.json";
  };
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
    const including = claimed.get(file.path) ?? [];
    const projects = including.filter((group) => !sharedBase(group));
    const candidates = (projects.length ? projects : including).sort((a, b) => {
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
  if (dependencies)
    for (const group of groups) {
      if (group.explicitTypes || group.options.typeRoots || !group.roots.length)
        continue;
      for (
        let directory = group.config ? posix.dirname(group.config) : ".";
        ;
        directory = posix.dirname(directory)
      ) {
        if (
          dependencies.directoryExists(
            posix.join(directory, "node_modules/@types"),
          )
        ) {
          delete group.options.types;
          break;
        }
        if (directory === ".") break;
      }
    }
  const budgets = new Map<
    ProjectGroup,
    { bytes: number; names: Set<string>; limited: boolean }
  >();
  const parseFailures = new Map<string, string>();
  const originals = new Map(files.map((file) => [file.path, file.text]));
  // A project with more source than one program may hold: its largest
  // files (then path order) are left out until the rest fits.
  const omitted = new Map<string, string>();
  for (const group of groups) {
    const size = (root: string) => originals.get(root.slice(1))?.length ?? 0;
    let total = group.roots.reduce((sum, root) => sum + size(root), 0);
    if (total <= programBudget.characters) continue;
    const whole = total;
    const largest = [...group.roots].sort(
      (a, b) => size(b) - size(a) || compare(a, b),
    );
    for (const root of largest) {
      if (total <= programBudget.characters) break;
      const path = root.slice(1);
      total -= size(root);
      if (omitted.has(path)) continue;
      const message = `Not analysed: its TypeScript project (${group.config ?? "the files no tsconfig or jsconfig includes"}) holds ${grouped(whole)} characters of source, more than one compiler program is given (${grouped(programBudget.characters)}); its largest files, this one (${grouped(size(root))} characters) among them, are left out until the rest fits`;
      omitted.set(path, message);
      parseFailures.set(path, message);
    }
  }
  const namesCache = new Map<string, readonly string[]>();
  const syntaxFailures = new Map<string, SyntaxFailure>();
  const caches = new WeakMap<ts.CompilerHost, Map<string, ts.SourceFile>>();
  const asked = new WeakMap<ts.CompilerHost, Set<string>>();
  const entries = workspaceEntries(manifests, emitConfigs, fs.files, originals);
  const redirects = new WeakMap<
    ts.CompilerHost,
    Map<ts.ResolvedModuleFull, UnbuiltEntry>
  >();
  const physicalWorkspace = (link: string): string | false | undefined => {
    const physical = dependencies?.realpath(dependencyPath(link));
    if (physical === undefined) return undefined;
    if (hasNodeModulesSegment(physical)) return false;
    const path = toVirtual(physical);
    return fs.files.has(posix.join(path, "package.json")) ? path : false;
  };
  function workspaceOutput(
    lookup: string,
    route: { link: string; target: string },
  ) {
    if (lookup.startsWith(route.link + "/"))
      return posix.join(route.target, lookup.slice(route.link.length));
    if (lookup.startsWith(route.target === "/" ? "/" : route.target + "/"))
      return lookup;
    return undefined;
  }
  /** Checkout source each program has loaded, and the files it refused. */
  const loads = new Map<
    ProjectGroup,
    { characters: number; names: Set<string>; refused: Map<string, string> }
  >();
  const loadOf = (group: ProjectGroup) => {
    let load = loads.get(group);
    if (!load) {
      load = { characters: 0, names: new Set(), refused: new Map() };
      loads.set(group, load);
    }
    return load;
  };
  const host = (
    group: ProjectGroup,
    variant?: HostVariant,
  ): ts.CompilerHost => {
    const load = loadOf(group);
    const budget = budgets.get(group) ?? {
      bytes: 0,
      names: new Set<string>(),
      limited: false,
    };
    budgets.set(group, budget);
    const sources = new Map<string, ts.SourceFile>();
    const failures = variant?.failures ?? parseFailures;
    const shared = variant?.base && caches.get(variant.base);
    const requested = new Set<string>();
    const created: ts.CompilerHost & {
      useSourceOfProjectReferenceRedirect: () => boolean;
    } = {
      useSourceOfProjectReferenceRedirect: () => true,
      getSourceFile(name, languageVersion) {
        if (name.startsWith(LIB_ROOT + "/")) return libFile(name);
        const path = real(name);
        const override = variant?.texts.get(path.slice(1));
        const captured = override ?? fs.files.get(path);
        if (captured === undefined && dependencies && declarationPath(name)) {
          const cached = sources.get(name) ?? shared?.get(name);
          if (cached) return cached;
          if (budget.limited) return undefined;
          const text = dependencies.read(dependencyPath(name));
          if (text === undefined) return undefined;
          if (!budget.names.has(path)) {
            budget.names.add(path);
            budget.bytes += Buffer.byteLength(text);
            if (budget.bytes > 32 * 1024 * 1024 || budget.names.size > 8_000) {
              budget.limited = true;
              return undefined;
            }
          }
          const source = ts.createSourceFile(name, text, languageVersion, true);
          if (
            (source as ts.SourceFile & { parseDiagnostics?: unknown[] })
              .parseDiagnostics?.length
          )
            return undefined;
          sources.set(name, source);
          return source;
        }
        const text = captured;
        if (text === undefined) return undefined;
        // A file the parser or binder could not handle, or with a syntax
        // error, stays out of every program: it is absent, not empty.
        if (failures.has(path.slice(1))) {
          requested.add(path.slice(1));
          return undefined;
        }
        // The program's budget counts every checkout file it loads, in the
        // order the compiler asks for them; installed declarations have
        // their own budget (above).
        {
          const relative = path.slice(1);
          const size = originals.get(relative)?.length;
          if (size !== undefined && !load.names.has(relative)) {
            if (
              load.refused.has(relative) ||
              load.characters + size > programBudget.characters
            ) {
              if (!load.refused.has(relative))
                load.refused.set(
                  relative,
                  `Not analysed here: the TypeScript program of ${group.config ?? "the files no tsconfig or jsconfig includes"} would load more than ${grouped(programBudget.characters)} characters of checkout source with this file (${grouped(size)} characters); files past that bound, in the order the compiler loads them, are left out of it`,
                );
              requested.add(relative);
              return undefined;
            }
            load.characters += size;
            load.names.add(relative);
          }
        }
        // An unchanged file reuses the base host's parse (and binding).
        let file =
          sources.get(path) ??
          (override === undefined ? shared?.get(path) : undefined);
        if (!file) {
          // Each file parses in its own guard: a parser stack overflow (e.g.
          // thousands of nested parentheses) fails that file only.
          try {
            file = ts.createSourceFile(path, text, languageVersion, true);
          } catch (error) {
            failures.set(
              path.slice(1),
              error instanceof RangeError && /call stack/i.test(error.message)
                ? "The TypeScript parser exhausted its stack on this file"
                : `The TypeScript parser threw on this file: ${error instanceof Error ? error.message : String(error)}`,
            );
            requested.add(path.slice(1));
            return undefined;
          }
          // A file that cannot be read is not valid code: it has failed.
          const relative = path.slice(1);
          const errors =
            ((file as ts.SourceFile & { parseDiagnostics?: unknown[] })
              .parseDiagnostics?.length ?? 0) > 0 ||
            heritageErrors(file).length > 0;
          const failure = errors
            ? syntaxFailure(relative, originals.get(relative) ?? text)
            : undefined;
          if (failure) {
            syntaxFailures.set(relative, failure);
            failures.set(
              relative,
              "This file has a syntax error: it is not valid code",
            );
            requested.add(relative);
            return undefined;
          }
        }
        sources.set(path, file);
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
          : fileExists(name),
      readFile: (name) =>
        name.startsWith(LIB_ROOT + "/") ? libFile(name)?.text : readFile(name),
      directoryExists: (name) => name === LIB_ROOT || directoryExists(name),
      getDirectories: (name) => {
        const captured = fs.entries(fs.real(name)).directories;
        const installed = dependencies?.directories(dependencyPath(name)) ?? [];
        return installed.length
          ? [...new Set([...captured, ...installed])]
          : captured;
      },
      readDirectory: (...args) => [...parseHost.readDirectory(...args)],
      getParsedCommandLine(name) {
        const parsed = parsedConfigs.get(fs.real(name));
        return parsed && entries.forReference(parsed);
      },
      realpath: real,
    };
    const workspaceRecovery = entries.available && !group.limitations.length;
    if (deno.active || workspaceRecovery) {
      const cache = ts.createModuleResolutionCache(
        created.getCurrentDirectory(),
        (name) => name,
        group.options,
      );
      if (!deno.active) created.getModuleResolutionCache = () => cache;
      created.resolveModuleNameLiterals = (
        literals,
        containingFile,
        redirected,
        options,
        source,
      ) =>
        literals.map((literal) => {
          const selected = deno.select(
            literal.text,
            fromVirtual(containingFile) ?? ".",
          );
          if (selected === undefined) return { resolvedModule: undefined };
          const importingOptions = redirected?.commandLine.options ?? options;
          const mode = ts.getModeForUsageLocation(
            source,
            literal,
            deno.active ? options : importingOptions,
          );
          const result = ts.resolveModuleName(
            selected,
            containingFile,
            options,
            created,
            deno.active ? undefined : cache,
            redirected,
            mode,
          );
          // The checker uses this flag to diagnose a TypeScript extension in
          // the written literal. A map can supply an extension the literal lacks.
          if (
            selected !== literal.text &&
            result.resolvedModule?.resolvedUsingTsExtension
          )
            result.resolvedModule.resolvedUsingTsExtension = false;
          if (!workspaceRecovery || selected !== literal.text) return result;
          const resolved = result.resolvedModule;
          if (
            resolved &&
            (fileExists(resolved.resolvedFileName) || !group.references?.length)
          )
            return result;
          const from = fromVirtual(containingFile);
          if (from === undefined) return result;
          const route = fs.workspaceRoute(selected, from, physicalWorkspace);
          if (!route) return result;
          const lookups = (
            result as ts.ResolvedModuleWithFailedLookupLocations & {
              failedLookupLocations?: readonly string[];
            }
          ).failedLookupLocations;
          const redirect = (proof: UnbuiltEntry): ts.ResolvedModuleFull => {
            const target: ts.ResolvedModuleFull = {
              resolvedFileName: toVirtual(proof.source),
              isExternalLibraryImport: false,
              extension: posix.extname(proof.source),
            };
            let notes = redirects.get(created);
            if (!notes) redirects.set(created, (notes = new Map()));
            notes.set(target, proof);
            return target;
          };
          if (resolved) {
            const output = workspaceOutput(resolved.resolvedFileName, route);
            if (!output) return result;
            const proof = entries.proof(route.target, output, true);
            if (proof === "conflicting")
              return {
                ...result,
                resolvedModule: undefined,
                failedLookupLocations: [
                  resolved.resolvedFileName,
                  ...(lookups ?? []),
                ],
              };
            // Native references already give the checker its source program.
            // Only the plain-build proof earns new unbuilt-entry provenance.
            if (!proof) return result;
            return {
              ...result,
              resolvedModule: redirect({
                ...proof,
                proof: "project-reference",
              }),
            };
          }
          if (
            matchesPathAlias(
              selected,
              Object.keys(importingOptions.paths ?? {}),
            )
          )
            return result;
          const candidates = new Map<string, OutputProof>();
          const missingOutput = (lookup: string) => {
            // Only failed probes through the selected package link, never a
            // missing paths alias or an unrelated relative import.
            if (!lookup.startsWith(route.link + "/")) return undefined;
            if (
              route.installed &&
              dependencies?.realpath(dependencyPath(lookup)) !== undefined
            )
              return undefined;
            return workspaceOutput(lookup, route);
          };
          for (const lookup of lookups ?? []) {
            const output = missingOutput(lookup);
            if (!output) continue;
            const proof = entries.proof(
              route.target,
              output,
              variant?.plainWorkspaceEntries === true,
            );
            if (proof !== undefined) candidates.set(lookup, proof);
          }
          if (
            ![...candidates.values()].some((proof) => typeof proof === "object")
          )
            return result;
          // Expose missing explicit entries to the retry even when we have no
          // source for them. A later condition cannot displace the selected
          // declaration entry merely because the latter has no proof.
          for (const lookup of lookups ?? []) {
            if (candidates.has(lookup)) continue;
            const output = missingOutput(lookup);
            if (output && entries.explicitEntry(route.target, output))
              candidates.set(lookup, false);
          }
          const directories = new Set<string>();
          for (const lookup of candidates.keys()) {
            for (
              let dir = posix.dirname(lookup);
              dir !== route.link;
              dir = posix.dirname(dir)
            )
              directories.add(dir);
          }
          // Let TypeScript choose the entry and condition in the original
          // mode. The overlay is scoped to this lookup and has no file bodies.
          const retry = ts.resolveModuleName(
            selected,
            containingFile,
            options,
            {
              ...created,
              fileExists: (name) =>
                candidates.has(name) || created.fileExists(name),
              directoryExists: (name) =>
                directories.has(name) || created.directoryExists!(name),
              realpath: (name) =>
                candidates.has(name) ? name : created.realpath!(name),
            },
            undefined,
            redirected,
            mode,
          );
          const chosen = retry.resolvedModule;
          const proof = chosen && candidates.get(chosen.resolvedFileName);
          if (!chosen || !proof || typeof proof !== "object") return result;
          return { ...retry, resolvedModule: redirect(proof) };
        });
    }
    caches.set(created, sources);
    asked.set(created, requested);
    return created;
  };
  return {
    dependencyLimit: (group) => budgets.get(group)?.limited ?? false,
    groups,
    manifests,
    workspaceRoots: new Set(workspace.links.values()),
    workspaceBoundaries: workspace.boundaries,
    workspaceCatalogs: workspace.catalogs,
    hasWorkspacePackages: fs.links.size > 0,
    hasDenoImports: deno.active,
    selectSpecifier: deno.select,
    owner,
    ties,
    failures,
    renames,
    fresh,
    parseFailures,
    syntaxFailures,
    requested: (host) => asked.get(host) ?? new Set(),
    omitted,
    refusedIn: (group, path) => loads.get(group)?.refused.get(path),
    globalNames: (path) => {
      let names = namesCache.get(path);
      if (!names) {
        names = declaredGlobalNames(path, originals.get(path) ?? "");
        namesCache.set(path, names);
      }
      return names;
    },
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
    unbuiltEntries: (host) => redirects.get(host),
    workspaceReason(specifier, from, lookups, includeInstalled = true) {
      const route = fs.workspaceRoute(
        specifier,
        from,
        includeInstalled ? physicalWorkspace : () => undefined,
      );
      if (!route) return undefined;
      const missingOutput = lookups.some((lookup) => {
        const output = workspaceOutput(lookup, route);
        if (!output || fs.files.has(output)) return false;
        for (
          let dir = posix.dirname(output);
          dir !== route.target && dir !== "/";
          dir = posix.dirname(dir)
        )
          if (fs.outputs.has(dir)) return true;
        return false;
      });
      return missingOutput
        ? "workspace-build-output-missing"
        : "workspace-entry-unavailable";
    },
    workspaceBoundaryKnown: (from) => {
      for (const root of workspace.incompleteRoots)
        if (underDirectory(from, root)) return false;
      return true;
    },
  };
}
