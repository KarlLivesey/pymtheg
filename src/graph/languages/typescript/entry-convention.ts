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
  /**
   * A config object's `input` beside its `output.file` (rollup): that
   * output file is built from those entries.
   */
  pairs: { entries: EntryList; files: string[] }[];
}

/** The literal `file` paths of an `output` value (an object or a list of them). */
function outputFiles(value: ts.Expression): string[] {
  const objects = ts.isArrayLiteralExpression(value) ? value.elements : [value];
  const files: string[] = [];
  for (const item of objects)
    if (ts.isObjectLiteralExpression(item))
      for (const property of item.properties)
        if (
          ts.isPropertyAssignment(property) &&
          (ts.isIdentifier(property.name) ||
            ts.isStringLiteral(property.name)) &&
          property.name.text === "file" &&
          ts.isStringLiteralLike(property.initializer) &&
          literalPath.test(property.initializer.text)
        )
          files.push(property.initializer.text.replace(/^\.\//, ""));
  return files;
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
  /** Names bound to an imported or required JSON file (`pkg`), as data. */
  json: ReadonlyMap<string, Record<string, unknown>> = new Map(),
): EntryList | undefined {
  if (depth > 4) return undefined;
  // `pkg.source` of `import pkg from "./package.json"`: a field as data.
  if (
    ts.isPropertyAccessExpression(value) &&
    ts.isIdentifier(value.expression) &&
    json.has(value.expression.text)
  ) {
    const field = json.get(value.expression.text)![value.name.text];
    return typeof field === "string" && literalPath.test(field)
      ? { entries: [{ path: field }] }
      : undefined;
  }
  if (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isSatisfiesExpression(value)
  )
    return entryData(value.expression, constants, depth + 1, json);
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
    return bound && entryData(bound, constants, depth + 1, json);
  }
  if (ts.isCallExpression(value) && value.arguments.length === 1)
    return entryData(value.arguments[0]!, constants, depth + 1, json);
  return undefined;
}

/** Read a bundler config's entry lists and output folders as syntax. */
function readBundlerConfig(
  path: string,
  text: string,
  readFile: (path: string) => string | undefined = () => undefined,
): ConfigData {
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
  // Names bound to a relative JSON file, read as data (`pkg.source`).
  const jsonFiles = new Map<string, Record<string, unknown>>();
  const bindJson = (name: string, specifier: string) => {
    if (!specifier.startsWith(".") || !specifier.endsWith(".json")) return;
    const text = readFile(posix.join(posix.dirname(path), specifier));
    if (text === undefined) return;
    try {
      const value: unknown = JSON.parse(text);
      if (value && typeof value === "object")
        jsonFiles.set(name, value as Record<string, unknown>);
    } catch {}
  };
  if (!path.endsWith(".json"))
    for (const statement of source.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        statement.importClause?.name &&
        ts.isStringLiteral(statement.moduleSpecifier)
      )
        bindJson(
          statement.importClause.name.text,
          statement.moduleSpecifier.text,
        );
      if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations) {
          const init = declaration.initializer;
          if (
            ts.isIdentifier(declaration.name) &&
            init &&
            ts.isCallExpression(init) &&
            ts.isIdentifier(init.expression) &&
            init.expression.text === "require" &&
            init.arguments.length === 1 &&
            ts.isStringLiteral(init.arguments[0]!)
          )
            bindJson(declaration.name.text, init.arguments[0].text);
        }
    }
  const lists: EntryList[] = [];
  const dirs = new Set<string>();
  const pairs: ConfigData["pairs"] = [];
  let opaque = false;
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const named = (key: string) =>
        node.properties.find(
          (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) &&
            (ts.isIdentifier(property.name) ||
              ts.isStringLiteral(property.name)) &&
            property.name.text === key,
        );
      const input = named("input");
      const output = named("output");
      const entries =
        input && entryData(input.initializer, constants, 0, jsonFiles);
      const files = output ? outputFiles(output.initializer) : [];
      if (entries && files.length) pairs.push({ entries, files });
    }
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
    ) {
      const name = node.name.text;
      if (name === "entry" || name === "entries" || name === "input") {
        const data = entryData(node.initializer, constants, 0, jsonFiles);
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
  return {
    path,
    lists: opaque ? undefined : lists,
    dirs: [...dirs],
    pairs,
  };
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
  /** The package's name (its manifest's `name`), for API Extractor tokens. */
  packageName: (root: string) => string | undefined = () => undefined,
  /**
   * Whether the package's scripts run a declaration roll-up tool (API
   * Extractor, `dts-bundle-generator`): with no readable roll-up config, the
   * twin could name declarations the roll-up drops.
   */
  rollupNamed: (root: string) => boolean = () => false,
) {
  const bundlers = new Map<string, ConfigData[]>();
  const extractors = new Map<
    string,
    { path: string; json: Record<string, unknown> }[]
  >();
  /**
   * Packages with a declaration roll-up the walk cannot read (an API
   * Extractor config that does not parse or whose roll-up fields are not
   * literal, a rollup config whose entries are not data): the roll-up may
   * write any entry, so no convention, not even the twin, applies there.
   */
  const unreadableRollup = new Set<string>();
  const namedBy = new Map<string, string>();
  for (const [root, paths] of named)
    for (const path of paths) namedBy.set(path, root);
  for (const [path, text] of files) {
    const name = posix.basename(path);
    const byScript = namedBy.get(path);
    if (byScript !== undefined) {
      const list = bundlers.get(byScript) ?? [];
      list.push(readBundlerConfig(path, text, (file) => files.get(file)));
      bundlers.set(byScript, list);
      continue;
    }
    const owner = packageOf(path);
    if (owner === undefined) continue;
    // API Extractor's default place is `config/api-extractor.json`.
    if (
      extractorConfig.test(name) &&
      posix.dirname(path) === posix.join(owner, "config")
    ) {
      const json = extractorJson(path);
      if (json) {
        const list = extractors.get(owner) ?? [];
        list.push({ path, json });
        extractors.set(owner, list);
      } else unreadableRollup.add(owner);
      continue;
    }
    if (posix.dirname(path) !== owner) continue;
    if (bundlerConfig.test(name)) {
      const list = bundlers.get(owner) ?? [];
      const data = readBundlerConfig(path, text, (file) => files.get(file));
      if (name.startsWith("rollup.") && !data.lists)
        unreadableRollup.add(owner);
      list.push(data);
      bundlers.set(owner, list);
    } else if (extractorConfig.test(name)) {
      const json = extractorJson(path);
      if (!json) {
        unreadableRollup.add(owner);
        continue;
      }
      const list = extractors.get(owner) ?? [];
      list.push({ path, json });
      extractors.set(owner, list);
    }
  }

  /**
   * An API Extractor config as data, its `extends` chain (relative paths,
   * plain data) merged under it: undefined when any link does not parse or
   * extends a package.
   */
  function extractorJson(
    path: string,
    depth = 0,
  ): Record<string, unknown> | undefined {
    const text = files.get(path);
    if (text === undefined || depth > 8) return undefined;
    const parsed = ts.parseConfigFileTextToJson(path, text);
    if (parsed.error || !parsed.config || typeof parsed.config !== "object")
      return undefined;
    const own = parsed.config as Record<string, unknown>;
    if (own.extends === undefined) return own;
    if (typeof own.extends !== "string" || !own.extends.startsWith("."))
      return undefined;
    const base = extractorJson(
      posix.join(posix.dirname(path), own.extends),
      depth + 1,
    );
    if (!base) return undefined;
    const merged: Record<string, unknown> = { ...base, ...own };
    for (const key of ["dtsRollup", "apiReport", "docModel"])
      if (
        base[key] &&
        own[key] &&
        typeof base[key] === "object" &&
        typeof own[key] === "object"
      )
        merged[key] = { ...(base[key] as object), ...(own[key] as object) };
    delete merged.extends;
    return merged;
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
    let opaque = false;
    let config = "";
    for (const data of configs) {
      // An entry that is present but not data could name any source: no
      // convention, not even the twin, for this package (review round 3).
      if (!data.lists) {
        opaque = true;
        continue;
      }
      if (!data.lists.length) continue;
      readable = true;
      // An `output.file` names this output: its config object's single
      // input. The config writing exactly this file wins over one writing
      // a file of the same stem (`dist/index.d.ts` from a dts plugin beside
      // `dist/index.js`).
      const bare = relative.replace(outputExtension, "");
      const exact = data.pairs.filter(({ files }) => files.includes(relative));
      for (const { entries, files } of exact.length ? exact : data.pairs) {
        if (!files.some((file) => file.replace(outputExtension, "") === bare))
          continue;
        if (entries.entries.length !== 1) return "conflicting";
        const source = sourceAt(root, entries.entries[0]!.path);
        if (!source) return "conflicting";
        sources.add(source);
        config = data.path;
      }
      // A config object writing exactly this file decides it: the `dir`
      // rule does not add another source for the same stem.
      if (exact.length) continue;
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
    if (opaque) return "conflicting";
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
      if (!rollup || rollup.enabled !== true) continue;
      // The package-name tokens are plain data; any other token, or a value
      // that is not a string, and the roll-up cannot be read.
      const name = packageName(root);
      const expand = (value: unknown) =>
        typeof value === "string" && name
          ? value
              .replaceAll(
                "<unscopedPackageName>",
                name.replace(/^@[^/]+\//, ""),
              )
              .replaceAll("<packageName>", name)
          : value;
      for (const key of ["mainEntryPointFilePath"])
        json[key] = expand(json[key]);
      for (const key of Object.keys(rollup)) rollup[key] = expand(rollup[key]);
      const main = json.mainEntryPointFilePath;
      const readable = (value: unknown) =>
        typeof value === "string" && !/<(?!projectFolder>)[^>]*>/.test(value);
      if (
        !readable(main) ||
        [
          "untrimmedFilePath",
          "alphaTrimmedFilePath",
          "betaTrimmedFilePath",
          "publicTrimmedFilePath",
        ].some(
          (field) => rollup[field] !== undefined && !readable(rollup[field]),
        )
      ) {
        unreadableRollup.add(root);
        return "conflicting";
      }
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
      const entry = posix.join(
        root,
        (main as string).replace("<projectFolder>/", ""),
      );
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
    if (unreadableRollup.has(root)) return "conflicting";
    if (rollup) return rollup;
    const bundled = bundlerEntry(root, output);
    if (bundled === "conflicting") return "conflicting";
    if (bundled && bundled !== "none") return bundled;
    if (bundled === "none") return undefined;
    // A roll-up tool runs, and no readable config of it says what it writes:
    // the twin of a declaration entry could name what the roll-up drops.
    if (
      /\.d\.[cm]?ts$/.test(output) &&
      rollupNamed(root) &&
      !extractors.get(root)?.length
    )
      return "conflicting";
    return srcTwin(root, output, manifest);
  };
  return Object.assign(route, {
    /** Whether the package has a visible bundler or roll-up config. */
    hasConfig: (root: string) =>
      !!bundlers.get(root)?.length || !!extractors.get(root)?.length,
  });
}
