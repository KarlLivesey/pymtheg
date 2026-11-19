// SPDX-License-Identifier: MIT
import { posix } from "node:path";
import ts from "typescript";
import type { Manifest } from "./workspace.js";

export interface UnbuiltEntry {
  proof: "tsconfig-emit" | "project-reference";
  build: string;
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
  for (const [root, manifest] of packages) {
    const build = plainBuild(root, manifest);
    if (!build) continue;
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
    if (!valid) continue;
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
  const explicitTargets = new Map<
    string,
    { paths: Set<string>; patterns: string[][] }
  >();
  let internalSources: boolean | undefined;
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
    proof(root: string, output: string) {
      // A missing JavaScript entry cannot be checked with the options and
      // types of the TypeScript source that would emit it.
      if (!declaration.test(output) || files.has(output)) return undefined;
      const key = `${root}\0${output}`;
      if (cache.has(key)) return cache.get(key) ?? undefined;
      const match = find(root, output);
      cache.set(key, match ?? null);
      return match;
    },
    forReference(parsed: ts.ParsedCommandLine) {
      if (!parsed.options.composite) return parsed;
      let result = nativeConfigs.get(parsed);
      if (!result) {
        // The IDE redirect always prefers source, even over a real .d.ts.
        // Composite fixes the common root, so removing a built input from the
        // redirect inventory cannot change the remaining output names.
        const strip = parsed.options.stripInternal && mayStrip();
        if (parsed.options.outFile && !strip) return parsed;
        const fileNames = parsed.fileNames.filter(
          (file) =>
            declaration.test(file) ||
            (!strip &&
              (!declarationsByStem.has(
                posix.basename(file, posix.extname(file)),
              ) ||
                !ts
                  .getOutputFileNames(parsed, file, false)
                  .some(
                    (output) => declaration.test(output) && files.has(output),
                  ))),
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

  function mayStrip() {
    if (internalSources === undefined) {
      internalSources = false;
      for (const text of captured.values()) {
        if (!text.includes("@internal")) continue;
        internalSources = true;
        break;
      }
    }
    return internalSources;
  }

  function find(root: string, output: string): OutputProof | undefined {
    const manifest = packages.get(root);
    if (!manifest || packageOf(output) !== root) return undefined;
    const stem = posix.basename(output).replace(outputExtension, "");
    const matches: UnbuiltEntry[] = [];
    for (const config of configs.get(root) ?? []) {
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
        if (options.stripInternal && mayStrip()) return false;
        matches.push({
          proof: "tsconfig-emit",
          build: config.build,
          config: config.path.slice(1),
          output: output.slice(1),
          source: file.slice(1),
        });
      }
    }
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
