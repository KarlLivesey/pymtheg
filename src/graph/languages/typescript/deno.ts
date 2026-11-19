// SPDX-License-Identifier: MIT
import { posix } from "node:path";
import ts from "typescript";
import type { ContextFile } from "../../types.js";

export const denoConfigNames = ["deno.json", "deno.jsonc"] as const;
export const importMapNames = [
  "import_map.json",
  "import-map.json",
  "importMap.json",
  "import_map.jsonc",
  "import-map.jsonc",
] as const;

const relative = (path: string) => /^\.\.?(?:\/|$)/.test(path);
const protocol = (path: string) => /^[a-z][a-z+.-]*:/i.test(path);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function read(file: ContextFile) {
  const parsed = ts.parseConfigFileTextToJson(file.path, file.text);
  return parsed.error ? undefined : record(parsed.config);
}

/** Keep checkout paths distinct from external URLs and absolute host paths. */
function checkoutPath(directory: string, path: string): string | undefined {
  if (/[\\%?#]/.test(path)) return undefined;
  const result = posix.join(directory, path);
  if (result === "." || result === "./") return "";
  return result !== ".." && !result.startsWith("../") ? result : undefined;
}

interface Mapping {
  prefix: boolean;
  key: string;
  target: string | undefined;
}

function mappings(input: unknown, base: string): Mapping[] | undefined {
  const object = input === undefined ? {} : record(input);
  if (!object) return undefined;
  const result: Mapping[] = [];
  for (const [key, raw] of Object.entries(object)) {
    if (!key) continue;
    const name = relative(key) ? checkoutPath(base, key) : key;
    if (name === undefined) continue;
    const prefix = key.endsWith("/");
    // Deno's inline maps expand a package root mapping to its subpaths too.
    const target =
      typeof raw === "string"
        ? relative(raw)
          ? checkoutPath(base, raw)
          : protocol(raw)
            ? raw
            : undefined
        : undefined;
    result.push({ key: name, prefix, target });
  }
  return result.sort((a, b) => b.key.length - a.key.length);
}

function mapFile(
  file: ContextFile,
  data: Record<string, unknown>,
  inline: boolean,
) {
  const base = posix.dirname(file.path);
  const entries = (input: unknown) => {
    const result = mappings(input, base);
    if (inline && result) {
      const keys = new Set(result.map(({ key }) => key));
      for (const { key, prefix, target } of [...result])
        if (
          !prefix &&
          target &&
          /^(?:npm|jsr):/.test(target) &&
          !keys.has(key + "/")
        )
          result.push({ key: key + "/", prefix: true, target: target + "/" });
      result.sort((a, b) => b.key.length - a.key.length);
    }
    return result;
  };
  const imports = entries(data.imports);
  const scopes = data.scopes === undefined ? {} : record(data.scopes);
  if (!imports || !scopes) return undefined;
  const scoped = [];
  for (const [scope, value] of Object.entries(scopes)) {
    const path = relative(scope) ? checkoutPath(base, scope) : undefined;
    if (path === undefined) continue;
    const entriesForScope = entries(value);
    if (!entriesForScope) return undefined;
    scoped.push({
      path,
      prefix: scope.endsWith("/"),
      entries: entriesForScope,
    });
  }
  scoped.sort((a, b) => b.path.length - a.path.length);
  return { imports, scoped };
}

/** A selected snapshot specifier or undefined if Deno's route is unverified. */
export function denoImports(contexts: readonly ContextFile[]) {
  const byPath = new Map(contexts.map((item) => [item.path, item]));
  const mapNames: readonly string[] = importMapNames;
  const configNames: readonly string[] = denoConfigNames;
  type MapFile = NonNullable<ReturnType<typeof mapFile>>;
  const maps = new Map<string, MapFile | null>();
  for (const file of contexts) {
    if (
      !mapNames.includes(posix.basename(file.path)) &&
      !configNames.includes(posix.basename(file.path))
    )
      continue;
    const root = posix.dirname(file.path);
    const config = configNames
      .map((name) => byPath.get(posix.join(root, name)))
      .find((value) => value !== undefined);
    if (config && config !== file) continue;
    if (!config && maps.has(root)) {
      maps.set(root, null);
      continue;
    }
    let source = file;
    let data = read(file);
    if (config && typeof data?.importMap === "string") {
      const reference = data.importMap;
      const path =
        !protocol(reference) && !reference.startsWith("/")
          ? checkoutPath(root, reference)
          : undefined;
      const captured = path === undefined ? undefined : byPath.get(path);
      if (!captured || data.imports !== undefined || data.scopes !== undefined)
        data = undefined;
      else {
        source = captured;
        data = read(captured);
      }
    } else if (config && data?.importMap !== undefined) data = undefined;
    maps.set(root, (data && mapFile(source, data, source === config)) ?? null);
  }
  const owners = new Map<string, MapFile | null | undefined>();
  function owner(from: string) {
    if (owners.has(from)) return owners.get(from);
    let directory = posix.dirname(from);
    while (!maps.has(directory) && directory !== ".")
      directory = posix.dirname(directory);
    const found = maps.get(directory);
    owners.set(from, found);
    return found;
  }
  return {
    active: maps.size > 0,
    select(specifier: string, from: string): string | undefined {
      if (!maps.size) return specifier;
      const map = owner(from);
      if (map === undefined) return specifier;
      if (map === null) return undefined;
      const name = relative(specifier)
        ? checkoutPath(posix.dirname(from), specifier)
        : specifier;
      if (name === undefined) return undefined;
      {
        const scopes = map.scoped
          .filter((scope) =>
            scope.prefix ? from.startsWith(scope.path) : from === scope.path,
          )
          .map((scope) => scope.entries);
        for (const entries of [...scopes, map.imports]) {
          const entry = entries.find(({ key, prefix }) =>
            prefix ? name.startsWith(key) : name === key,
          );
          if (!entry) continue;
          if (entry.target === undefined) return undefined;
          const suffix = entry.prefix ? name.slice(entry.key.length) : "";
          if (
            entry.prefix &&
            ((entry.target !== "" && !entry.target.endsWith("/")) ||
              suffix.split("/").some((part) => part === "..") ||
              /[\\%?#]/.test(suffix))
          )
            return undefined;
          const target = entry.target + suffix;
          if (protocol(target)) return target;
          const path = posix.relative(posix.dirname(from), target);
          return relative(path) ? path : "./" + path;
        }
      }
      return relative(specifier) || /^(?:npm|jsr|node):/.test(specifier)
        ? specifier
        : undefined;
    },
  };
}
