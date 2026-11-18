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
    const relative = posix.relative(root, local);
    if (relative === ".." || relative.startsWith("../")) continue;
    const matches = (pattern: string) =>
      posix.matchesGlob(
        relative,
        pattern.replace(/^\.\//, "").replace(/\/$/, ""),
      );
    if (
      relative &&
      (!patterns.some(
        (pattern) => !pattern.startsWith("!") && matches(pattern),
      ) ||
        patterns.some(
          (pattern) => pattern.startsWith("!") && matches(pattern.slice(1)),
        ))
    )
      continue;
    paths.add(local);
    if (!relative && !includeRootPackage) continue;
    const name = json.name;
    if (typeof name === "string" && validPackageName(name))
      packages.set(name, packages.has(name) ? undefined : local);
  }
  return { packages, paths };
}

/** Build virtual install links only. TypeScript interprets the package entries. */
export function workspaceLinks(
  manifests: readonly Manifest[],
  contexts: readonly ContextFile[],
): Iterable<readonly [string, string]> {
  const links = new Map<string, string>();
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
  for (const file of contexts) {
    if (posix.basename(file.path) !== "pnpm-workspace.yaml") continue;
    const root = posix.dirname(file.path);
    pnpmFiles.add(root);
    const settings = pnpmSettings(file.text);
    if (settings)
      roots.set(root, {
        ...members(root, settings.patterns, manifests, true),
        pnpm: true,
        hoist: false,
        linkVersions: settings.linkVersions,
      });
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
      roots.set(root, {
        ...members(root, patterns, manifests),
        pnpm: false,
        // Yarn's Plug'n'Play layout only grants access to declared packages.
        hoist: yarnMajor === undefined || Number(yarnMajor) < 2,
        linkVersions: false,
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
    for (const [name, specifier] of Object.entries(dependencies)) {
      if (!validPackageName(name) || typeof specifier !== "string") continue;
      let target: string | undefined;
      if (/^(?:file|link):/.test(specifier)) {
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
  return links;
}
