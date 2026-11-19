// SPDX-License-Identifier: MIT
import { posix } from "node:path";
import ts from "typescript";
import type { Manifest } from "./workspace.js";

export interface UnbuiltEntry {
  proof: "tsconfig-emit" | "project-reference" | "tsup-entry";
  config: string;
  output: string;
  source: string;
}
export type OutputProof = UnbuiltEntry | "conflicting" | false;

const sourceExtension = /\.(?:ts|tsx|mts|cts)$/;
const declaration = /\.d\.(?:ts|mts|cts)$/;
const outputExtension = /\.(?:[cm]?js|jsx|d\.[cm]?ts)$/;
const asObject = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const below = (file: string, root: string) =>
  file.startsWith(root === "/" ? "/" : root + "/");

function packagePath(root: string, path: unknown): string | undefined {
  if (typeof path !== "string" || posix.isAbsolute(path) || path.includes("\\"))
    return undefined;
  const file = posix.join(root, path);
  return below(file, root) && !file.split("/").includes("node_modules")
    ? file
    : undefined;
}

/** Only tsup's literal named-entry, unbundled ESM emit from package.json. */
function tsupEntries(root: string, manifest: Manifest) {
  const result = new Map<string, string>();
  const config = asObject(manifest.json.tsup);
  if (
    !config ||
    manifest.json.type !== "module" ||
    config.bundle !== false ||
    JSON.stringify(config.format) !== '["esm"]' ||
    Object.keys(config).some(
      (key) => !["entry", "outDir", "format", "bundle"].includes(key),
    )
  )
    return result;
  const folder = packagePath(root, config.outDir);
  const entries = asObject(config.entry);
  if (!folder || !entries) return result;
  for (const [name, entry] of Object.entries(entries)) {
    const source = packagePath(root, entry);
    const output = packagePath(folder, name + ".js");
    if (source && output && /^[\w-]+$/.test(name)) result.set(output, source);
  }
  return result;
}

interface Config {
  path: string;
  parsed: ts.ParsedCommandLine;
  byStem?: Map<string, string[]>;
  commonRootProven?: boolean;
}

/** Invert the compiler's per-input emit names using the captured config. */
export function workspaceEntries(
  manifests: readonly Manifest[],
  parsedConfigs: ReadonlyMap<string, ts.ParsedCommandLine>,
  files: ReadonlyMap<string, string>,
  captured: ReadonlyMap<string, string>,
) {
  const packages = new Map(
    manifests.map((manifest) => [posix.dirname("/" + manifest.path), manifest]),
  );
  function packageOf(file: string) {
    for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
      if (packages.has(dir)) return dir;
      if (dir === "/") return undefined;
    }
  }
  const configs = new Map<string, Config[]>();
  for (const [path, parsed] of parsedConfigs) {
    if (
      parsed.options.noEmit ||
      !parsed.fileNames.length ||
      (!parsed.options.outDir && !parsed.options.declarationDir)
    )
      continue;
    const root = packageOf(path);
    if (root === undefined) continue;
    const list = configs.get(root) ?? [];
    list.push({ path, parsed });
    configs.set(root, list);
  }
  const staticEntries = new Map<string, Map<string, string>>();
  const internalSources = new Map<string, boolean>();
  const cache = new Map<string, OutputProof | null>();
  const nativeConfigs = new WeakMap<
    ts.ParsedCommandLine,
    ts.ParsedCommandLine
  >();
  const declarationsByStem = new Set(
    [...captured.keys()]
      .filter((file) => declaration.test(file))
      .map((file) => posix.basename(file).replace(declaration, "")),
  );
  return {
    available: configs.size > 0 || manifests.some(({ json }) => !!json.tsup),
    proof(root: string, output: string) {
      if (!outputExtension.test(output) || files.has(output)) return undefined;
      if (cache.has(output)) return cache.get(output) ?? undefined;
      const match = find(root, output);
      cache.set(output, match ?? null);
      return match;
    },
    forReference(parsed: ts.ParsedCommandLine) {
      if (!parsed.options.composite || parsed.options.outFile) return parsed;
      let result = nativeConfigs.get(parsed);
      if (!result) {
        // The IDE redirect always prefers source, even over a real .d.ts.
        // Composite fixes the common root, so removing a built input from the
        // redirect inventory cannot change the remaining output names.
        const fileNames = parsed.fileNames.filter(
          (file) =>
            declaration.test(file) ||
            !declarationsByStem.has(
              posix.basename(file, posix.extname(file)),
            ) ||
            !ts
              .getOutputFileNames(parsed, file, false)
              .some((output) => declaration.test(output) && files.has(output)),
        );
        result =
          fileNames.length === parsed.fileNames.length
            ? parsed
            : { ...parsed, fileNames };
        nativeConfigs.set(parsed, result);
      }
      return result;
    },
  };

  function closedCommonRoot(parsed: ts.ParsedCommandLine) {
    if (parsed.options.noResolve) return true;
    // An imported source excluded by the config's file list can still widen
    // tsc's common directory. Every potential emit input must fit the root.
    const inputs = parsed.fileNames.filter((file) => !declaration.test(file));
    if (!inputs.length) return false;
    let root = posix.dirname(inputs[0]!);
    for (const file of inputs)
      while (!below(file, root)) root = posix.dirname(root);
    for (const file of captured.keys()) {
      if (!declaration.test(file) && !below("/" + file, root)) return false;
    }
    if (parsed.options.resolveJsonModule)
      for (const file of files.keys())
        if (file.endsWith(".json") && !below(file, root)) return false;
    return true;
  }

  function mayStrip(root: string) {
    const previous = internalSources.get(root);
    if (previous !== undefined) return previous;
    for (const [path, text] of captured) {
      if (!below("/" + path, root) || !text.includes("@internal")) continue;
      internalSources.set(root, true);
      return true;
    }
    internalSources.set(root, false);
    return false;
  }

  function find(root: string, output: string): OutputProof | undefined {
    const manifest = packages.get(root);
    if (!manifest || packageOf(output) !== root) return undefined;
    const stem = posix.basename(output).replace(outputExtension, "");
    const matches: UnbuiltEntry[] = [];
    for (const config of configs.get(root) ?? []) {
      const { parsed } = config;
      const { options } = parsed;
      const declarations = declaration.test(output);
      const folder = declarations
        ? (options.declarationDir ?? options.outDir)
        : options.outDir;
      if (!folder || !below(output, folder)) continue;
      if (parsed.errors.length || options.outFile) return false;
      if (!config.byStem) {
        config.byStem = new Map();
        for (const file of parsed.fileNames) {
          if (!sourceExtension.test(file) || declaration.test(file)) continue;
          const name = posix.basename(file).replace(sourceExtension, "");
          const paths = config.byStem.get(name) ?? [];
          paths.push(file);
          config.byStem.set(name, paths);
        }
      }
      for (const file of config.byStem.get(stem) ?? []) {
        if (!ts.getOutputFileNames(parsed, file, false).includes(output))
          continue;
        if (
          !captured.has(file.slice(1)) ||
          packageOf(file) !== root ||
          (options.rootDir && !below(file, options.rootDir))
        )
          return false;
        if (!options.rootDir && !options.composite) {
          config.commonRootProven ??= closedCommonRoot(parsed);
          if (!config.commonRootProven) return false;
        }
        if (options.stripInternal && declarations) {
          const sourceRoot =
            options.rootDir ??
            (options.composite ? posix.dirname(config.path) : "/");
          // A re-export can pull in a file outside `include`. Strip checks
          // must cover the source tree that the compiler can actually emit.
          if (mayStrip(sourceRoot)) return false;
        }
        matches.push({
          proof: "tsconfig-emit",
          config: config.path.slice(1),
          output: output.slice(1),
          source: file.slice(1),
        });
      }
    }
    if (!staticEntries.has(root)) {
      const separateConfig = [
        "ts",
        "js",
        "mts",
        "cts",
        "mjs",
        "cjs",
        "json",
      ].some((extension) =>
        files.has(posix.join(root, "tsup.config." + extension)),
      );
      staticEntries.set(
        root,
        separateConfig ? new Map() : tsupEntries(root, manifest),
      );
    }
    const entry = staticEntries.get(root)?.get(output);
    if (
      entry &&
      /\.(?:mts|tsx?)$/.test(entry) &&
      !declaration.test(entry) &&
      captured.has(entry.slice(1)) &&
      packageOf(entry) === root
    )
      matches.push({
        proof: "tsup-entry",
        config: manifest.path,
        output: output.slice(1),
        source: entry.slice(1),
      });
    return matches.every((match) => match.source === matches[0]?.source)
      ? matches[0]
      : "conflicting";
  }
}

/** Trace provenance on the resolutions used by this checker. A transitive
 * target gets a note only if every captured route to it uses an unbuilt entry. */
export function entryProvenance(
  program: ts.Program,
  notes: ReadonlyMap<ts.ResolvedModuleFull, UnbuiltEntry> | undefined,
  captured: ReadonlySet<string>,
) {
  if (!notes?.size) return undefined;
  const compiler = program as ts.Program & {
    forEachResolvedModule(
      callback: (
        resolution: ts.ResolvedModuleWithFailedLookupLocations,
        name: string,
        mode: ts.ResolutionMode,
        from: string,
      ) => void,
    ): void;
    getResolvedModuleFromModuleSpecifier(
      literal: ts.StringLiteralLike,
    ): ts.ResolvedModuleWithFailedLookupLocations | undefined;
  };
  const incoming = new Map<string, { from: string; entry?: UnbuiltEntry }[]>();
  const outgoing = new Map<string, string[]>();
  const reachable = new Set<string>();
  compiler.forEachResolvedModule(
    ({ resolvedModule: resolved }, _name, _mode, from) => {
      const file =
        resolved && program.getSourceFile(resolved.resolvedFileName)?.fileName;
      if (!file || !captured.has(file.slice(1)) || !captured.has(from.slice(1)))
        return;
      const to = file.slice(1);
      const origin = from.slice(1);
      const note = notes.get(resolved);
      const entry = note?.source === to ? note : undefined;
      const before = incoming.get(to) ?? [];
      before.push({ from: origin, ...(entry && { entry }) });
      incoming.set(to, before);
      const after = outgoing.get(origin) ?? [];
      after.push(to);
      outgoing.set(origin, after);
      if (entry) reachable.add(to);
    },
  );
  for (const file of reachable)
    for (const child of outgoing.get(file) ?? []) reachable.add(child);
  const byTarget = new Map<string, Map<string, UnbuiltEntry>>();
  return {
    forSpecifier(literal: ts.StringLiteralLike) {
      const resolved =
        compiler.getResolvedModuleFromModuleSpecifier(literal)?.resolvedModule;
      const note = resolved && notes.get(resolved);
      return note &&
        program.getSourceFile(resolved.resolvedFileName)?.fileName ===
          "/" + note.source
        ? note
        : undefined;
    },
    forTarget(from: string, target: string) {
      if (from === target || !reachable.has(target)) return undefined;
      let evidence = byTarget.get(target);
      if (!evidence) {
        evidence = new Map();
        const ordinary = new Set([target]);
        const pending: { from: string; entry?: UnbuiltEntry }[] = [
          { from: target },
        ];
        for (const step of pending) {
          for (const previous of incoming.get(step.from) ?? []) {
            const entry = step.entry ?? previous.entry;
            if (entry) {
              if (evidence.has(previous.from)) continue;
              evidence.set(previous.from, entry);
              pending.push({ from: previous.from, entry });
            } else if (!ordinary.has(previous.from)) {
              ordinary.add(previous.from);
              pending.push(previous);
            }
          }
        }
        for (const file of ordinary) evidence.delete(file);
        byTarget.set(target, evidence);
      }
      return evidence.get(from);
    },
  };
}
