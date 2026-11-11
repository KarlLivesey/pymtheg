import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, posix } from "node:path";
import ts from "typescript";
import { compare, matchesPattern } from "../../index.js";
import type { ContextFile, GraphFile } from "../../types.js";

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
}
export interface ProjectModel {
  groups: ProjectGroup[];
  owner: Map<string, ProjectGroup>;
  host: (group: ProjectGroup) => ts.CompilerHost;
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
/** Options the snapshot analysis always overrides; recorded in the change note. */
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

/**
 * Builds the project model. Throws (an analysis error) for unparsable configs or
 * package manifests and for configs that extend or reference a project path that
 * is not in the snapshot.
 */
export function projectModel(
  files: readonly GraphFile[],
  contexts: readonly ContextFile[],
): ProjectModel {
  const fs = new VirtualFileSystem();
  for (const file of files) fs.add(file.path, file.text);
  for (const file of contexts) fs.add(file.path, file.text);
  const manifests: { path: string; json: Record<string, unknown> }[] = [];
  for (const file of contexts)
    if (posix.basename(file.path) === "package.json") {
      let json: unknown;
      try {
        json = JSON.parse(file.text);
      } catch (error) {
        throw Error(
          `Unreadable package manifest ${file.path}: ${(error as Error).message}`,
        );
      }
      if (json === null || typeof json !== "object" || Array.isArray(json))
        throw Error(`Unreadable package manifest ${file.path}: not an object`);
      manifests.push({
        path: file.path,
        json: json as Record<string, unknown>,
      });
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
  const configs = contexts
    .filter((file) => isConfig(file.path))
    .sort((a, b) => compare(a.path, b.path));
  for (const config of configs) {
    const source = ts.parseJsonText(toVirtual(config.path), config.text);
    const syntax = (
      source as ts.TsConfigSourceFile & {
        parseDiagnostics?: readonly ts.Diagnostic[];
      }
    ).parseDiagnostics;
    if (syntax?.length)
      throw Error(
        `Unreadable TypeScript config ${config.path}: ${ts.flattenDiagnosticMessageText(syntax[0]!.messageText, " ")}`,
      );
    const raw = ts.convertToObject(source, []) as Record<
      string,
      unknown
    > | null;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
      throw Error(`Unreadable TypeScript config ${config.path}: not an object`);
    const limitations: string[] = [];
    // Follow the extends chain ourselves first so missing bases are classified, not ignored.
    const pending: [string, unknown][] = [[config.path, raw.extends]];
    const seen = new Set<string>();
    while (pending.length) {
      const [from, value] = pending.pop()!;
      for (const base of (Array.isArray(value)
        ? value
        : value === undefined
          ? []
          : [value]) as unknown[]) {
        if (typeof base !== "string")
          throw Error(`TypeScript config ${from} has an invalid extends value`);
        if (!isRelativeReference(base)) {
          limitations.push(
            `${from} extends "${base}" from an external package; node_modules is never captured, so those settings are missing`,
          );
          continue;
        }
        let target = posix.normalize(
          posix.join(posix.dirname(toVirtual(from)), base),
        );
        if (!fs.fileExists(target) && fs.fileExists(target + ".json"))
          target += ".json";
        const path = fromVirtual(target);
        const context = contexts.find((file) => file.path === path);
        if (!context)
          throw Error(
            `TypeScript config ${from} extends "${base}", which is missing from the snapshot`,
          );
        if (seen.has(context.path)) continue;
        seen.add(context.path);
        let parsed: unknown;
        try {
          parsed = ts.convertToObject(
            ts.parseJsonText(toVirtual(context.path), context.text),
            [],
          );
        } catch {
          parsed = undefined;
        }
        pending.push([
          context.path,
          parsed && typeof parsed === "object"
            ? (parsed as Record<string, unknown>).extends
            : undefined,
        ]);
      }
    }
    for (const reference of Array.isArray(raw.references)
      ? raw.references
      : []) {
      const value =
        reference && typeof reference === "object"
          ? (reference as { path?: unknown }).path
          : undefined;
      if (typeof value !== "string")
        throw Error(
          `TypeScript config ${config.path} has an invalid project reference`,
        );
      const target = posix.normalize(
        posix.join(posix.dirname(toVirtual(config.path)), value),
      );
      if (
        !fs.fileExists(target) &&
        !fs.fileExists(posix.join(target, "tsconfig.json"))
      )
        throw Error(
          `TypeScript config ${config.path} references "${value}", which is missing from the snapshot`,
        );
    }
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
    const notes = parsed.errors
      // 18003: "No inputs were found" is a normal state for solution-style configs.
      // 6053: "File not found" for a node_modules extends, already a limitation above.
      .filter((error) => error.code !== 18003 && error.code !== 6053)
      .map(
        (error) =>
          `${config.path}: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`,
      );
    const group: ProjectGroup = {
      config: config.path,
      options: forced(parsed.options),
      roots: [],
      limitations,
      notes,
    };
    groups.push(group);
    for (const name of parsed.fileNames) {
      const path = fromVirtual(name);
      if (path !== undefined)
        claimed.set(path, [...(claimed.get(path) ?? []), group]);
    }
  }
  const owner = new Map<string, ProjectGroup>();
  let inferred: ProjectGroup | undefined;
  for (const file of [...files].sort((a, b) => compare(a.path, b.path))) {
    const candidates = (claimed.get(file.path) ?? []).sort((a, b) => {
      const depth = (group: ProjectGroup) =>
        posix.dirname(group.config!).split("/").length;
      return (
        depth(b) - depth(a) ||
        configPreference(a.config!) - configPreference(b.config!) ||
        compare(a.config!, b.config!)
      );
    });
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
    group.roots.push(toVirtual(file.path));
    owner.set(file.path, group);
  }
  if (inferred) groups.push(inferred);
  const host = (group: ProjectGroup): ts.CompilerHost => {
    const sources = new Map<string, ts.SourceFile>();
    return {
      getSourceFile(name, languageVersion) {
        if (name.startsWith(LIB_ROOT + "/")) return libFile(name);
        const real = fs.real(name);
        const text = fs.files.get(real);
        if (text === undefined) return undefined;
        let file = sources.get(real);
        if (!file) {
          file = ts.createSourceFile(real, text, languageVersion, true);
          sources.set(real, file);
        }
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
  };
  return { groups, owner, host };
}
