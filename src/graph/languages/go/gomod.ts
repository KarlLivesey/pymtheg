// SPDX-License-Identifier: MIT
import { posix } from "node:path";
import type { ContextFile } from "../../types.js";

/** A module path mapped to a project directory ("" is the project root). */
export interface GoModuleRoot {
  directory: string;
  path: string;
  /** A version-specific `replace` applies only to that version. */
  version?: string;
}
/**
 * A `replace` directive. `directory`: its destination inside the project; absent
 * when the destination is a module path (outside the project) or a directory
 * outside it. Every directive is kept, so precedence is decided before the
 * destination is looked at.
 */
export interface GoReplacement {
  path: string;
  version?: string;
  directory?: string;
  /** The destination is a filesystem path (relative or absolute), not a module path. */
  filesystem?: true;
}
/** A go.mod in the snapshot, with its requirements and `replace` directives. */
export interface GoModule extends GoModuleRoot {
  replacements: GoReplacement[];
  /** `require` path -> version, as written. */
  requires: Map<string, string>;
  /** The `go` directive, as written (absent: none). */
  go?: string;
}
/** A go.work in the snapshot: its `use` directories and its local replacements. */
export interface GoWorkspace {
  directory: string;
  uses: string[];
  replacements: GoReplacement[];
  /**
   * A `use` directory is outside the checkout: that main module's
   * requirements are not seen, so no selected version is proven.
   */
  outside?: true;
}
export interface GoProjectLayout {
  /** Deepest directory first, so the first enclosing module is the nearest. */
  modules: GoModule[];
  workspaces: GoWorkspace[];
}

const strip = (line: string) => line.replace(/\/\/.*$/, "").trim();
const unquote = (value: string) =>
  /^".*"$|^`.*`$/.test(value) ? value.slice(1, -1) : value;

/** Splits go.mod/go.work text into directives, expanding `verb ( ... )` blocks. */
function directives(text: string): { verb: string; args: string }[] {
  const output: { verb: string; args: string }[] = [];
  let block: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = strip(raw);
    if (!line) continue;
    if (block !== undefined) {
      if (line === ")") block = undefined;
      else output.push({ verb: block, args: line });
      continue;
    }
    const match = /^(\S+)\s*(.*)$/.exec(line)!;
    if (match[2] === "(") block = match[1]!;
    else output.push({ verb: match[1]!, args: match[2]!.trim() });
  }
  return output;
}

export const directoryOf = (path: string) => {
  const directory = posix.dirname(path);
  return directory === "." ? "" : directory;
};
/** Joins a project-relative directory with a relative path; undefined if it leaves the project. */
export function joinDirectory(
  base: string,
  relative: string,
): string | undefined {
  // `examples/../` normalizes to `./`: the project root, "" like `.`.
  const joined = posix
    .normalize(posix.join(base || ".", relative))
    .replace(/(.)\/$/, "$1");
  if (joined === ".." || joined.startsWith("../") || posix.isAbsolute(joined))
    return undefined;
  return joined === "." ? "" : joined;
}
/** `directory` is `root` or below it. */
export const within = (directory: string, root: string): boolean =>
  root === "" || directory === root || directory.startsWith(`${root}/`);

/**
 * A directive's operands: whitespace-separated (`=>` is its own), a quoted
 * operand (`"a b"` or a raw string) whole and unquoted.
 */
export function operands(args: string): string[] {
  const out: string[] = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|`([^`]*)`|(=>|(?:[^\s"`=]|=(?!>))+)/g;
  for (const match of args.matchAll(pattern))
    out.push(
      match[1] !== undefined
        ? match[1].replace(/\\(.)/g, "$1")
        : (match[2] ?? match[3]!),
    );
  return out;
}

function replacement(
  directory: string,
  args: string,
): GoReplacement | undefined {
  const parts = operands(args);
  const arrow = parts.indexOf("=>");
  if (arrow < 0) return undefined;
  const fromPath = parts[0] ?? "";
  const version = arrow > 1 ? parts[1] : undefined;
  const toPath = parts[arrow + 1] ?? "";
  if (!fromPath || !toPath) return undefined;
  // A directory path, as Go reads one (modfile.IsDirectoryPath): `.`, `..`,
  // or beginning with `./` or `../` (gopls: `replace golang.org/x/tools => ..`).
  const local =
    toPath === "." ||
    toPath === ".." ||
    toPath.startsWith("./") ||
    toPath.startsWith("../");
  // A module path, or a directory leaving the project: outside (no directory).
  const target = local ? joinDirectory(directory, toPath) : undefined;
  // Any filesystem path, relative or absolute (`/src/x`, `C:\x`): the
  // package may be checkout code, so never a library target (C-14).
  const filesystem =
    local ||
    toPath.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(toPath) ||
    toPath.startsWith("\\");
  return {
    path: fromPath,
    ...(version ? { version } : {}),
    ...(target === undefined ? {} : { directory: target }),
    ...(filesystem ? { filesystem: true as const } : {}),
  };
}

export function readLayout(
  contextFiles: readonly ContextFile[],
): GoProjectLayout {
  const layout: GoProjectLayout = { modules: [], workspaces: [] };
  for (const file of contextFiles) {
    if (file.status !== "clean") continue;
    const directory = directoryOf(file.path);
    const name = posix.basename(file.path);
    const replacements: GoReplacement[] = [];
    const requires = new Map<string, string>();
    const uses: string[] = [];
    let path: string | undefined;
    let go: string | undefined;
    let outside = false;
    for (const { verb, args } of directives(file.text)) {
      if (verb === "module" && name === "go.mod")
        path = unquote(args.split(/\s+/)[0] ?? "") || undefined;
      else if (verb === "go" && name === "go.mod")
        go = args.split(/\s+/)[0] || undefined;
      else if (verb === "require") {
        const [path, version] = args.split(/\s+/);
        if (path && version) requires.set(unquote(path), version);
      } else if (verb === "replace") {
        const item = replacement(directory, args);
        if (item) replacements.push(item);
      } else if (verb === "use" && name === "go.work") {
        const used = operands(args)[0] ?? "";
        // An absolute path (`/src/m`, `C:\m`) is never a checkout
        // directory, whatever it joins to.
        const absolute =
          used.startsWith("/") ||
          used.startsWith("\\") ||
          /^[A-Za-z]:[\\/]/.test(used);
        const target = absolute ? undefined : joinDirectory(directory, used);
        if (target !== undefined) uses.push(target);
        // A module outside the checkout: its requirements are unseen.
        else outside = true;
      }
    }
    if (name === "go.mod" && path !== undefined)
      layout.modules.push({
        directory,
        path,
        replacements,
        requires,
        ...(go === undefined ? {} : { go }),
      });
    if (name === "go.work")
      layout.workspaces.push({
        directory,
        uses,
        replacements,
        ...(outside ? { outside: true as const } : {}),
      });
  }
  const order = (a: { directory: string }, b: { directory: string }) =>
    b.directory.length - a.directory.length ||
    (a.directory < b.directory ? -1 : a.directory > b.directory ? 1 : 0);
  layout.modules.sort(order);
  layout.workspaces.sort(order);
  return layout;
}

/** The module owning a project directory: the nearest enclosing go.mod. */
export function moduleOf(
  layout: GoProjectLayout,
  directory: string,
): GoModule | undefined {
  return layout.modules.find((item) => within(directory, item.directory));
}

/** The import path of a project directory: nearest enclosing go.mod module. */
export function importPathOf(
  layout: GoProjectLayout,
  directory: string,
): string | undefined {
  const module = moduleOf(layout, directory);
  if (!module) return undefined;
  const rest =
    module.directory === ""
      ? directory
      : directory.slice(module.directory.length + 1);
  return rest ? `${module.path}/${rest}` : module.path;
}

/**
 * The modules that may provide an import path's package, as the go command
 * finds them from the importing directory's own module (checked with Go
 * 1.27.4, `evidence/c-8/go-import-rules.sh`):
 * - its main module(s) (the importer's module, or every `use`d module of a
 *   go.work listing it), each for the directory below it that is not inside
 *   another, nested module;
 * - every module the main modules require, through its replacement (a
 *   go.work replace before the modules' own; a version-specific one of the
 *   selected version before an unversioned one). A `replace` of a module
 *   that is not required does nothing ("replaced but not required"); with a
 *   main module before module graph pruning (go < 1.17) a dependency may
 *   still require it, so it is then a possibility, never proven. A local
 *   replacement counts only when its directory has a captured go.mod (Go
 *   fails reading it otherwise); an unreplaced module comes from the module
 *   cache (outside), unless the package lies in a main module nested under
 *   it (a module's zip leaves nested modules out).
 * Whether a provider really has the package (a directory with a buildable
 * file) is for the caller to decide: two that have it are an ambiguous
 * import, which Go rejects.
 */
export interface ImportProvider {
  /** The module path. */
  path: string;
  /** Possible project directories of the package in this module. */
  directories: string[];
  /**
   * Not proven: the package may come from outside the project (module cache,
   * a destination outside it, or no captured go.mod at the replacement), or
   * the module may not be in the build at all. Several `directories` without
   * this: which captured replacement applies is unproven (a candidate set).
   */
  uncertain: boolean;
  /** A main module of the build requires this module path. */
  required?: boolean;
  /** A `replace` applies, so the package is not the required module version. */
  replaced?: boolean;
  /** A destination of the module is a directory inside the project. */
  local?: boolean;
  /**
   * The selected version, when proven (required, not replaced, see
   * `selectedVersion`), and the main go.mod that states it.
   */
  version?: string;
  versionSource?: string;
}
export interface ImportDestinations {
  /** Every possible project directory of the package (all providers). */
  directories: string[];
  /** A possible destination is outside the project, or one is not proven. */
  outside: boolean;
  providers: ImportProvider[];
  /** Every main module has module graph pruning (go 1.17 or later). */
  pruned?: boolean;
}

export function directoryOfImport(
  layout: GoProjectLayout,
  importerDirectory: string,
  importPath: string,
): ImportDestinations {
  const own = moduleOf(layout, importerDirectory);
  if (!own) return { directories: [], outside: true, providers: [] };
  const workspace = layout.workspaces.find(
    (item) =>
      within(own.directory, item.directory) &&
      item.uses.includes(own.directory),
  );
  const mains = workspace
    ? layout.modules.filter((module) =>
        workspace.uses.includes(module.directory),
      )
    : [own];
  // The version Go selects: the maximum required version across the build's main
  // modules (since Go 1.17 the main go.mod lists every dependency at its selected
  // version, and a build whose requirements were raised fails until it does).
  // Not proven (undefined) when no main module requires the path, when a version
  // cannot be parsed, when another captured go.mod requires a higher version
  // (the main requirement is then stale and selection may be higher), or when a
  // main module's `go` directive is absent or below 1.17 (before graph pruning
  // the main go.mod need not list indirect requirements).
  const pruned = mains.every((main) => prunedGraph(main.go));
  const selectedVersion = (path: string): string | undefined => {
    if (!pruned || workspace?.outside) return undefined;
    let best: string | undefined;
    for (const main of mains) {
      const version = main.requires.get(path);
      if (version === undefined) continue;
      if (!parseVersion(version)) return undefined;
      if (best === undefined || compareVersions(version, best) > 0)
        best = version;
    }
    if (best === undefined) return undefined;
    for (const module of layout.modules) {
      if (mains.includes(module)) continue;
      const version = module.requires.get(path);
      if (
        version !== undefined &&
        (!parseVersion(version) || compareVersions(version, best) > 0)
      )
        return undefined;
    }
    return best;
  };
  // The replacements of one path from one source (a go.work, or the main modules):
  // a version-specific replacement of the selected version wins over an
  // unversioned one, whatever their order; with the version unproven, every
  // replacement that could apply is a candidate.
  // A destination outside the project (the module cache): a replacement with no
  // directory, so it is kept as a candidate.
  const cache = (path: string): GoReplacement => ({ path });
  const pick = (items: GoReplacement[]): GoReplacement[] => {
    if (!items.length) return [];
    const plain = items.filter((item) => item.version === undefined);
    const versioned = items.filter((item) => item.version !== undefined);
    if (!versioned.length) return plain;
    const selected = selectedVersion(items[0]!.path);
    if (selected === undefined)
      // Without a plain replacement the package may come from the module cache.
      return plain.length
        ? [...plain, ...versioned]
        : [...versioned, cache(items[0]!.path)];
    const hit = versioned.filter((item) => item.version === selected);
    return hit.length ? hit : plain;
  };
  const byPath = (items: GoReplacement[]) => {
    const out = new Map<string, GoReplacement[]>();
    for (const item of items)
      out.set(item.path, [...(out.get(item.path) ?? []), item]);
    return out;
  };
  const fromMains = byPath(mains.flatMap((main) => main.replacements));
  const fromWork = byPath(workspace?.replacements ?? []);
  const matches = (path: string) =>
    importPath === path || importPath.startsWith(`${path}/`);
  const below = (root: string, path: string) =>
    joinDirectory(root, importPath.slice(path.length + 1) || ".");
  const providers: ImportProvider[] = [];
  // The main modules: the package's directory, unless a nested module owns it.
  for (const main of mains) {
    if (!matches(main.path)) continue;
    const directory = below(main.directory, main.path);
    if (directory !== undefined && moduleOf(layout, directory) === main)
      providers.push({
        path: main.path,
        directories: [directory],
        uncertain: false,
      });
  }
  // The modules the main modules require (or, before pruning, may require),
  // through their replacements.
  const mainPaths = new Set(mains.map((main) => main.path));
  const paths = new Set([
    ...mains.flatMap((main) => [...main.requires.keys()]),
    ...fromMains.keys(),
    ...fromWork.keys(),
  ]);
  for (const path of [...paths].sort()) {
    if (!matches(path) || mainPaths.has(path)) continue;
    const required = mains.some((main) => main.requires.has(path));
    // Replaced but not required: not in the build (Go: "replaced but not
    // required"), unless an unlisted dependency may require it.
    if (!required && pruned) continue;
    // A go.work replacement of a path overrides the modules' replacements of
    // the same path (or version); when none of its replacements applies, the
    // modules' replacements still do.
    const work = pick(fromWork.get(path) ?? []);
    const replaced = work.length ? work : pick(fromMains.get(path) ?? []);
    const roots = replaced.length ? replaced : [cache(path)];
    const directories: string[] = [];
    let uncertain = !required;
    const local = roots.some(
      (root) => root.directory !== undefined || root.filesystem,
    );
    let version: string | undefined;
    let versionSource: string | undefined;
    // In a workspace another module's requirement can raise the selected
    // version: only one that every requiring workspace module names is proven.
    const agreed =
      !workspace ||
      new Set(
        layout.modules
          .filter((module) => workspace.uses.includes(module.directory))
          .map((module) => module.requires.get(path))
          .filter((version) => version !== undefined),
      ).size <= 1;
    if (required && !replaced.length && agreed) {
      version = selectedVersion(path);
      const main = mains.find(
        (item) => version !== undefined && item.requires.get(path) === version,
      );
      versionSource = main
        ? main.directory
          ? `${main.directory}/go.mod`
          : "go.mod"
        : undefined;
      if (versionSource === undefined) version = undefined;
    }
    for (const root of roots) {
      if (root.directory === undefined) {
        // The module cache: a main module nested under this module's path
        // holds the package, and the module's zip leaves it out.
        if (
          mains.some(
            (main) => main.path.startsWith(`${path}/`) && matches(main.path),
          )
        )
          continue;
        uncertain = true;
        continue;
      }
      // Go reads the replacement's go.mod; without one the build fails.
      if (
        !layout.modules.some((module) => module.directory === root.directory)
      ) {
        uncertain = true;
        continue;
      }
      const directory = below(root.directory, path);
      if (directory === undefined) {
        uncertain = true;
        continue;
      }
      // A directory inside a module nested below the replacement is not part
      // of this module.
      const owner = moduleOf(layout, directory);
      if (owner && owner.directory !== root.directory) continue;
      directories.push(directory);
    }
    if (directories.length || uncertain)
      providers.push({
        path,
        directories: unique(directories),
        uncertain,
        required,
        ...(replaced.length ? { replaced: true } : {}),
        ...(local ? { local: true } : {}),
        ...(version !== undefined && versionSource !== undefined
          ? { version, versionSource }
          : {}),
      });
  }
  return {
    directories: unique(providers.flatMap((item) => item.directories)),
    outside: providers.some((item) => item.uncertain),
    providers,
    pruned,
  };
}

/**
 * The first path elements of the Go standard library's importable packages
 * (Go 1.27; `internal`, `vendor`, `cmd` and the documentation-only `builtin`
 * are left out: a project file cannot import them as library code). Go
 * treats an import path whose first element has no dot as standard library;
 * this list keeps a GOPATH-style test-data import (`import "a"`) out.
 */
export const STD_ROOTS = new Set([
  "archive",
  "bufio",
  "bytes",
  "cmp",
  "compress",
  "container",
  "context",
  "crypto",
  "database",
  "debug",
  "embed",
  "encoding",
  "errors",
  "expvar",
  "flag",
  "fmt",
  "go",
  "hash",
  "html",
  "image",
  "index",
  "io",
  "iter",
  "log",
  "maps",
  "math",
  "mime",
  "net",
  "os",
  "path",
  "plugin",
  "reflect",
  "regexp",
  "runtime",
  "slices",
  "sort",
  "strconv",
  "strings",
  "structs",
  "sync",
  "syscall",
  "testing",
  "text",
  "time",
  "unicode",
  "unique",
  "unsafe",
  "weak",
]);

/** Where an imported package outside the checkout comes from. */
export interface LibraryOrigin {
  ecosystem: "go" | "go-std";
  version?: string;
  versionSource?: string;
}

/**
 * The library an import path names, from the importing directory, or
 * undefined when the package is (or may be) checkout code or its origin is
 * not proven. Standard library: the first element has no dot, is a standard
 * root, and no module of the checkout provides or declares the path. A
 * dependency: some module of the build provides it, every destination is
 * outside the project (the module cache, or a `replace` to another module
 * path or to a directory outside the project), no captured go.mod declares
 * a module path the import is in, and the importer's module is not vendored
 * (`vendored`: its vendor directory has captured files, which Go builds
 * instead). The version only when one module provides it, unreplaced, at a
 * proven selected version. `import "C"` is cgo, not a package.
 */
export function libraryOrigin(
  layout: GoProjectLayout,
  importerDirectory: string,
  importPath: string,
  vendored: (moduleDirectory: string) => boolean,
): LibraryOrigin | undefined {
  if (importPath === "C" || !importPath) return undefined;
  const first = importPath.split("/")[0]!;
  const declared = layout.modules.some(
    (module) =>
      importPath === module.path || importPath.startsWith(`${module.path}/`),
  );
  if (declared) return undefined;
  const destinations = directoryOfImport(layout, importerDirectory, importPath);
  if (!first.includes(".")) {
    if (!STD_ROOTS.has(first) || destinations.providers.length)
      return undefined;
    return { ecosystem: "go-std" };
  }
  const own = moduleOf(layout, importerDirectory);
  if (!own || vendored(own.directory)) return undefined;
  const workspace = layout.workspaces.find(
    (item) =>
      within(own.directory, item.directory) &&
      item.uses.includes(own.directory),
  );
  if (workspace && vendored(workspace.directory)) return undefined;
  const { providers, pruned } = destinations;
  if (!providers.length) return undefined;
  if (
    providers.some((provider) => provider.local || provider.directories.length)
  )
    return undefined;
  // In a pruned build a module no main module requires is not in it.
  if (pruned && !providers.some((provider) => provider.required))
    return undefined;
  const only = providers.length === 1 ? providers[0]! : undefined;
  return only?.version !== undefined && only.versionSource !== undefined
    ? {
        ecosystem: "go",
        version: only.version,
        versionSource: only.versionSource,
      }
    : { ecosystem: "go" };
}
const unique = <T>(items: T[]) => [...new Set(items)];

/** A `go` directive of 1.17 or later (module graph pruning). */
function prunedGraph(go: string | undefined): boolean {
  const match = /^1\.(\d+)(?:\.\d+)?(?:rc\d+|beta\d+)?$|^(\d+)\./.exec(
    go ?? "",
  );
  if (!match) return false;
  if (match[2] !== undefined) return Number(match[2]) > 1;
  return Number(match[1]) >= 17;
}

/** Semantic version parts, or undefined when not a `vMAJOR.MINOR.PATCH[-pre][+build]` version. */
function parseVersion(
  version: string,
): { numbers: number[]; pre: string } | undefined {
  const match =
    /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      version,
    );
  if (!match) return undefined;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ?? "",
  };
}
/** Semantic version order (pre-releases before their release; build metadata ignored). */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)!;
  const right = parseVersion(b)!;
  for (let index = 0; index < 3; index++)
    if (left.numbers[index] !== right.numbers[index])
      return left.numbers[index]! - right.numbers[index]!;
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  const leftParts = left.pre.split(".");
  const rightParts = right.pre.split(".");
  for (
    let index = 0;
    index < Math.max(leftParts.length, rightParts.length);
    index++
  ) {
    const x = leftParts[index];
    const y = rightParts[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn && Number(x) !== Number(y)) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
