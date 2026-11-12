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

const directoryOf = (path: string) => {
  const directory = posix.dirname(path);
  return directory === "." ? "" : directory;
};
/** Joins a project-relative directory with a relative path; undefined if it leaves the project. */
export function joinDirectory(
  base: string,
  relative: string,
): string | undefined {
  const joined = posix.normalize(posix.join(base || ".", relative));
  if (joined === ".." || joined.startsWith("../") || posix.isAbsolute(joined))
    return undefined;
  return joined === "." ? "" : joined.replace(/\/$/, "");
}
/** `directory` is `root` or below it. */
export const within = (directory: string, root: string): boolean =>
  root === "" || directory === root || directory.startsWith(`${root}/`);

function replacement(
  directory: string,
  args: string,
): GoReplacement | undefined {
  const [from, to] = args.split("=>").map((part) => part.trim());
  const fromParts = from?.split(/\s+/) ?? [];
  const fromPath = unquote(fromParts[0] ?? "");
  const version = fromParts[1];
  const toPath = unquote(to?.split(/\s+/)[0] ?? "");
  if (!fromPath || !toPath) return undefined;
  const local = toPath.startsWith("./") || toPath.startsWith("../");
  // A module path, or a directory leaving the project: outside (no directory).
  const target = local ? joinDirectory(directory, toPath) : undefined;
  return {
    path: fromPath,
    ...(version ? { version } : {}),
    ...(target === undefined ? {} : { directory: target }),
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
        const target = joinDirectory(directory, unquote(args));
        if (target !== undefined) uses.push(target);
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
      layout.workspaces.push({ directory, uses, replacements });
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
 * The project directories an import path may name, as seen from the importing
 * directory's own module: its main module(s) (the importer's module, or every
 * `use`d module of a go.work listing it) and the local `replace` directives of
 * that go.mod (or of the go.work, which take precedence). One directory when it
 * is proven; several when the captured files cannot prove which replacement Go
 * uses (every candidate is kept, none is definite); none when the package comes
 * from the module cache. A directory inside a different nested module than the
 * one it was mapped through is not that package.
 */
export interface ImportDestinations {
  /** Possible project directories of the package. */
  directories: string[];
  /** A possible destination is outside the project (module cache or path). */
  outside: boolean;
}

export function directoryOfImport(
  layout: GoProjectLayout,
  importerDirectory: string,
  importPath: string,
): ImportDestinations {
  const none: ImportDestinations = { directories: [], outside: true };
  const own = moduleOf(layout, importerDirectory);
  if (!own) return none;
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
  const selectedVersion = (path: string): string | undefined => {
    if (!mains.every((main) => prunedGraph(main.go))) return undefined;
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
  const replaced = new Map<string, GoReplacement[]>();
  for (const path of new Set([...fromMains.keys(), ...fromWork.keys()])) {
    // A go.work replacement of a path overrides the modules' replacements of
    // the same path (or version); when none of its replacements applies, the
    // modules' replacements still do.
    const work = pick(fromWork.get(path) ?? []);
    const roots = work.length ? work : pick(fromMains.get(path) ?? []);
    if (roots.length) replaced.set(path, roots);
  }
  const matches = (path: string) =>
    importPath === path || importPath.startsWith(`${path}/`);
  let best: { roots: GoReplacement[]; main?: GoModule } | undefined;
  const consider = (roots: GoReplacement[], main?: GoModule) => {
    const path = roots[0]!.path;
    if (matches(path) && (!best || path.length > best.roots[0]!.path.length))
      best = main ? { roots, main } : { roots };
  };
  for (const main of mains) consider([main], main);
  for (const roots of replaced.values()) consider(roots);
  if (!best) return none;
  const chosen: { roots: GoReplacement[]; main?: GoModule } = best;
  const out: string[] = [];
  let outside = false;
  for (const root of chosen.roots) {
    if (root.directory === undefined) {
      outside = true;
      continue;
    }
    const rest = importPath.slice(root.path.length + 1);
    const directory = joinDirectory(root.directory, rest || ".");
    if (directory === undefined) {
      outside = true;
      continue;
    }
    const owner = moduleOf(layout, directory);
    if (chosen.main) {
      if (owner === chosen.main) out.push(directory);
      else outside = true;
      continue;
    }
    // A replacement directory: the package must not sit inside a module nested below it.
    if (
      owner &&
      owner.directory !== root.directory &&
      within(owner.directory, root.directory)
    ) {
      outside = true;
      continue;
    }
    out.push(directory);
  }
  return { directories: [...new Set(out)], outside };
}

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
