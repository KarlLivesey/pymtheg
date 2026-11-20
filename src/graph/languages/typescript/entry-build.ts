// SPDX-License-Identifier: MIT
import { posix } from "node:path";
import type { Manifest } from "./workspace.js";

export const unbuiltEntryAssumption = "ts-unbuilt-entry-is-compiler-emit";
export const unbuiltEntryAssumptionText =
  "The package's build leaves, at this entry path, declarations whose exports are those the TypeScript compiler would emit for the mapped source file.";

export const entryBuildContext = [
  "*api-extractor*.json",
  "rollup*.json",
  "vite.config.json",
] as const;

const declarationRollup =
  /\b(?:api-extractor|dts-bundle-generator|rollup-plugin-dts)\b/;
const configName =
  /^(?:rollup|vite)\.config(?:\.[\w-]+)*\.[cm]?[jt]s$|^(?:rollup|vite).*\.json$/;
const extractorConfig =
  /(?:^|[.-])api-extractor(?:[.-]|$).*\.json$|^api-extractor\.json$/;

/** These are literal command segments, read from the manifest as data.
 * Quoting is preserved for paths. We never expand shell syntax. */
const separators = /[;&|\n]/;
const shellTokens = /(?:"[^"]*"|'[^']*'|[^"'\s;&|])+/g;
const entryExtension = /\.[cm]?[jt]sx?$/i;
const buildTools = new Set(["tsup", "tsdown", "unbuild", "esbuild", "rollup"]);
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

export function entryBuildGuards(
  files: ReadonlyMap<string, string>,
  packageOf: (file: string) => string | undefined,
) {
  const declarationRollups = new Set<string>();
  for (const [path, text] of files) {
    const name = posix.basename(path);
    if (
      !extractorConfig.test(name) &&
      !(
        configName.test(name) &&
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
      entries: Set<string>;
      scripts: string[];
    }
  >();
  return (root: string, manifest: Manifest, source: string, output: string) => {
    let build = cache.get(root);
    if (!build) {
      const commands = scriptCommands(manifest);
      const entries = new Set<string>();
      const scripts: string[] = [];
      let rollup = declarationRollups.has(root);
      for (const command of commands)
        for (const segment of command.split(separators)) {
          const words = (segment.match(shellTokens) ?? []).map((word) =>
            word.replace(
              /"([^"]*)"|'([^']*)'/g,
              (_whole, double, single) => double ?? single,
            ),
          );
          const node = words.indexOf("node");
          if (node >= 0 && entryExtension.test(words[node + 1] ?? ""))
            scripts.push(posix.resolve(root, words[node + 1]!));
          const at = words.findIndex((word) => buildTools.has(word));
          if (at < 0) continue;
          for (let i = at + 1; i < words.length; i++) {
            const word = words[i]!;
            const [flag, value] = word.split("=", 2);
            if (
              words[at] === "rollup" &&
              (flag === "-c" || flag === "--config")
            ) {
              const next = value ?? words[i + 1];
              if (next && !next.startsWith("-")) {
                if (value === undefined) i++;
                const path = posix.resolve(root, next);
                const config = packageOf(path) === root && files.get(path);
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
      };
      cache.set(root, build);
    }
    if (build.rollup) return "declaration-rollup";
    if (build.wrapper) return "wireit-wrapper";
    if (build.entries.size && !build.entries.has(source))
      return "different-entry";
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
