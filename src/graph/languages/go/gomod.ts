import { posix } from "node:path";
import type { ContextFile } from "../../types.js";

/** A module path mapped to a project directory ("" is the project root). */
export interface GoModuleRoot {
  directory: string;
  path: string;
}
/** A go.mod in the snapshot, with the local `replace` directives it declares. */
export interface GoModule extends GoModuleRoot {
  replacements: GoModuleRoot[];
}
/** A go.work in the snapshot: its `use` directories and its local replacements. */
export interface GoWorkspace {
  directory: string;
  uses: string[];
  replacements: GoModuleRoot[];
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
): GoModuleRoot | undefined {
  const [from, to] = args.split("=>").map((part) => part.trim());
  const fromPath = unquote(from?.split(/\s+/)[0] ?? "");
  const toPath = unquote(to?.split(/\s+/)[0] ?? "");
  if (!fromPath || !(toPath.startsWith("./") || toPath.startsWith("../")))
    return undefined;
  const target = joinDirectory(directory, toPath);
  return target === undefined
    ? undefined
    : { directory: target, path: fromPath };
}

export function readLayout(
  contextFiles: readonly ContextFile[],
): GoProjectLayout {
  const layout: GoProjectLayout = { modules: [], workspaces: [] };
  for (const file of contextFiles) {
    if (file.status !== "clean") continue;
    const directory = directoryOf(file.path);
    const name = posix.basename(file.path);
    const replacements: GoModuleRoot[] = [];
    const uses: string[] = [];
    let path: string | undefined;
    for (const { verb, args } of directives(file.text)) {
      if (verb === "module" && name === "go.mod")
        path = unquote(args.split(/\s+/)[0] ?? "") || undefined;
      else if (verb === "replace") {
        const item = replacement(directory, args);
        if (item) replacements.push(item);
      } else if (verb === "use" && name === "go.work") {
        const target = joinDirectory(directory, unquote(args));
        if (target !== undefined) uses.push(target);
      }
    }
    if (name === "go.mod" && path !== undefined)
      layout.modules.push({ directory, path, replacements });
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
 * The project directory an import path names, as seen from the importing
 * directory's own module: its main module(s) (the importer's module, or every
 * `use`d module of a go.work listing it) and the local `replace` directives of
 * that go.mod (or of the go.work, which take precedence). A directory inside a
 * different nested module than the one it was mapped through is not that package.
 * Other project modules reached without a replace come from the module cache in Go,
 * so they stay unresolved.
 */
export function directoryOfImport(
  layout: GoProjectLayout,
  importerDirectory: string,
  importPath: string,
): string | undefined {
  const own = moduleOf(layout, importerDirectory);
  if (!own) return undefined;
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
  const replaced = new Map<string, GoModuleRoot>();
  for (const main of mains)
    for (const item of main.replacements)
      if (!replaced.has(item.path)) replaced.set(item.path, item);
  for (const item of workspace?.replacements ?? [])
    replaced.set(item.path, item);
  const matches = (path: string) =>
    importPath === path || importPath.startsWith(`${path}/`);
  let best: { root: GoModuleRoot; main?: GoModule } | undefined;
  const consider = (root: GoModuleRoot, main?: GoModule) => {
    if (
      matches(root.path) &&
      (!best || root.path.length > best.root.path.length)
    )
      best = main ? { root, main } : { root };
  };
  for (const main of mains) consider(main, main);
  for (const item of replaced.values()) consider(item);
  if (!best) return undefined;
  const chosen: { root: GoModuleRoot; main?: GoModule } = best;
  const rest = importPath.slice(chosen.root.path.length + 1);
  const directory = joinDirectory(chosen.root.directory, rest || ".");
  if (directory === undefined) return undefined;
  const owner = moduleOf(layout, directory);
  if (chosen.main) return owner === chosen.main ? directory : undefined;
  // A replacement directory: the package must not sit inside a module nested below it.
  if (
    owner &&
    owner.directory !== chosen.root.directory &&
    within(owner.directory, chosen.root.directory)
  )
    return undefined;
  return directory;
}
