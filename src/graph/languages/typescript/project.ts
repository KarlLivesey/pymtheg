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
  /** Why this config is unusable; every file it owns is failed with this message. */
  failure?: string;
}
export interface ProjectModel {
  groups: ProjectGroup[];
  owner: Map<string, ProjectGroup>;
  /** Files failed by a broken config or package manifest, with the cause. */
  failures: Map<string, string>;
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
  for (const file of files) fs.add(file.path, file.text);
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
        pending.push([
          context.path,
          parsed && typeof parsed === "object"
            ? (parsed as Record<string, unknown>).extends
            : undefined,
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
      // A broken config still claims whatever its own file list names.
      for (const name of parsed.fileNames) {
        const path = fromVirtual(name);
        if (path !== undefined) claim(path, group);
      }
    }
    // A broken config could own anything below its directory.
    if (group.failure)
      for (const file of files)
        if (underDirectory(file.path, posix.dirname(config.path)))
          claim(file.path, group);
  }
  const owner = new Map<string, ProjectGroup>();
  const failures = new Map<string, string>();
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
    owner.set(file.path, group);
    // The nearest package manifest governs a file; a broken one fails just its package.
    const manifest = packageDirectories
      .filter((directory) => underDirectory(file.path, directory))
      .sort((a, b) => b.split("/").length - a.split("/").length)[0];
    const failure =
      group.failure ??
      (manifest === undefined ? undefined : brokenManifests.get(manifest));
    if (failure) failures.set(file.path, failure);
    else group.roots.push(toVirtual(file.path));
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
  return { groups, owner, failures, host };
}
