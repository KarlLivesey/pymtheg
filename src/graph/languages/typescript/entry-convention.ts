// SPDX-License-Identifier: MIT
/**
 * C-46: assumption-marked routes from a missing workspace build output to
 * the single source entry a stated convention names, when the compiler
 * configuration does not prove the mapping (C-25). Configs are read as
 * syntax or JSON data; no build file is executed. Each route carries its
 * own assumption, and existing outputs always win: these are asked only
 * for an output path that is not in the checkout.
 */
import { posix } from "node:path";
import ts from "typescript";

export const bundlerEntryAssumption = "ts-unbuilt-entry-is-bundler-entry";
export const bundlerEntryAssumptionText =
  "The package's build writes this entry from the source file its bundler configuration lists under the entry's name, and the entry's declarations export what that source file exports.";
export const srcTwinAssumption = "ts-unbuilt-entry-is-src-twin";
export const srcTwinAssumptionText =
  "The package's build writes this entry from the source file at the same path under src/, and the entry's declarations export what that source file exports.";
export const rollupEntryAssumption = "ts-unbuilt-entry-is-rollup-entry";
export const rollupEntryAssumptionText =
  "This entry is the declaration roll-up its API Extractor configuration names, built from the configured main entry, and it exports what that entry exports (less declarations its release tags trim).";

export const wrappedEmitAssumption =
  "ts-unbuilt-entry-is-wrapped-compiler-emit";
export const wrappedEmitAssumptionText =
  "The package's build runs its own TypeScript configuration, under a wrapper (Wireit) or before a declaration roll-up of other entries, and leaves at this entry path the declarations the compiler emits for the mapped source file.";

export type Convention =
  | "bundler-entry"
  | "src-twin"
  | "rollup-entry"
  | "wrapped-compiler-emit";
export const conventionAssumptions: Record<Convention, string> = {
  "bundler-entry": bundlerEntryAssumption,
  "src-twin": srcTwinAssumption,
  "rollup-entry": rollupEntryAssumption,
  "wrapped-compiler-emit": wrappedEmitAssumption,
};

export interface ConventionRoute {
  convention: Convention;
  /** The source file (virtual path, leading slash). */
  source?: string;
  /** For a roll-up: the configured main entry, itself an output to map. */
  entry?: string;
  /** For a roll-up: the release tags its trimming removes. */
  trims?: ("internal" | "alpha" | "beta")[];
  /** The config or manifest the convention read (virtual path). */
  config: string;
}

const sourceExtensions = [".ts", ".tsx", ".mts", ".cts"];
const outputExtension = /(?:\.d)?\.(?:[cm]?[jt]s|jsx)$/;
const inputExtension = /\.(?:[cm]?[jt]sx?)$/;
/** The output folders a `src/` twin may replace, and the second segment
 * builds add (`dist/types/`, `dist/esm/`, `lib/cjs/`, `dist/src/`). */
const outputFolders = new Set(["dist", "lib", "build", "out"]);
const secondFolders = new Set(["types", "src", "esm", "cjs", "dts", "mjs"]);
const bundlerConfig =
  /^(?:tsup|tsdown|unbuild|build|rollup|vite|rolldown|esbuild)\.config(?:\.[\w-]+)*\.(?:[cm]?[jt]s|json)$/;
const extractorConfig = /^api-extractor(?:\.[\w-]+)?\.json$/;
const literalPath = /^(?:\.\/)?[\w@.+-]+(?:\/[\w@.+-]+)*$/;

interface EntryList {
  /** key → path for an object entry; undefined key for list entries. */
  entries: { key?: string; path: string }[];
}
interface ConfigData {
  path: string;
  /** Undefined when an entry property exists but is not literal data. */
  lists: EntryList[] | undefined;
  dirs: string[];
}

const below = (file: string, root: string) =>
  file.startsWith(root === "/" ? "/" : root + "/");

/** Literal data of an entry value: a string, an array of strings, an
 * object of strings, an identifier bound by a top-level `const` to one of
 * those, or a call whose single argument is one of those. */
function entryData(
  value: ts.Expression,
  constants: ReadonlyMap<string, ts.Expression>,
  depth = 0,
): EntryList | undefined {
  if (depth > 4) return undefined;
  if (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isSatisfiesExpression(value)
  )
    return entryData(value.expression, constants, depth + 1);
  if (ts.isStringLiteralLike(value))
    return literalPath.test(value.text)
      ? { entries: [{ path: value.text }] }
      : undefined;
  if (ts.isArrayLiteralExpression(value)) {
    const entries = [];
    for (const item of value.elements) {
      if (!ts.isStringLiteralLike(item) || !literalPath.test(item.text))
        return undefined;
      entries.push({ path: item.text });
    }
    return entries.length ? { entries } : undefined;
  }
  if (ts.isObjectLiteralExpression(value)) {
    const entries = [];
    for (const item of value.properties) {
      if (
        !ts.isPropertyAssignment(item) ||
        !(ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) ||
        !ts.isStringLiteralLike(item.initializer) ||
        !literalPath.test(item.initializer.text)
      )
        return undefined;
      entries.push({ key: item.name.text, path: item.initializer.text });
    }
    return entries.length ? { entries } : undefined;
  }
  if (ts.isIdentifier(value)) {
    const bound = constants.get(value.text);
    return bound && entryData(bound, constants, depth + 1);
  }
  if (ts.isCallExpression(value) && value.arguments.length === 1)
    return entryData(value.arguments[0]!, constants, depth + 1);
  return undefined;
}

/** Read a bundler config's entry lists and output folders as syntax. */
function readBundlerConfig(path: string, text: string): ConfigData {
  const json = path.endsWith(".json");
  const source = json
    ? ts.parseJsonText(path, text)
    : ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const constants = new Map<string, ts.Expression>();
  if (!json)
    for (const statement of source.statements)
      if (
        ts.isVariableStatement(statement) &&
        statement.declarationList.flags & ts.NodeFlags.Const
      )
        for (const declaration of statement.declarationList.declarations)
          if (ts.isIdentifier(declaration.name) && declaration.initializer)
            constants.set(declaration.name.text, declaration.initializer);
  const lists: EntryList[] = [];
  const dirs = new Set<string>();
  let opaque = false;
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
    ) {
      const name = node.name.text;
      if (name === "entry" || name === "entries" || name === "input") {
        const data = entryData(node.initializer, constants);
        if (data) lists.push(data);
        else opaque = true;
      } else if (
        (name === "dir" || name === "outDir" || name === "outdir") &&
        ts.isStringLiteralLike(node.initializer) &&
        literalPath.test(node.initializer.text)
      )
        dirs.add(node.initializer.text.replace(/^\.\//, "").replace(/\/$/, ""));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { path, lists: opaque ? undefined : lists, dirs: [...dirs] };
}

const stemOf = (path: string) =>
  path.replace(/^\.\//, "").replace(inputExtension, "");

function commonBase(paths: readonly string[]) {
  if (!paths.length) return "";
  let base = posix.dirname(paths[0]!);
  for (const path of paths)
    while (base !== "." && !(path === base || path.startsWith(base + "/")))
      base = posix.dirname(base);
  return base === "." ? "" : base;
}

/** The bundler configs a package's scripts name with `-c` or `--config`. */
export function namedConfigs(
  root: string,
  scripts: Record<string, unknown> | undefined,
) {
  const paths: string[] = [];
  for (const command of Object.values(scripts ?? {})) {
    if (typeof command !== "string") continue;
    for (const match of command.matchAll(
      /\b(?:tsup|tsdown|unbuild|rollup|rolldown|vite|esbuild)\b[^;&|]*?(?:\s-c|\s--config)(?:\s+|=)([\w./-]+)/g,
    )) {
      const path = posix.join(root, match[1]!);
      if (path === root || path.startsWith(root === "/" ? "/" : root + "/"))
        paths.push(path);
    }
  }
  return paths;
}

export function entryConventions(
  files: ReadonlyMap<string, string>,
  captured: ReadonlyMap<string, string>,
  packageOf: (file: string) => string | undefined,
  /** Per package root, the config files its scripts name (namedConfigs). */
  named: ReadonlyMap<string, readonly string[]> = new Map(),
) {
  const bundlers = new Map<string, ConfigData[]>();
  const extractors = new Map<
    string,
    { path: string; json: Record<string, unknown> }[]
  >();
  const namedBy = new Map<string, string>();
  for (const [root, paths] of named)
    for (const path of paths) namedBy.set(path, root);
  for (const [path, text] of files) {
    const name = posix.basename(path);
    const byScript = namedBy.get(path);
    if (byScript !== undefined) {
      const list = bundlers.get(byScript) ?? [];
      list.push(readBundlerConfig(path, text));
      bundlers.set(byScript, list);
      continue;
    }
    const owner = packageOf(path);
    if (owner === undefined || posix.dirname(path) !== owner) continue;
    if (bundlerConfig.test(name)) {
      const list = bundlers.get(owner) ?? [];
      list.push(readBundlerConfig(path, text));
      bundlers.set(owner, list);
    } else if (extractorConfig.test(name)) {
      const parsed = ts.parseConfigFileTextToJson(path, text);
      if (parsed.error || !parsed.config || typeof parsed.config !== "object")
        continue;
      const list = extractors.get(owner) ?? [];
      list.push({ path, json: parsed.config });
      extractors.set(owner, list);
    }
  }
  const isSource = (file: string, root: string) =>
    captured.has(file.slice(1)) &&
    packageOf(file) === root &&
    sourceExtensions.some((ext) => file.endsWith(ext)) &&
    !/\.d\.[cm]?ts$/.test(file);
  /** The one source file a source path names, trying source extensions. */
  const sourceAt = (root: string, path: string) => {
    const base = posix.join(root, path.replace(/^\.\//, ""));
    const hits = sourceExtensions.some((ext) => base.endsWith(ext))
      ? [base].filter((file) => isSource(file, root))
      : sourceExtensions
          .map((ext) => stemOf(base) + ext)
          .filter((file) => isSource(file, root));
    return hits.length === 1 ? hits[0] : undefined;
  };

  function bundlerEntry(
    root: string,
    output: string,
  ): ConventionRoute | "conflicting" | "none" | undefined {
    const configs = bundlers.get(root);
    if (!configs?.length) return undefined;
    const relative = posix.relative(root, output);
    const sources = new Set<string>();
    let readable = false;
    let config = "";
    for (const data of configs) {
      // An entry that is not data says nothing either way: the twin may apply.
      if (!data.lists?.length) continue;
      readable = true;
      for (const dir of data.dirs.length ? data.dirs : ["dist"]) {
        if (!relative.startsWith(dir + "/")) continue;
        const stem = relative
          .slice(dir.length + 1)
          .replace(outputExtension, "");
        for (const list of data.lists) {
          const base = commonBase(list.entries.map(({ path }) => stemOf(path)));
          for (const { key, path } of list.entries) {
            const name = key ?? stemOf(path).slice(base ? base.length + 1 : 0);
            if (name !== stem && !(name + "/index" === stem)) continue;
            const source = sourceAt(root, path);
            if (!source) return "conflicting";
            sources.add(source);
            config = data.path;
          }
        }
      }
    }
    if (sources.size > 1) return "conflicting";
    if (sources.size === 1)
      return { convention: "bundler-entry", source: [...sources][0]!, config };
    // Readable entries that name other outputs say this is not one of them.
    return readable ? "none" : undefined;
  }

  function srcTwin(
    root: string,
    output: string,
    manifest: string,
  ): ConventionRoute | undefined {
    const parts = posix.relative(root, output).split("/");
    if (parts.length < 2 || !outputFolders.has(parts[0]!)) return undefined;
    const skip = parts.length > 2 && secondFolders.has(parts[1]!) ? 2 : 1;
    const stem = ["src", ...parts.slice(skip)]
      .join("/")
      .replace(outputExtension, "");
    const hits = sourceExtensions
      .map((ext) => posix.join(root, stem + ext))
      .filter((file) => isSource(file, root));
    return hits.length === 1
      ? { convention: "src-twin", source: hits[0]!, config: manifest }
      : undefined;
  }

  function rollupEntry(
    root: string,
    output: string,
  ): ConventionRoute | "conflicting" | undefined {
    const routes = new Set<string>();
    let config = "";
    const trims = new Set<"internal" | "alpha" | "beta">();
    for (const { path, json } of extractors.get(root) ?? []) {
      const rollup = json.dtsRollup as Record<string, unknown> | undefined;
      const main = json.mainEntryPointFilePath;
      if (!rollup || rollup.enabled !== true || typeof main !== "string")
        continue;
      const at = (field: string) => {
        const value = rollup[field];
        return typeof value === "string" && value
          ? posix.join(root, value.replace("<projectFolder>/", ""))
          : undefined;
      };
      const level = (
        [
          ["untrimmedFilePath", []],
          ["alphaTrimmedFilePath", ["internal"]],
          ["betaTrimmedFilePath", ["internal", "alpha"]],
          ["publicTrimmedFilePath", ["internal", "alpha", "beta"]],
        ] as const
      ).find(([field]) => at(field) === output);
      if (!level) continue;
      for (const tag of level[1]) trims.add(tag);
      const entry = posix.join(root, main.replace("<projectFolder>/", ""));
      if (!below(entry, root) || !/\.d\.[cm]?ts$/.test(entry))
        return "conflicting";
      routes.add(entry);
      config = path;
    }
    if (routes.size > 1) return "conflicting";
    return routes.size
      ? {
          convention: "rollup-entry",
          entry: [...routes][0]!,
          config,
          trims: [...trims],
        }
      : undefined;
  }

  /** The route for a missing output, or why there is none. */
  const route = (
    root: string,
    output: string,
    manifest: string,
  ): ConventionRoute | "conflicting" | undefined => {
    const rollup = rollupEntry(root, output);
    if (rollup) return rollup;
    const bundled = bundlerEntry(root, output);
    if (bundled === "conflicting") return "conflicting";
    if (bundled && bundled !== "none") return bundled;
    if (bundled === "none") return undefined;
    return srcTwin(root, output, manifest);
  };
  return Object.assign(route, {
    /** Whether the package has a visible bundler or roll-up config. */
    hasConfig: (root: string) =>
      !!bundlers.get(root)?.length || !!extractors.get(root)?.length,
  });
}
