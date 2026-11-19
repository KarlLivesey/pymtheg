// SPDX-License-Identifier: MIT
import { posix as p } from "node:path";
import type { ContextFile } from "../../types.js";
import { readToml, table, type TomlTable, type TomlValue } from "./toml.js";

type Source = { fields: TomlTable; directory?: string };
type DependencySource = {
  identity?: string | undefined;
  directory?: string | null | undefined;
};
type ResolveSource = (
  fields: TomlTable | undefined,
  macroPackage?: string,
) => DependencySource;
const text = (value: TomlValue | undefined) =>
  typeof value === "string" && value ? value : undefined;
const cratesIo = "https://github.com/rust-lang/crates.io-index";
const refs = ["branch", "tag", "rev"] as const;

function canonicalUrl(raw: string): string | undefined {
  try {
    let url = new URL(raw);
    if (!url.pathname.startsWith("/")) return;
    const plain = !url.protocol.includes("+");
    if (plain && url.hostname === "github.com") {
      url = new URL(url.href.replace(/^[^:]+:/, "https:"));
      url.pathname = url.pathname.toLowerCase();
    }
    const path = url.pathname.replace(/\/$/, "");
    url.pathname = plain ? path.replace(/\.git$/, "") : path;
    return url.href;
  } catch {
    return undefined;
  }
}

function registryIdentity(raw: string): string | undefined {
  if (raw === cratesIo) return "crates-io";
  const url = canonicalUrl(raw);
  if (url === cratesIo || url === "sparse+https://index.crates.io")
    return "crates-io";
  return url && `registry:${url}`;
}

function gitIdentity(
  url: string,
  ref: string,
  value: string,
): string | undefined {
  const canonical = canonicalUrl(url);
  return canonical && `git:${JSON.stringify([canonical, ref, value])}`;
}

function configuredGit(fields: TomlTable): string | undefined {
  const git = text(fields.git);
  const declared = refs.filter((key) => fields[key] !== undefined);
  if (!git || declared.length > 1) return;
  const ref = declared[0];
  const value = ref ? text(fields[ref]) : "";
  return value === undefined ? undefined : gitIdentity(git, ref ?? "", value);
}

/** Cargo source identity excludes the precise commit hash in a lock row. */
export function lockSource(raw: TomlValue | undefined): string | undefined {
  if (typeof raw !== "string") return;
  if (raw.startsWith("registry+")) return registryIdentity(raw.slice(9));
  if (raw.startsWith("sparse+")) return registryIdentity(raw);
  if (!raw.startsWith("git+")) return;
  try {
    const url = new URL(raw.slice(4));
    const selectors = [...url.searchParams];
    const [key, value] = selectors[0] ?? ["", ""];
    const ref = key === "ref" ? "branch" : key;
    if (selectors.length > 1 || (ref && !refs.some((k) => k === ref))) return;
    url.search = url.hash = "";
    return gitIdentity(url.href, ref, value);
  } catch {
    return undefined;
  }
}

/** Cargo directory-source facts from captured project configs. A null result
 * is a replacement whose location cannot be established from the snapshot. */
export function cargoSources(
  contexts: readonly Pick<ContextFile, "path" | "status" | "text">[],
): (dir: string) => ResolveSource {
  const configs = new Map<
    string,
    { canonical: boolean; value: TomlTable | null }
  >();
  for (const c of contexts) {
    if (!/(?:^|\/)\.cargo\/config(?:\.toml)?$/.test(c.path)) continue;
    const dir = p.dirname(p.dirname(c.path));
    const canonical = p.basename(c.path) === "config";
    if (!canonical && configs.get(dir)?.canonical) continue;
    configs.set(dir, {
      canonical,
      value: c.status === "clean" ? readToml(c.text) : null,
    });
  }
  const cache = new Map<string, ResolveSource>();
  function readSources(dir: string): ResolveSource {
    const unknown = (fields: TomlTable | undefined): DependencySource =>
      fields?.path === undefined ? { directory: null } : {};
    const ancestry = [dir];
    while (dir !== ".") {
      dir = p.dirname(dir);
      ancestry.push(dir);
    }
    const sources = new Map<string, Source>();
    const registries = new Map<string, string | undefined>();
    const patched = new Set<string>();
    let unknownOverride = false;
    for (const base of ancestry.reverse()) {
      const config = configs.get(base);
      if (!config) continue;
      if (!config.value) return unknown;
      const paths = config.value.paths;
      if (paths !== undefined && (!Array.isArray(paths) || paths.length > 0))
        unknownOverride = true;
      const patch = table(config.value.patch);
      if (config.value.patch !== undefined && !patch) unknownOverride = true;
      for (const group of Object.values(patch ?? {})) {
        const entries = table(group);
        if (!entries) unknownOverride = true;
        for (const [alias, entry] of Object.entries(entries ?? {}))
          patched.add(text(table(entry)?.package) ?? alias);
      }
      const indexes = table(config.value.registries);
      if (config.value.registries !== undefined && !indexes) return unknown;
      for (const [name, value] of Object.entries(indexes ?? {})) {
        const index = table(value)?.index;
        if (index !== undefined) registries.set(name, text(index));
      }
      if (config.value.source === undefined) continue;
      const sections = table(config.value.source);
      if (!sections) return unknown;
      for (const [name, value] of Object.entries(sections)) {
        const fields = table(value);
        if (!fields) return unknown;
        const previous = sources.get(name);
        const directory = fields.directory;
        if (
          directory !== undefined &&
          (typeof directory !== "string" || !directory)
        )
          return unknown;
        sources.set(name, {
          fields: { ...previous?.fields, ...fields },
          ...(typeof directory === "string"
            ? {
                directory: p.isAbsolute(directory)
                  ? directory
                  : p.join(base, directory),
              }
            : previous?.directory === undefined
              ? {}
              : { directory: previous.directory }),
        });
      }
    }
    const namesByIdentity = new Map<string, string | null>();
    for (const [name, { fields }] of sources) {
      const registry = text(fields.registry);
      const identity =
        fields.git !== undefined
          ? configuredGit(fields)
          : registry
            ? registryIdentity(registry)
            : name === "crates-io"
              ? name
              : undefined;
      if (!identity) {
        if (fields.git !== undefined || fields.registry !== undefined)
          return unknown;
        continue;
      }
      namesByIdentity.set(
        identity,
        namesByIdentity.has(identity) ? null : name,
      );
    }
    const hasRegistryReplacement = [...sources].some(
      ([name, { fields }]) =>
        (name === "crates-io" || fields.registry !== undefined) &&
        fields["replace-with"] !== undefined,
    );
    return (fields, macroPackage) => {
      if (macroPackage && (unknownOverride || patched.has(macroPackage)))
        return { directory: null };
      if (fields?.path !== undefined) return {};
      const registry =
        text(fields?.["registry-index"]) ??
        (fields?.registry === undefined || fields.registry === "crates-io"
          ? cratesIo
          : registries.get(text(fields.registry) ?? ""));
      const identity =
        fields?.git !== undefined
          ? configuredGit(fields)
          : registry
            ? registryIdentity(registry)
            : undefined;
      if (!identity)
        return {
          directory:
            fields?.git !== undefined || hasRegistryReplacement
              ? null
              : undefined,
        };
      let name = namesByIdentity.get(identity);
      if (name === null) return { identity, directory: null };
      const seen = new Set<string>();
      while (name !== undefined) {
        if (seen.has(name)) return { identity, directory: null };
        seen.add(name);
        const source = sources.get(name);
        const next = source?.fields["replace-with"];
        if (next === undefined)
          return {
            identity,
            directory:
              source?.directory ?? (seen.size === 1 ? undefined : null),
          };
        if (typeof next !== "string" || !next)
          return { identity, directory: null };
        name = next;
      }
      return { identity };
    };
  }
  return (dir) => {
    const existing = cache.get(dir);
    if (existing) return existing;
    const loaded = readSources(dir);
    cache.set(dir, loaded);
    return loaded;
  };
}
