// SPDX-License-Identifier: MIT
import { posix } from "node:path";
import ts from "typescript";
import { entryBuildGuards } from "./entry-build.js";
import type { Manifest } from "./workspace.js";

export interface UnbuiltEntry {
  proof: "tsconfig-emit" | "project-reference";
  build: string;
  assumed?: true;
  stripInternal?: true;
  config: string;
  output: string;
  source: string;
}
export type OutputProof = UnbuiltEntry | "conflicting" | false;

const sourceExtension = /\.(?:ts|tsx|mts|cts)$/;
const inputExtension = /\.[cm]?[jt]sx?$/;
const declaration = /\.d\.(?:ts|mts|cts)$/;
const outputExtension = /\.(?:[cm]?js|jsx|d\.[cm]?ts)$/;
const below = (file: string, root: string) =>
  file.startsWith(root === "/" ? "/" : root + "/");

function packagePath(root: string, path: unknown): string | undefined {
  if (
    typeof path !== "string" ||
    posix.isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").includes("..")
  )
    return undefined;
  const file = posix.join(root, path);
  return below(file, root) && !file.split("/").includes("node_modules")
    ? file
    : undefined;
}

const lifecycle = [
  "prebuild",
  "postbuild",
  "preinstall",
  "install",
  "postinstall",
  "preprepare",
  "prepare",
  "postprepare",
  "prepack",
  "postpack",
  "prepublish",
  "prepublishOnly",
];
const scriptsOf = ({ json }: Manifest) =>
  json.scripts && typeof json.scripts === "object"
    ? (json.scripts as Record<string, unknown>)
    : undefined;
const hasLifecycle = (scripts: ReturnType<typeof scriptsOf>) =>
  lifecycle.some((name) => {
    const script = scripts?.[name];
    return (
      script !== undefined && (typeof script !== "string" || !!script.trim())
    );
  });
const literalPath = String.raw`(?:"([\w./-]+)"|'([\w./-]+)'|([\w./-]+))`;
const compilerScript = new RegExp(
  String.raw`^(?:(?:rimraf|rm[ \t]+-rf|del)[ \t]+${literalPath}[ \t]*&&[ \t]*)?tsc(?:[ \t]+(-p|--project|-b|--build)(?:[ \t]+${literalPath})?)?$`,
);

/** Recognize a literal invocation. Build code and lifecycle hooks stay inert. */
function plainBuild(root: string, manifest: Manifest) {
  const scripts = scriptsOf(manifest);
  if (typeof scripts?.build !== "string" || hasLifecycle(scripts)) return;
  const match = compilerScript.exec(scripts.build.trim());
  if (!match) return;
  const [, clean1, clean2, clean3, flag, file1, file2, file3] = match;
  const build = flag === "-b" || flag === "--build";
  const target = file1 ?? file2 ?? file3;
  if ((flag && !build && !target) || target?.startsWith("-")) return;
  const config =
    !target || target === "." || target === "./"
      ? posix.join(root, "tsconfig.json")
      : packagePath(root, target);
  if (!config) return;
  const cleanPath = clean1 ?? clean2 ?? clean3;
  const clean = cleanPath && packagePath(root, cleanPath);
  if (cleanPath && (!clean || cleanPath.startsWith("-"))) return;
  return { config, build, clean: clean || undefined };
}

interface Config {
  path: string;
  parsed: ts.ParsedCommandLine;
  build: string;
  assumed?: true;
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
  const plainPackages = new Set<string>();
  const invalidBuildTrees = new Set<string>();
  for (const [root, manifest] of packages) {
    const build = plainBuild(root, manifest);
    if (!build) continue;
    plainPackages.add(root);
    const clean = build.clean;
    if (
      clean &&
      [...files.keys()].some((file) => file === clean || below(file, clean))
    )
      continue;
    // tsc -b accepts directories as well as JSON files.
    const configPath = (path: string) =>
      parsedConfigs.has(path) ? path : posix.join(path, "tsconfig.json");
    const pending = new Set([configPath(build.config)]);
    const selected: Config[] = [];
    let valid = true;
    for (const path of pending) {
      const parsed = parsedConfigs.get(path);
      if (
        !parsed ||
        parsed.errors.some(({ code }) => code !== 18003) ||
        !below(path, root)
      ) {
        valid = false;
        break;
      }
      if (build.build)
        for (const ref of parsed.projectReferences ?? [])
          pending.add(ts.resolveProjectReferencePath(ref));
      if (
        !parsed.options.noEmit &&
        (parsed.options.declaration || parsed.options.composite) &&
        parsed.fileNames.length &&
        (parsed.options.outDir || parsed.options.declarationDir)
      )
        selected.push({ path, parsed, build: manifest.path });
    }
    if (!valid) {
      if (build.build) invalidBuildTrees.add(root);
      continue;
    }
    for (const config of selected) {
      const owner = packageOf(config.path);
      if (owner === undefined) continue;
      // A package's own build takes precedence over an ancestor build. A
      // plain build-mode reference can supply proof for a scriptless child.
      if (owner !== root) {
        const child = packages.get(owner)!;
        const scripts = scriptsOf(child);
        if (hasLifecycle(scripts) || scripts?.build !== undefined) continue;
      }
      const list = configs.get(owner) ?? [];
      if (!list.some(({ path }) => path === config.path)) list.push(config);
      configs.set(owner, list);
    }
  }
  for (const [path, parsed] of parsedConfigs) {
    const root = packageOf(path);
    if (
      root === undefined ||
      plainPackages.has(root) ||
      (!scriptsOf(packages.get(root)!)?.build &&
        [...invalidBuildTrees].some((parent) => below(root, parent))) ||
      parsed.options.noEmit ||
      !(parsed.options.declaration || parsed.options.composite) ||
      !parsed.fileNames.length ||
      (!parsed.options.outDir && !parsed.options.declarationDir)
    )
      continue;
    const list = configs.get(root) ?? [];
    if (list.some((config) => config.path === path)) continue;
    list.push({ path, parsed, build: packages.get(root)!.path, assumed: true });
    configs.set(root, list);
  }
  const excluded = entryBuildGuards(files, packageOf);
  const explicitTargets = new Map<
    string,
    { paths: Set<string>; patterns: string[][] }
  >();
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
    available: configs.size > 0,
    explicitEntry,
    proof(root: string, output: string, plainOnly: boolean) {
      // A missing JavaScript entry cannot be checked with the options and
      // types of the TypeScript source that would emit it.
      if (!declaration.test(output) || files.has(output)) return undefined;
      const key = `${root}\0${output}\0${plainOnly}`;
      if (cache.has(key)) return cache.get(key) ?? undefined;
      const match = find(root, output, plainOnly);
      cache.set(key, match ?? null);
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

  function explicitEntry(root: string, output: string) {
    const manifest = packages.get(root);
    if (!manifest || files.has(output) || packageOf(output) !== root)
      return false;
    let targets = explicitTargets.get(root);
    if (!targets) {
      const paths = new Set<string>();
      const patterns: string[][] = [];
      const pending = [
        manifest.json.types,
        manifest.json.typings,
        manifest.json.main,
        manifest.json.exports,
        manifest.json.typesVersions,
      ];
      for (const value of pending) {
        if (value && typeof value === "object") {
          for (const child of Object.values(value)) pending.push(child);
          continue;
        }
        const path = packagePath(root, value);
        if (!path) continue;
        if (path.includes("*")) patterns.push(path.split("*"));
        else paths.add(path);
      }
      explicitTargets.set(root, (targets = { paths, patterns }));
    }
    const { paths, patterns } = targets;
    const matches = (path: string) =>
      paths.has(path) ||
      patterns.some((parts) => {
        const fixed = parts.reduce((n, part) => n + part.length, 0);
        const length = (path.length - fixed) / (parts.length - 1);
        const start = parts[0]!.length;
        return (
          Number.isInteger(length) &&
          length >= 0 &&
          parts.join(path.slice(start, start + length)) === path
        );
      });
    if (matches(output)) return true;
    if (!outputExtension.test(output)) return false;
    const stem = output.replace(outputExtension, "");
    return (
      matches(stem) ||
      (posix.basename(stem) === "index" && matches(posix.dirname(stem)))
    );
  }

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
    let present = internalSources.get(root);
    if (present === undefined) {
      present = false;
      for (const [path, text] of captured)
        if (below("/" + path, root) && text.includes("@internal")) {
          present = true;
          break;
        }
      internalSources.set(root, present);
    }
    return present;
  }

  function find(
    root: string,
    output: string,
    plainOnly: boolean,
  ): OutputProof | undefined {
    const manifest = packages.get(root);
    if (!manifest || packageOf(output) !== root) return undefined;
    const stem = posix.basename(output).replace(outputExtension, "");
    const matches: UnbuiltEntry[] = [];
    for (const config of configs.get(root) ?? []) {
      if (plainOnly && config.assumed) continue;
      const { parsed } = config;
      const { options } = parsed;
      const folder = options.declarationDir ?? options.outDir;
      if (!folder || !below(output, folder)) continue;
      if (parsed.errors.length || options.outFile) return false;
      if (!config.byStem) {
        config.byStem = new Map();
        for (const file of parsed.fileNames) {
          if (!inputExtension.test(file) || declaration.test(file)) continue;
          const name = posix.basename(file).replace(inputExtension, "");
          const paths = config.byStem.get(name) ?? [];
          paths.push(file);
          config.byStem.set(name, paths);
        }
      }
      for (const file of config.byStem.get(stem) ?? []) {
        if (!ts.getOutputFileNames(parsed, file, false).includes(output))
          continue;
        if (
          !sourceExtension.test(file) ||
          !captured.has(file.slice(1)) ||
          packageOf(file) !== root ||
          (options.rootDir && !below(file, options.rootDir))
        )
          return false;
        if (!options.rootDir && !options.composite) {
          config.commonRootProven ??= closedCommonRoot(parsed);
          if (!config.commonRootProven) return false;
        }
        // A re-export can pull in a source outside the configured input set.
        const sourceRoot = config.assumed
          ? (options.rootDir ??
            (options.composite ? posix.dirname(config.path) : "/"))
          : "/";
        if (options.stripInternal && mayStrip(sourceRoot)) return false;
        if (config.assumed && excluded(root, manifest, file, output))
          return false;
        matches.push({
          proof: "tsconfig-emit",
          build: config.build,
          ...(config.assumed && { assumed: true }),
          ...(options.stripInternal && { stripInternal: true }),
          config: config.path.slice(1),
          output: output.slice(1),
          source: file.slice(1),
        });
      }
    }
    return matches.every((match) => match.source === matches[0]?.source)
      ? (matches.find((match) => !match.assumed) ?? matches[0])
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
  const compiler = program as ts.Program & {
    // program-reader: module-resolution (scoped.ts PROGRAM_READERS)
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
    forEachResolvedProjectReference(
      callback: (ref: ts.ResolvedProjectReference) => void,
    ): void;
    getRedirectFromOutput(
      path: string,
    ): { resolvedRef: ts.ResolvedProjectReference } | undefined;
    realpath?(path: string): string;
  };
  let stripReferences = [...(notes?.values() ?? [])].some(
    ({ stripInternal }) => stripInternal,
  );
  compiler.forEachResolvedProjectReference(({ commandLine }) => {
    if (commandLine.options.stripInternal) stripReferences = true;
  });
  if (!notes?.size && !stripReferences) return undefined;
  function strips(resolved: ts.ResolvedModuleFull, file: string) {
    if (notes?.get(resolved)?.stripInternal) return true;
    const output = resolved.resolvedFileName;
    if (!stripReferences || !declaration.test(output) || file === output)
      return false;
    const ref =
      compiler.getRedirectFromOutput(output) ??
      compiler.getRedirectFromOutput(compiler.realpath?.(output) ?? output);
    return ref?.resolvedRef.commandLine.options.stripInternal === true;
  }
  const incoming = new Map<
    string,
    { from: string; entry?: UnbuiltEntry; stripped: boolean }[]
  >();
  const outgoing = new Map<string, string[]>();
  const reachable = new Set<string>();
  // program-reader: module-resolution (scoped.ts PROGRAM_READERS)
  compiler.forEachResolvedModule(
    ({ resolvedModule: resolved }, _name, _mode, from) => {
      const file =
        resolved && program.getSourceFile(resolved.resolvedFileName)?.fileName;
      if (
        !file ||
        !resolved ||
        !captured.has(file.slice(1)) ||
        !captured.has(from.slice(1))
      )
        return;
      const to = file.slice(1);
      const origin = from.slice(1);
      const note = notes?.get(resolved);
      const entry = note?.source === to ? note : undefined;
      const before = incoming.get(to) ?? [];
      before.push({
        from: origin,
        ...(entry && { entry }),
        stripped: strips(resolved, file),
      });
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
  const strippedByTarget = new Map<string, Set<string>>();
  const internal = ts as typeof ts & {
    isInternalDeclaration(node: ts.Node, file: ts.SourceFile): boolean;
  };
  const internalNodes = new WeakMap<ts.Node, boolean>();
  const hasInternal = new WeakMap<ts.SourceFile, boolean>();
  function marked(node: ts.Node, file: ts.SourceFile): boolean {
    if (ts.isSourceFile(node)) return false;
    const cached = internalNodes.get(node);
    if (cached !== undefined) return cached;
    const hidden =
      internal.isInternalDeclaration(node, file) || marked(node.parent, file);
    internalNodes.set(node, hidden);
    return hidden;
  }
  return {
    hasEntries: reachable.size > 0,
    forSpecifier(literal: ts.StringLiteralLike) {
      const resolved =
        compiler.getResolvedModuleFromModuleSpecifier(literal)?.resolvedModule;
      const note = resolved && notes?.get(resolved);
      return note &&
        program.getSourceFile(resolved.resolvedFileName)?.fileName ===
          "/" + note.source
        ? note
        : undefined;
    },
    isStripped(from: string, node: ts.Node, specifier?: ts.StringLiteralLike) {
      if (!stripReferences || ts.isSourceFile(node)) return false;
      const file = node.getSourceFile();
      const target = file.fileName.slice(1);
      if (from === target) return false;
      let annotated = hasInternal.get(file);
      if (annotated === undefined) {
        annotated = file.text.includes("@internal");
        hasInternal.set(file, annotated);
      }
      if (!annotated || !marked(node, file)) return false;
      const resolved =
        specifier &&
        compiler.getResolvedModuleFromModuleSpecifier(specifier)
          ?.resolvedModule;
      if (resolved) {
        const source = program.getSourceFile(
          resolved.resolvedFileName,
        )?.fileName;
        if (source) {
          if (strips(resolved, source)) return true;
          if (source === file.fileName) return false;
          from = source.slice(1);
        }
      }
      let stripped = strippedByTarget.get(target);
      if (!stripped) {
        stripped = new Set();
        const ordinary = new Set([target]);
        const pending = [{ file: target, stripped: false }];
        for (const step of pending) {
          for (const edge of incoming.get(step.file) ?? []) {
            const viaStrip = step.stripped || edge.stripped;
            const seen = viaStrip ? stripped : ordinary;
            if (seen.has(edge.from)) continue;
            seen.add(edge.from);
            pending.push({ file: edge.from, stripped: viaStrip });
          }
        }
        strippedByTarget.set(target, stripped);
      }
      return stripped.has(from);
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
