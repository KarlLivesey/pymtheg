// SPDX-License-Identifier: MIT
import { posix } from "node:path";
import ts from "typescript";
import type { Manifest } from "./workspace.js";

export const unbuiltEntryAssumption = "ts-unbuilt-entry-is-compiler-emit";
export const unbuiltEntryAssumptionText =
  "The package's build leaves, at this entry path, declarations whose exports are those the TypeScript compiler would emit for the mapped source file.";

const bundlers = [
  "tsup",
  "tsdown",
  "unbuild",
  "esbuild",
  "rollup",
  "vite",
  "rolldown",
  "webpack",
  "build",
];
export const entryBuildContext = [
  "*api-extractor*.json",
  "rollup*.json",
  ...bundlers.map((name) => name + ".config*.json"),
];

const declarationRollup =
  /\b(?:api-extractor|dts-bundle-generator|rollup-plugin-dts)\b/;
const configName = new RegExp(
  `^(?:${bundlers.join("|")})\\.config(?:\\.[\\w-]+)*\\.(?:[cm]?[jt]s|json)$`,
);
const extractorConfig =
  /(?:^|[.-])api-extractor(?:[.-]|$).*\.json$|^api-extractor\.json$/;

/** These are literal command segments, read from the manifest as data.
 * Quoting is preserved for paths. We never expand shell syntax. */
const separators = /[;&|\n]/;
const shellTokens = /(?:"[^"]*"|'[^']*'|[^"'\s;&|])+/g;
const entryExtension = /\.[cm]?[jt]sx?$/i;
const buildTools = new Set(bundlers.filter((name) => name !== "build"));
const entryFlags = new Set(["-i", "--input", "--entry", "--entryPoints"]);
const positionalOptions = new Set([
  "-c",
  "--config",
  "--out-dir",
  "--outDir",
  "--outdir",
  "--outfile",
  "--format",
  "--target",
  "--platform",
  "--tsconfig",
  "--external",
]);

function commandWords(segment: string) {
  return (segment.match(shellTokens) ?? []).map((word) =>
    word.replace(
      /"([^"]*)"|'([^']*)'/g,
      (_whole, double, single) => double ?? single,
    ),
  );
}

function scriptCommands(manifest: Manifest) {
  const commands: string[] = [];
  const scripts = manifest.json.scripts;
  if (scripts && typeof scripts === "object")
    for (const command of Object.values(scripts))
      if (typeof command === "string") commands.push(command);
  const wireit = manifest.json.wireit;
  if (wireit && typeof wireit === "object")
    for (const script of Object.values(wireit))
      if (
        script &&
        typeof script === "object" &&
        typeof script.command === "string"
      )
        commands.push(script.command);
  return commands;
}

// Read only literal entries in a single exported object. Spreads, computed
// keys, imported values, globs and callbacks cannot establish an entry.
function literalConfig(
  path: string,
  text: string,
): ts.ObjectLiteralExpression | undefined {
  const json = path.endsWith(".json");
  const source = json
    ? ts.parseJsonText(path, text)
    : ts.createSourceFile(path, text, ts.ScriptTarget.Latest);
  if (
    (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] })
      .parseDiagnostics.length
  )
    return;
  const exports = source.statements.flatMap((statement) => {
    if (ts.isExportAssignment(statement)) return [statement.expression];
    if (!ts.isExpressionStatement(statement)) return [];
    const value = statement.expression;
    if (json) return [value];
    return ts.isBinaryExpression(value) &&
      value.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(value.left) &&
      ts.isIdentifier(value.left.expression) &&
      value.left.expression.text === "module" &&
      value.left.name.text === "exports"
      ? [value.right]
      : [];
  });
  if (
    exports.length !== 1 ||
    (!json &&
      source.statements.some(
        (statement) =>
          !ts.isImportDeclaration(statement) &&
          !ts.isExportAssignment(statement) &&
          !(
            ts.isExpressionStatement(statement) &&
            (ts.isStringLiteral(statement.expression) ||
              (ts.isBinaryExpression(statement.expression) &&
                statement.expression.right === exports[0]))
          ),
      ))
  )
    return;
  let value = exports[0]!;
  if (
    ts.isCallExpression(value) &&
    ts.isIdentifier(value.expression) &&
    ["defineConfig", "defineBuildConfig"].includes(value.expression.text) &&
    value.arguments.length === 1
  )
    value = value.arguments[0]!;
  return ts.isObjectLiteralExpression(value) ? value : undefined;
}

/** Undefined means opaque; an empty list is a literal Vite app config. */
function configuredEntries(path: string, text: string): string[] | undefined {
  function fields(value: ts.Expression | undefined) {
    if (!value || !ts.isObjectLiteralExpression(value)) return;
    const found = new Map<string, ts.Expression>();
    for (const item of value.properties) {
      if (
        !ts.isPropertyAssignment(item) ||
        !(ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) ||
        found.has(item.name.text)
      )
        return;
      found.set(item.name.text, item.initializer);
    }
    return found;
  }
  const config = fields(literalConfig(path, text));
  if (!config) return;
  const kind = posix.basename(path).split(".")[0];
  let entry =
    config.get("entry") ?? config.get("entries") ?? config.get("input");
  if (kind === "vite") {
    if (config.has("pack")) return;
    if (!config.has("build")) return [];
    const build = fields(config.get("build"));
    if (!build) return;
    if (
      !build.has("lib") &&
      !build.has("rollupOptions") &&
      !build.has("rolldownOptions")
    )
      return [];
    entry = fields(build.get("lib"))?.get("entry");
  }
  if (!entry) return;
  const entries = ts.isStringLiteral(entry)
    ? [entry]
    : ts.isArrayLiteralExpression(entry)
      ? entry.elements
      : fields(entry)?.values();
  if (!entries) return;
  const paths = [];
  for (const item of entries) {
    if (
      !ts.isStringLiteral(item) ||
      !/^[\w./-]+$/.test(item.text) ||
      posix.isAbsolute(item.text) ||
      item.text.split("/").includes("..")
    )
      return;
    paths.push(item.text);
  }
  return paths.length ? paths : undefined;
}

const buildScriptName =
  /(?:^|[:.-])(?:build|compile)(?:$|[:.-])|^(?:prebuild|postbuild|prepare|prepack|preinstall|install|postinstall|postpack|prepublish|prepublishOnly)$/;
const compilerSelectors = new Set(["-p", "--project", "-b", "--build"]);
const harmlessCompilerFlags = new Set([
  "--pretty",
  "--verbose",
  "-v",
  "--force",
  "-f",
  "--diagnostics",
  "--extendedDiagnostics",
  "--listFiles",
  "--listEmittedFiles",
  "--skipLibCheck",
  "--emitDeclarationOnly",
  "--watch",
  "-w",
  "--preserveWatchOutput",
  "--noErrorTruncation",
]);
function changesCompilerMapping(words: readonly string[], start: number) {
  let selected = false;
  for (let i = start + 1; i < words.length; i++) {
    const [flag, inline] = words[i]!.split("=", 2);
    if (compilerSelectors.has(flag!)) {
      if (selected) return true;
      selected = true;
      const target = inline ?? words[i + 1];
      if (target && !target.startsWith("-")) {
        if (!/^[\w./-]+$/.test(target) || /\.[cm]?[jt]sx?$/i.test(target))
          return true;
        if (inline === undefined) i++;
      } else if (flag === "-p" || flag === "--project") return true;
    } else if (harmlessCompilerFlags.has(flag!)) {
      if (inline !== undefined && !/^(?:true|false)$/.test(inline)) return true;
      if (inline === undefined && /^(?:true|false)$/.test(words[i + 1] ?? ""))
        i++;
    } else return true;
  }
  return false;
}

export function entryBuildGuards(
  files: ReadonlyMap<string, string>,
  packageOf: (file: string) => string | undefined,
) {
  const declarationRollups = new Set<string>();
  const visibleConfigs = new Map<string, Set<string>>();
  for (const [path, text] of files) {
    const name = posix.basename(path);
    if (configName.test(name)) {
      const owner = packageOf(path);
      if (owner !== undefined) {
        const paths = visibleConfigs.get(owner) ?? new Set();
        paths.add(path);
        visibleConfigs.set(owner, paths);
      }
    }
    if (
      !extractorConfig.test(name) &&
      !(
        (configName.test(name) || /^rollup.*\.json$/.test(name)) &&
        (declarationRollup.test(text) ||
          /\b(?:rollupTypes|bundleTypes)\s*["']?\s*:\s*true\b/.test(text))
      )
    )
      continue;
    const owner = packageOf(path);
    if (owner !== undefined) declarationRollups.add(owner);
  }

  const cache = new Map<
    string,
    {
      rollup: boolean;
      wrapper: boolean;
      compilerOverride: boolean;
      configs: (string[] | undefined)[];
      entries: Set<string>;
      scripts: string[];
    }
  >();
  /** With `rewriteOnly`, only a literal rewrite of the output counts (C-46:
   * a convention route already rests on the bundler, roll-up or wrapper). */
  return (
    root: string,
    manifest: Manifest,
    source: string,
    output: string,
    rewriteOnly = false,
  ) => {
    let build = cache.get(root);
    if (!build) {
      const commands = scriptCommands(manifest);
      const entries = new Set<string>();
      const scripts: string[] = [];
      let rollup = declarationRollups.has(root);
      let compilerOverride = false;
      const scriptMap = manifest.json.scripts;
      const declared = new Map(
        scriptMap && typeof scriptMap === "object"
          ? Object.entries(scriptMap).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            )
          : [],
      );
      const buildCommands = new Set(
        [...declared]
          .filter(([name]) => buildScriptName.test(name))
          .map(([, command]) => command),
      );
      for (const command of buildCommands)
        for (const segment of command.split(separators)) {
          const [manager, action, name] = commandWords(segment);
          if (!/^(?:npm|pnpm|yarn|bun)$/.test(manager ?? "")) continue;
          const nested = declared.get(
            (action === "run" || action === "run-script" ? name : action) ?? "",
          );
          if (nested) buildCommands.add(nested);
        }
      const configPaths = new Set(visibleConfigs.get(root));
      for (const command of commands)
        for (const segment of command.split(separators)) {
          const words = commandWords(segment);
          const node = words.indexOf("node");
          if (node >= 0 && entryExtension.test(words[node + 1] ?? ""))
            scripts.push(posix.resolve(root, words[node + 1]!));
          const compiler = words.findIndex((word) =>
            /^tsc(?:\.cmd|\.js)?$/.test(posix.basename(word)),
          );
          if (compiler >= 0 && buildCommands.has(command))
            compilerOverride ||= changesCompilerMapping(words, compiler);
          const at = words.findIndex((word) => buildTools.has(word));
          if (at < 0) continue;
          for (let i = at + 1; i < words.length; i++) {
            const word = words[i]!;
            const [flag, value] = word.split("=", 2);
            if (flag === "-c" || flag === "--config") {
              const next = value ?? words[i + 1];
              if (next && !next.startsWith("-")) {
                if (value === undefined) i++;
                const path = posix.resolve(root, next);
                const config = packageOf(path) === root && files.get(path);
                configPaths.add(path);
                if (words[at] === "rollup")
                  rollup ||= !config || declarationRollup.test(config);
              }
              continue;
            }
            const entry = entryFlags.has(flag!)
              ? (value ?? words[++i])
              : !word.startsWith("-") && entryExtension.test(word)
                ? word
                : undefined;
            if (entry) entries.add(posix.resolve(root, entry));
            else if (positionalOptions.has(word)) i++;
          }
        }
      build = {
        rollup:
          rollup || commands.some((command) => declarationRollup.test(command)),
        // An orchestration recipe is not a package compiler invocation.
        // Wireit's file/output lists and dependency tasks can select or
        // replace generated declarations outside this package's tsconfig.
        wrapper:
          manifest.json.wireit !== undefined &&
          commands.some((command) => command.trim() === "wireit"),
        entries,
        scripts,
        compilerOverride,
        configs: [...configPaths].map((path) => {
          const content = packageOf(path) === root && files.get(path);
          return content
            ? configuredEntries(path, content)?.map((entry) =>
                posix.resolve(root, entry),
              )
            : undefined;
        }),
      };
      cache.set(root, build);
    }
    if (!rewriteOnly) {
      if (build.rollup) return "declaration-rollup";
      if (build.wrapper) return "wireit-wrapper";
      if (build.compilerOverride) return "compiler-mapping-options";
      if (build.configs.some((entries) => !entries))
        return "bundler-config-unverified";
      if (
        build.configs.some((entries) =>
          entries?.some((entry) => entry !== source),
        )
      )
        return "bundler-config-entry";
      if (build.entries.size && !build.entries.has(source))
        return "different-entry";
    }
    // A captured wrapper sometimes writes the very declaration we would
    // substitute. Recognise a literal write to that path as contrary evidence.
    const relativeOutput = posix.relative(root, output);
    for (const script of build.scripts) {
      if (packageOf(script) !== root) continue;
      const text = files.get(script);
      if (
        text &&
        /\b(?:writeFile(?:Sync)?|copyFile(?:Sync)?)\s*\(/.test(text) &&
        [relativeOutput, "./" + relativeOutput].some((name) =>
          ["'", '"', "`"].some((quote) => text.includes(quote + name + quote)),
        )
      )
        return "output-rewrite";
    }
  };
}
