// SPDX-License-Identifier: MIT
import { posix } from "node:path";
import ts from "typescript";
import type { ContextFile } from "../../types.js";

export interface Manifest {
  path: string;
  json: Record<string, unknown>;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const packageName = /^(?:@[\w.-]+\/)?[\w.-]+$/;
const validPackageName = (name: string) =>
  packageName.test(name) &&
  name.split("/").every((part) => part !== "." && part !== "..");
// The compiler uses these semver parsers for its own package metadata.
type Version = object;
const semver = ts as typeof ts & {
  Version: { tryParse(value: string): Version | undefined };
  VersionRange: {
    tryParse(value: string): { test(version: Version): boolean } | undefined;
  };
};
function matchesVersion(range: string, value: unknown): boolean {
  const version = typeof value === "string" && semver.Version.tryParse(value);
  return !!(version && semver.VersionRange.tryParse(range)?.test(version));
}
export const registryRange = (value: string): boolean =>
  /^[a-z][\w.-]*$/i.test(value) || !!semver.VersionRange.tryParse(value);

type Catalog = ReadonlyMap<string, ReadonlyMap<string, string>>;
interface WorkspaceCatalog {
  source: string;
  entries: Catalog;
}
export type WorkspaceCatalogs = ReadonlyMap<string, WorkspaceCatalog>;

/** Capture plain block catalogs. Indirection or duplicate keys leave the catalog unverified. */
function readCatalogs(text: string): Catalog {
  const sections = new Map<string, string[]>();
  let section: string[] | undefined;
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const head = /^(catalogs?)\s*:\s*(.*)$/.exec(line);
    if (head) {
      const name = head[1]!;
      if (sections.has(name) || !/^(?:#.*)?$/.test(head[2]!.trim()))
        return new Map();
      sections.set(name, (section = []));
    } else if (!/^ +\S/.test(line)) section = undefined;
    else if (section) section.push(line);
  }
  const pair =
    /^( +)(?:'([^']+)'|"([^"\\]+)"|([@\w./-]+))\s*:\s*(?:'([^']*)'|"([^"\\]*)"|([^#]*?))\s*(?:\s+#.*)?$/;
  const result = new Map<string, Map<string, string>>();
  const add = (name: string, lines: readonly string[]) => {
    if (result.has(name)) return false;
    const values = new Map<string, string>();
    let indent: number | undefined;
    for (const line of lines) {
      const row = pair.exec(line);
      if (!row) return false;
      indent ??= row[1]!.length;
      if (row[1]!.length !== indent) return false;
      const key = (row[2] ?? row[3] ?? row[4])!;
      const value = (row[5] ?? row[6] ?? row[7] ?? "").trim();
      if (!validPackageName(key) || !value || values.has(key)) return false;
      values.set(key, value);
    }
    result.set(name, values);
    return true;
  };
  const defaultCatalog = sections.get("catalog");
  if (defaultCatalog && !add("default", defaultCatalog)) return new Map();
  const named = sections.get("catalogs") ?? [];
  if (named.length) {
    const indent = /^ +/.exec(named[0]!)![0].length;
    let name: string | undefined;
    let lines: string[] = [];
    for (const line of named) {
      const depth = /^ +/.exec(line)![0].length;
      if (depth > indent && name) {
        lines.push(line);
        continue;
      }
      if (depth !== indent || (name && !add(name, lines))) return new Map();
      const header = pair.exec(line);
      name = (header && (header[2] ?? header[3] ?? header[4])) || undefined;
      if (!name || (header?.[5] ?? header?.[6] ?? header?.[7]?.trim()))
        return new Map();
      lines = [];
    }
    if (name && !add(name, lines)) return new Map();
  }
  return result;
}

export function dependencyFromCatalog(
  catalog: WorkspaceCatalog | undefined,
  name: string,
  value: string,
): string | undefined {
  if (!value.startsWith("catalog:")) return value;
  return catalog?.entries
    .get(value.slice("catalog:".length) || "default")
    ?.get(name);
}

/** Bun records default and named catalogs in the root workspace manifest. */
function bunCatalogs(workspaces: unknown): Catalog {
  const { catalog, catalogs } = record(workspaces);
  const named = Object.entries(record(catalogs));
  if (catalog !== undefined) named.push(["default", catalog]);
  const result = new Map<string, Map<string, string>>();
  for (const [name, raw] of named) {
    if (result.has(name)) return new Map();
    const entries = new Map<string, string>();
    for (const [key, value] of Object.entries(record(raw)))
      if (validPackageName(key) && typeof value === "string" && value)
        entries.set(key, value);
    result.set(name, entries);
  }
  return result;
}
const checkoutPath = (directory: string, path: string): string | undefined => {
  if (!path || path.startsWith("/") || path.includes("\\")) return undefined;
  const target = posix.join(directory, path);
  return target === ".." || target.startsWith("../") ? undefined : target;
};

/** Read only the pnpm settings that establish package membership and linking. */
function pnpmSettings(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headings = lines.filter((line) => /^packages\s*:/.test(line));
  const header = headings[0];
  const patterns: string[] = [];
  if (headings.length > 1) return undefined;
  if (!header) {
    if (
      lines.some(
        (line) => line && !/^(?:\s|#|---$|\.\.\.$|[\w-]+\s*:)/.test(line),
      )
    )
      return undefined;
    patterns.push("**");
  } else if (/^packages\s*:\s*(?:#.*)?$/.test(header)) {
    let indent: number | undefined;
    for (const line of lines.slice(lines.indexOf(header) + 1)) {
      if (/^\s*(?:#.*)?$/.test(line)) continue;
      const part =
        /^( *)- +(?:'([^']*)'|"([^"\\]*)"|([^'"# ][^#]*?))\s*(?:#.*)?$/.exec(
          line,
        );
      if (!part) {
        if (/^\s/.test(line) || /^-/.test(line)) return undefined;
        break;
      }
      indent ??= part[1]!.length;
      if (part[1]!.length !== indent) return undefined;
      patterns.push((part[2] ?? part[3] ?? part[4]!).trimEnd());
    }
  } else if (!/^packages\s*:\s*\[\s*\]\s*(?:#.*)?$/.test(header)) {
    return undefined;
  }
  const linkVersions = lines.some((line) =>
    /^linkWorkspacePackages\s*:\s*(?:true|deep)\s*(?:#.*)?$/.test(line),
  );
  return { patterns, linkVersions };
}

function workspaceMember(
  root: string,
  patterns: readonly string[],
  directory: string,
): boolean {
  const relative = posix.relative(root, directory);
  if (relative === ".." || relative.startsWith("../")) return false;
  if (!relative) return true;
  const matches = (pattern: string) =>
    posix.matchesGlob(
      relative,
      pattern.replace(/^\.\//, "").replace(/\/$/, ""),
    );
  return (
    patterns.some((pattern) => !pattern.startsWith("!") && matches(pattern)) &&
    !patterns.some(
      (pattern) => pattern.startsWith("!") && matches(pattern.slice(1)),
    )
  );
}

function members(
  root: string,
  patterns: readonly string[],
  manifests: readonly Manifest[],
  includeRootPackage = false,
) {
  const packages = new Map<string, string | undefined>();
  const paths = new Set<string>();
  for (const { path, json } of manifests) {
    const local = posix.dirname(path);
    if (!workspaceMember(root, patterns, local)) continue;
    paths.add(local);
    if (local === root && !includeRootPackage) continue;
    const name = json.name;
    if (typeof name === "string" && validPackageName(name))
      packages.set(name, packages.has(name) ? undefined : local);
  }
  return { packages, paths };
}

/** Model workspace installs and roots whose package membership is unreadable. */
export function workspaceLinks(
  manifests: readonly Manifest[],
  contexts: readonly ContextFile[],
  unreadable: readonly string[],
) {
  const links = new Map<string, string>();
  const incompleteRoots = new Set(unreadable);
  const noteIncomplete = (root: string, patterns: readonly string[]) => {
    if (
      unreadable.some((directory) => workspaceMember(root, patterns, directory))
    )
      incompleteRoots.add(root);
  };
  const byDirectory = new Map(
    manifests.map(({ path, json }) => [posix.dirname(path), json]),
  );
  const roots = new Map<
    string,
    {
      packages: Map<string, string | undefined>;
      paths: ReadonlySet<string>;
      pnpm: boolean;
      hoist: boolean;
      linkVersions: boolean;
    }
  >();
  const pnpmFiles = new Set<string>();
  const catalogs = new Map<string, WorkspaceCatalog>();
  for (const file of contexts) {
    if (posix.basename(file.path) !== "pnpm-workspace.yaml") continue;
    const root = posix.dirname(file.path);
    pnpmFiles.add(root);
    catalogs.set(root, { source: file.path, entries: readCatalogs(file.text) });
    const settings = pnpmSettings(file.text);
    if (settings) {
      noteIncomplete(root, settings.patterns);
      roots.set(root, {
        ...members(root, settings.patterns, manifests, true),
        pnpm: true,
        hoist: false,
        linkVersions: settings.linkVersions,
      });
    }
  }
  for (const [root, json] of byDirectory) {
    if (pnpmFiles.has(root) || /^pnpm@/.test(String(json.packageManager)))
      continue;
    const declared = json.workspaces;
    const patterns = Array.isArray(declared)
      ? declared
      : record(declared).packages;
    if (
      Array.isArray(patterns) &&
      patterns.every((pattern) => typeof pattern === "string")
    ) {
      const yarnMajor = /^yarn@(\d+)/.exec(String(json.packageManager))?.[1];
      noteIncomplete(root, patterns);
      roots.set(root, {
        ...members(root, patterns, manifests),
        pnpm: false,
        // Yarn's Plug'n'Play layout only grants access to declared packages.
        hoist: yarnMajor === undefined || Number(yarnMajor) < 2,
        linkVersions: false,
      });
      if (/^bun@/.test(String(json.packageManager)))
        catalogs.set(root, {
          source: posix.join(root, "package.json"),
          entries: bunCatalogs(declared),
        });
    }
  }
  const add = (directory: string, name: string, target: string) =>
    links.set(posix.join(directory, "node_modules", name), target);
  const conflicts = new Set<string>();

  for (const [directory, json] of byDirectory) {
    let root = directory;
    while (root !== "." && !roots.has(root) && !pnpmFiles.has(root))
      root = posix.dirname(root);
    const workspace = roots.get(root);
    const inWorkspace = workspace?.paths.has(directory) ? workspace : undefined;
    const dependencies = {
      ...record(json.devDependencies),
      ...record(json.dependencies),
      ...record(json.optionalDependencies),
    };
    for (const [name, value] of Object.entries(dependencies)) {
      if (!validPackageName(name) || typeof value !== "string") continue;
      const specifier = dependencyFromCatalog(catalogs.get(root), name, value);
      if (!specifier) continue;
      let target: string | undefined;
      if (/^(?:file|link|portal):/.test(specifier)) {
        target = checkoutPath(
          directory,
          specifier.slice(specifier.indexOf(":") + 1),
        );
      } else if (inWorkspace && specifier.startsWith("workspace:")) {
        const selector = specifier.slice("workspace:".length);
        if (/^\.\.?\//.test(selector)) {
          target = checkoutPath(directory, selector);
          if (target !== undefined && !inWorkspace.paths.has(target))
            target = undefined;
        } else {
          const alias = /^((?:@[\w.-]+\/)?[\w.-]+)@(.+)$/.exec(selector);
          target = inWorkspace.packages.get(alias?.[1] ?? name);
          const version = alias?.[2] ?? selector;
          if (
            target !== undefined &&
            !["*", "~", "^"].includes(version) &&
            !matchesVersion(version, byDirectory.get(target)?.version)
          )
            target = undefined;
        }
      } else if (
        inWorkspace &&
        (!inWorkspace.pnpm || inWorkspace.linkVersions)
      ) {
        const member = inWorkspace.packages.get(name);
        if (
          member !== undefined &&
          matchesVersion(specifier, byDirectory.get(member)?.version)
        )
          target = member;
      }
      if (target !== undefined && byDirectory.has(target))
        add(directory, name, target);
      // A conflicting dependency can be installed below a hoisted workspace
      // dependency. Without an install tree, its hoisted name is not proof.
      const hoisted = workspace?.packages.get(name);
      if (
        inWorkspace &&
        inWorkspace.hoist &&
        hoisted !== undefined &&
        hoisted !== target
      )
        conflicts.add(posix.join(root, "node_modules", name));
    }
  }
  for (const link of conflicts) links.delete(link);
  for (const [root, workspace] of roots)
    if (workspace.hoist)
      for (const [name, target] of workspace.packages) {
        const link = posix.join(root, "node_modules", name);
        if (
          target !== undefined &&
          target !== root &&
          !links.has(link) &&
          !conflicts.has(link)
        )
          add(root, name, target);
      }
  return {
    links,
    incompleteRoots,
    boundaries: new Set([...roots.keys(), ...pnpmFiles]),
    catalogs,
  };
}
