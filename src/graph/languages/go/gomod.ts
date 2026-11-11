import { posix } from "node:path";
import type { ContextFile } from "../../types.js";

/** A Go module rooted at a project directory ("" is the project root). */
export interface GoModuleRoot {
  directory: string;
  path: string;
}
export interface GoProjectLayout {
  modules: GoModuleRoot[];
  /** Local `replace` targets, as extra module roots under the replaced path. */
  replacements: GoModuleRoot[];
  /** Directories named by `use` in go.work files (recorded, not required). */
  workspaceUses: string[];
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

export function readLayout(
  contextFiles: readonly ContextFile[],
): GoProjectLayout {
  const layout: GoProjectLayout = {
    modules: [],
    replacements: [],
    workspaceUses: [],
  };
  for (const file of contextFiles) {
    if (file.status !== "clean") continue;
    const directory = directoryOf(file.path);
    const name = posix.basename(file.path);
    for (const { verb, args } of directives(file.text)) {
      if (verb === "module" && name === "go.mod") {
        const path = unquote(args.split(/\s+/)[0] ?? "");
        if (path) layout.modules.push({ directory, path });
      } else if (verb === "replace") {
        const [from, to] = args.split("=>").map((part) => part.trim());
        const fromPath = unquote(from?.split(/\s+/)[0] ?? "");
        const toPath = unquote(to?.split(/\s+/)[0] ?? "");
        if (fromPath && (toPath.startsWith("./") || toPath.startsWith("../"))) {
          const target = joinDirectory(directory, toPath);
          if (target !== undefined)
            layout.replacements.push({ directory: target, path: fromPath });
        }
      } else if (verb === "use" && name === "go.work") {
        const target = joinDirectory(directory, unquote(args));
        if (target !== undefined) layout.workspaceUses.push(target);
      }
    }
  }
  const order = (a: GoModuleRoot, b: GoModuleRoot) =>
    b.directory.length - a.directory.length ||
    (a.directory < b.directory ? -1 : a.directory > b.directory ? 1 : 0);
  layout.modules.sort(order);
  layout.replacements.sort(order);
  return layout;
}

const within = (directory: string, root: string) =>
  root === "" || directory === root || directory.startsWith(`${root}/`);

/** The import path of a project directory: nearest enclosing go.mod module. */
export function importPathOf(
  layout: GoProjectLayout,
  directory: string,
): string | undefined {
  const module = layout.modules.find((item) =>
    within(directory, item.directory),
  );
  if (!module) return undefined;
  const rest =
    module.directory === ""
      ? directory
      : directory.slice(module.directory.length + 1);
  return rest ? `${module.path}/${rest}` : module.path;
}

/** Candidate project directories for an import path (module roots and local replacements). */
export function directoryOfImport(
  layout: GoProjectLayout,
  importPath: string,
): string | undefined {
  let best: { root: GoModuleRoot; length: number } | undefined;
  for (const root of [...layout.replacements, ...layout.modules])
    if (importPath === root.path || importPath.startsWith(`${root.path}/`))
      if (!best || root.path.length > best.length)
        best = { root, length: root.path.length };
  if (!best) return undefined;
  const rest = importPath.slice(best.root.path.length + 1);
  return joinDirectory(best.root.directory, rest || ".");
}
