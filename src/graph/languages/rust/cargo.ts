// SPDX-License-Identifier: MIT
import { posix as p } from "node:path";
import type { ContextFile } from "../../types.js";
import { readToml, table, type TomlTable, type TomlValue } from "./toml.js";
import { matchesVersion } from "./macro-catalog.js";
import { cargoSources, lockSource } from "./cargo-sources.js";

function replacementPackage(id: string): string | undefined {
  const named = /^([\w-]+)[:@]\d+\./.exec(id);
  if (named) return named[1];
  if (!id.includes("://")) return;
  try {
    const source = new URL(id);
    const fragment = source.hash.slice(1);
    const name =
      /^([\w-]+)[:@]\d+\./.exec(fragment)?.[1] ??
      (/^\d+\./.test(fragment)
        ? p.basename(source.pathname).replace(/\.git$/, "")
        : undefined);
    return name && /^[\w-]+$/.test(name) ? name : undefined;
  } catch {
    return undefined;
  }
}

export type Edition = "2015" | "2018" | "2021" | "2024";
export interface Dependency {
  name: string;
  manifest: string;
  kind: "normal" | "dev" | "build";
  conditions: string[];
  packageName?: string;
  registryVersion?: string | undefined;
  registryRequirement?: string;
  /** A verified registry edge and its source-checked direct lock dependencies. */
  macroRegistry?: readonly string[];
  features?: string[];
  defaultFeatures?: true;
  libraryVersion?: string;
  libraryVersionSource?: string;
}
export interface Crate {
  root: string;
  kind: "lib" | "bin" | "example" | "test" | "bench" | "build";
  name: string;
  manifest: string;
  deps: Map<string, string>;
  workspace: string | null;
  dependencyGraphKnown?: boolean;
  libraryDependencyGraphKnown?: boolean;
  edition?: Edition | null;
  procMacro?: boolean;
  dependencies?: Dependency[];
}
const string = (v: TomlValue | undefined): string | undefined =>
  typeof v === "string" ? v : undefined;
const strings = (v: TomlValue | undefined): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === "string")
    ? (v as string[])
    : null;
const edition = (v: TomlValue | undefined): Edition | null =>
  v === undefined
    ? "2015"
    : typeof v === "string" && ["2015", "2018", "2021", "2024"].includes(v)
      ? (v as Edition)
      : null;
const exactVersion = (requirement: string | undefined): string | undefined =>
  /^=\s*((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/.exec(
    requirement?.trim() ?? "",
  )?.[1];
// Only absent keys get Cargo defaults. A present value of an unexpected type
// has no default and cannot establish a root, name, activation or edition.
const defaultString = (
  t: TomlTable | undefined,
  k: string,
  fallback: string,
): string | undefined => (t?.[k] === undefined ? fallback : string(t[k]));
function glob(pattern: string, path: string): boolean | null {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "\\" || c === "^") return null;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (
          (i > 0 && pattern[i - 1] !== "/") ||
          (pattern[i + 2] !== undefined && pattern[i + 2] !== "/")
        )
          return null;
        i++;
        if (pattern[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end < 0) return null;
      let body = pattern.slice(i + 1, end);
      if (!body || body.includes("/")) return null;
      if (body.startsWith("!")) body = "^" + body.slice(1);
      re += "[" + body + "]";
      i = end;
    } else re += c.replace(/[.+^${}()|\]\\]/g, "\\$&");
  }
  try {
    return new RegExp("^" + re + "$").test(path);
  } catch {
    return null;
  }
}
/** All manifest syntax is normalized by the TOML reader before Cargo facts are
 * interpreted. Unsupported syntax invalidates the document, not just one line.
 * No recovery, filesystem reads, environment evaluation or Cargo invocation. */
export function crates(
  contexts: readonly Pick<ContextFile, "path" | "status" | "text">[],
  paths: Set<string>,
): Crate[] {
  const docs = contexts
    .filter((c) => p.basename(c.path) === "Cargo.toml")
    .map((c) => ({
      path: c.path,
      dir: p.dirname(c.path),
      value: c.status === "clean" ? readToml(c.text) : null,
    }));
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const directorySource = cargoSources(contexts);
  const locks = new Map(
    contexts
      .filter((c) => p.basename(c.path) === "Cargo.lock")
      .map((c) => [c.path, c.status === "clean" ? readToml(c.text) : null]),
  );
  const lockIndexes = new Map<string, Map<string, TomlTable[]>>();
  function lockIndex(lockPath: string): Map<string, TomlTable[]> {
    let result = lockIndexes.get(lockPath);
    if (result) return result;
    result = new Map();
    lockIndexes.set(lockPath, result);
    const packages = locks.get(lockPath)?.package;
    if (Array.isArray(packages))
      for (const row of packages) {
        const pkg = table(row),
          name = string(pkg?.name);
        if (!pkg || !name) continue;
        const entries = result.get(name) ?? [];
        entries.push(pkg);
        result.set(name, entries);
      }
    return result;
  }
  function lockDescriptors(owner: TomlTable): RegExpExecArray[] {
    return (strings(owner.dependencies) ?? [])
      .map((edge) => /^(\S+)(?: (\S+)(?: \((.+)\))?)?$/.exec(edge))
      .filter((edge): edge is RegExpExecArray => edge !== null);
  }
  function lockedPackage(
    lockPath: string,
    owner: string,
    name: string,
    requirement: string | undefined,
    identity: string | undefined,
  ): TomlTable | undefined {
    if (!identity) return;
    const owners = (lockIndex(lockPath).get(owner) ?? []).filter(
      (t) => t.source === undefined,
    );
    if (owners.length !== 1) return;
    const descriptors = lockDescriptors(owners[0]!).filter(
      (edge) => edge[1] === name,
    );
    const candidates = (lockIndex(lockPath).get(name) ?? []).filter(
      (t) =>
        typeof t.version === "string" &&
        lockSource(t.source) === identity &&
        (!requirement ||
          exactVersion(requirement) === t.version ||
          matchesVersion(requirement, t.version)) &&
        descriptors.some(
          (edge) =>
            (!edge[2] || edge[2] === t.version) &&
            (!edge[3] || lockSource(edge[3]) === identity),
        ),
    );
    if (candidates.length !== 1) return;
    const selected = candidates[0];
    if (
      identity.startsWith("git:") &&
      !/#(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(string(selected?.source) ?? "")
    )
      return;
    return selected;
  }
  function workspaceFor(doc: (typeof docs)[number]): {
    doc?: typeof doc | undefined;
    known: boolean;
  } {
    const pkg = table(doc.value?.package);
    if (pkg?.workspace !== undefined) {
      const path = string(pkg.workspace),
        target =
          path === undefined
            ? undefined
            : byPath.get(p.join(doc.dir, path, "Cargo.toml"));
      return {
        doc: target,
        known: !!target?.value && !!table(target.value.workspace),
      };
    }
    for (const candidate of docs
      .filter(
        (d) =>
          d.dir === doc.dir ||
          (!p.relative(d.dir, doc.dir).startsWith("..") &&
            !p.isAbsolute(p.relative(d.dir, doc.dir))),
      )
      .sort((a, b) => b.dir.length - a.dir.length)) {
      if (!candidate.value) return { doc: candidate, known: false };
      const ws = table(candidate.value.workspace);
      if (!ws) continue;
      if (candidate.dir === doc.dir) return { doc: candidate, known: true };
      const relative = p.relative(candidate.dir, doc.dir),
        members = ws.members === undefined ? [] : strings(ws.members),
        exclude = ws.exclude === undefined ? [] : strings(ws.exclude);
      if (!members || !exclude) return { doc: candidate, known: false };
      const excluded = exclude.map((g) => glob(g, relative));
      if (excluded.some((x) => x === null))
        return { doc: candidate, known: false };
      if (excluded.includes(true)) continue;
      const included = members.map((g) => glob(g, relative));
      if (included.some((x) => x === null))
        return { doc: candidate, known: false };
      if (included.includes(true)) return { doc: candidate, known: true };
      // Cargo also includes captured path dependencies of members. Build a
      // membership closure over literal paths; no directory or Cargo probing.
      const pending = docs.filter(
        (d) =>
          d.dir === candidate.dir ||
          members.some(
            (g) => glob(g, p.relative(candidate.dir, d.dir)) === true,
          ),
      );
      const visited = new Set<string>();
      while (pending.length) {
        const member = pending.pop()!;
        if (visited.has(member.path)) continue;
        visited.add(member.path);
        if (member.path === doc.path) return { doc: candidate, known: true };
        for (const deps of dependencyTables(member.value))
          for (const v of Object.values(deps.values)) {
            const inherited = table(v)?.workspace === true;
            const source = inherited
              ? table(table(candidate.value.workspace)?.dependencies)?.[
                  Object.entries(deps.values).find(([, x]) => x === v)?.[0] ??
                    ""
                ]
              : v;
            const path = string(table(source)?.path);
            if (!path) continue;
            const target = byPath.get(
              p.join(
                inherited ? candidate.dir : member.dir,
                path,
                "Cargo.toml",
              ),
            );
            if (
              target &&
              !p.relative(candidate.dir, target.dir).startsWith("..") &&
              !exclude.some(
                (g) => glob(g, p.relative(candidate.dir, target.dir)) === true,
              )
            )
              pending.push(target);
          }
      }
    }
    return { known: true };
  }
  function dependencyTables(root: TomlTable | null): {
    values: TomlTable;
    kind: Dependency["kind"];
    condition?: string | undefined;
  }[] {
    const result: {
      values: TomlTable;
      kind: Dependency["kind"];
      condition?: string | undefined;
    }[] = [];
    function add(owner: TomlTable, condition?: string) {
      for (const [key, kind] of [
        ["dependencies", "normal"],
        ["dev-dependencies", "dev"],
        ["build-dependencies", "build"],
      ] as const) {
        const values = table(owner[key]);
        if (values) result.push({ values, kind, condition });
      }
    }
    if (root) {
      add(root);
      for (const [target, v] of Object.entries(table(root.target) ?? {})) {
        const owner = table(v);
        if (!owner) continue;
        const condition =
          target.startsWith("cfg(") && target.endsWith(")")
            ? target
                .slice(4, -1)
                .replace(/\s+(?=(?:[^"\n]*"[^"\n]*")*[^"\n]*$)/g, "")
            : "?target:" + target;
        add(owner, condition);
      }
    }
    return result;
  }
  const roots: Crate[] = [];
  for (const doc of docs) {
    const value = doc.value,
      pkg = table(value?.package),
      name = string(pkg?.name);
    if (!value || !pkg || !name) continue;
    const workspace = workspaceFor(doc),
      ws = workspace.known ? table(workspace.doc?.value?.workspace) : undefined;
    const inherited = table(pkg.edition)?.workspace === true;
    const pkgEdition = inherited
      ? table(ws?.package)?.edition === undefined
        ? null
        : edition(table(ws?.package)!.edition)
      : edition(pkg.edition);
    let known = workspace.known;
    let libraryKnown = workspace.known;
    // Configs are searched from the invocation directory. When the member
    // and workspace see different directory sources, leave that edge open.
    const memberSource = directorySource(doc.dir);
    const workspaceSource = directorySource(workspace.doc?.dir ?? doc.dir);
    const lockPath = p.join(
      p.dirname(workspace.doc?.path ?? doc.path),
      "Cargo.lock",
    );
    const maps = {
        normal: new Map<string, string>(),
        build: new Map<string, string>(),
      },
      edges: Dependency[] = [];
    const overrides: { name: string; path?: string | undefined }[] = [];
    for (const source of [
      doc,
      ...(workspace.doc && workspace.doc !== doc ? [workspace.doc] : []),
    ]) {
      if (
        source.value?.patch !== undefined &&
        (!table(source.value.patch) ||
          Object.values(table(source.value.patch)!).some(
            (group) => !table(group),
          ))
      )
        libraryKnown = false;
      if (source.value?.replace !== undefined && !table(source.value.replace))
        libraryKnown = false;
      for (const entries of Object.values(table(source.value?.patch) ?? {}))
        for (const [alias, v] of Object.entries(table(entries) ?? {}))
          overrides.push({
            name: string(table(v)?.package) ?? alias,
            path:
              string(table(v)?.path) === undefined
                ? undefined
                : p.join(source.dir, string(table(v)!.path)!, "Cargo.toml"),
          });
      for (const [id, v] of Object.entries(
        table(source.value?.replace) ?? {},
      )) {
        const name = replacementPackage(id);
        if (!name) {
          libraryKnown = false;
          continue;
        }
        overrides.push({
          name,
          path:
            string(table(v)?.path) === undefined
              ? undefined
              : p.join(source.dir, string(table(v)!.path)!, "Cargo.toml"),
        });
      }
      if (
        source.value?.patch !== undefined ||
        source.value?.replace !== undefined
      )
        known = false;
    }
    function registryPackage(row: TomlTable): boolean {
      const source = string(row.source);
      const packageName = string(row.name);
      const identity = lockSource(source);
      if (
        !source ||
        !packageName ||
        !(identity === "crates-io" || identity?.startsWith("registry:"))
      )
        return false;
      if (overrides.some((entry) => entry.name === packageName)) return false;
      const config = { "registry-index": source.replace(/^registry\+/, "") };
      return [
        memberSource(config, packageName),
        workspaceSource(config, packageName),
      ].every(
        (resolved) =>
          resolved.identity === identity && resolved.directory === undefined,
      );
    }
    function registryImplementations(row: TomlTable): string[] | undefined {
      if (!registryPackage(row)) return;
      const byName = new Map<string, boolean>();
      for (const edge of lockDescriptors(row)) {
        const [, name, version, source] = edge;
        const candidates = (lockIndex(lockPath).get(name!) ?? []).filter(
          (dep) =>
            (!version || version === dep.version) &&
            (!source ||
              source === dep.source ||
              (lockSource(source) !== undefined &&
                lockSource(source) === lockSource(dep.source))),
        );
        byName.set(
          name!,
          (byName.get(name!) ?? true) &&
            candidates.length === 1 &&
            registryPackage(candidates[0]!),
        );
      }
      return [...byName]
        .filter(([, registry]) => registry)
        .map(([name]) => name)
        .sort();
    }
    for (const group of dependencyTables(value))
      for (const [alias, raw] of Object.entries(group.values)) {
        let fields = table(raw),
          requirement =
            typeof raw === "string" ? raw : string(table(raw)?.version),
          origin = doc,
          conditions = group.condition ? [group.condition] : [];
        const memberFeatures = strings(fields?.features) ?? [];
        const memberDefault = fields?.["default-features"];
        if (typeof raw !== "string" && !fields) {
          known = false;
          conditions.push("?dependency");
        }
        if (fields?.workspace !== undefined) {
          const inheritedValue =
            fields.workspace === true && workspace.known
              ? table(ws?.dependencies)?.[alias]
              : undefined;
          const inheritedFields = table(inheritedValue);
          requirement =
            typeof inheritedValue === "string"
              ? inheritedValue
              : string(inheritedFields?.version);
          if (
            inheritedValue === undefined ||
            (typeof inheritedValue !== "string" && !inheritedFields)
          ) {
            known = false;
            conditions.push("?workspace-dependency");
          }
          // Cargo allows optional/features on the member; source path/package
          // belong to the workspace dependency definition.
          fields = {
            ...(inheritedFields ?? {}),
            ...(fields.optional === undefined
              ? {}
              : { optional: fields.optional }),
          };
          if (workspace.doc) origin = workspace.doc;
        }
        if (
          fields?.optional !== undefined &&
          typeof fields.optional !== "boolean"
        ) {
          conditions.push("?optional");
          known = false;
        }
        if (fields?.optional === true) {
          const features = table(value.features) ?? {};
          const named = Object.entries(features)
            .filter(([, v]) => strings(v)?.includes("dep:" + alias))
            .map(([k]) => k);
          if (!named.length && features[alias] === undefined) named.push(alias);
          conditions.push(
            named.length
              ? `any(${named.map((n) => `feature=${JSON.stringify(n)}`).join(",")})`
              : "?optional:" + alias,
          );
        }
        for (const key of ["path", "package"] as const)
          if (fields?.[key] !== undefined && typeof fields[key] !== "string") {
            conditions.push("?dependency-" + key);
            known = false;
          }
        if (!workspace.known) conditions.push("?workspace");
        const packageName = string(fields?.package) ?? alias;
        const alternatives = overrides.filter((o) => o.name === packageName);
        if (alternatives.length) conditions.push("?manifest-override");
        const depPath = string(fields?.path),
          direct =
            depPath === undefined
              ? ""
              : p.join(origin.dir, depPath, "Cargo.toml");
        let targets = [
          ...new Set([
            direct,
            ...alternatives.flatMap((o) => (o.path ? [o.path] : [])),
            ...(!workspace.known || alternatives.some((o) => !o.path)
              ? docs
                  .filter(
                    (d) =>
                      string(table(d.value?.package)?.name) === packageName,
                  )
                  .map((d) => d.path)
              : []),
          ]),
        ];
        const defaultRegistry =
          workspace.known &&
          (fields?.package === undefined ||
            typeof fields.package === "string") &&
          !["path", "git", "registry", "registry-index"].some(
            (k) => fields?.[k] !== undefined,
          );
        const member = memberSource(fields),
          root =
            workspaceSource === memberSource ? member : workspaceSource(fields);
        const vendor =
          member.directory === undefined && root.directory === undefined
            ? undefined
            : member.directory === root.directory &&
                member.identity === root.identity
              ? member.directory
              : null;
        const exact = exactVersion(requirement);
        const selectedPackage =
          !alternatives.length &&
          (vendor || (defaultRegistry && requirement && vendor === undefined))
            ? lockedPackage(
                lockPath,
                name,
                packageName,
                requirement,
                member.identity ?? (defaultRegistry ? "crates-io" : undefined),
              )
            : undefined;
        const selected = string(selectedPackage?.version);
        const registry =
          defaultRegistry && !alternatives.length && vendor === undefined
            ? selected
              ? {
                  registryVersion: selected,
                  libraryVersion: selected,
                  libraryVersionSource: lockPath,
                }
              : requirement && !locks.has(lockPath)
                ? { registryRequirement: requirement }
                : {}
            : {};
        const macroRegistry = selectedPackage
          ? registryImplementations(selectedPackage)
          : registry.registryRequirement &&
              [
                memberSource(fields, packageName),
                workspaceSource(fields, packageName),
              ].every(
                (source) =>
                  source.identity === "crates-io" &&
                  source.directory === undefined,
              )
            ? []
            : undefined;
        if (vendor !== undefined) {
          const version =
            selected ??
            (!locks.has(lockPath) && fields?.git === undefined
              ? exact
              : undefined);
          const candidates =
            typeof vendor === "string" && !p.isAbsolute(vendor) && version
              ? docs.filter((d) => {
                  const relative = p.relative(vendor, d.dir);
                  const pkg = table(d.value?.package);
                  return (
                    !!relative &&
                    relative !== ".." &&
                    !relative.includes("/") &&
                    pkg?.name === packageName &&
                    pkg.version === version
                  );
                })
              : [];
          if (candidates.length === 1 && !alternatives.length)
            targets = [candidates[0]!.path];
          else conditions.push("?directory-source");
        }
        const version =
          !registry.libraryVersion && exact && !alternatives.length
            ? { libraryVersion: exact, libraryVersionSource: origin.path }
            : {};
        const features = [
          ...new Set([...memberFeatures, ...(strings(fields?.features) ?? [])]),
        ];
        const defaultFeatures = [
          memberDefault,
          fields?.["default-features"],
        ].every((value) => value === undefined || value === true);
        for (const path of targets) {
          const target = byPath.get(path);
          if (path && !target?.value) {
            known = false;
            conditions = [...conditions, "?dependency-manifest"];
          }
          let binding = alias;
          if (fields?.package === undefined && target?.value) {
            const lib = table(target.value.lib),
              packageValue = table(target.value.package);
            const inferred = defaultString(
              lib,
              "name",
              string(packageValue?.name) ?? alias,
            );
            if (inferred === undefined) {
              conditions = [...conditions, "?dependency-name"];
              known = false;
            } else binding = inferred;
          }
          binding = binding.replace(/-/g, "_");
          const map = group.kind === "build" ? maps.build : maps.normal,
            previous = map.get(binding);
          map.set(
            binding,
            previous === undefined || previous === path ? path : "",
          );
          edges.push({
            name: binding,
            manifest: path,
            kind: group.kind,
            conditions: [...conditions],
            packageName,
            ...(features.length ? { features } : {}),
            ...(defaultFeatures ? { defaultFeatures: true } : {}),
            ...(macroRegistry ? { macroRegistry } : {}),
            ...(vendor !== undefined ? {} : { ...registry, ...version }),
          });
        }
      }
    // Ill-typed dependency/target/override tables cannot silently mean empty.
    if (
      [
        "dependencies",
        "dev-dependencies",
        "build-dependencies",
        "target",
        "patch",
        "replace",
      ].some((k) => value[k] !== undefined && !table(value[k]))
    )
      known = libraryKnown = false;
    const lib = table(value.lib),
      libPath =
        value.lib === undefined || lib
          ? defaultString(lib, "path", "src/lib.rs")
          : undefined;
    const libName = defaultString(lib, "name", name)?.replace(/-/g, "_");
    const add = (
      path: string | undefined,
      targetName: string | undefined,
      kind: Crate["kind"],
      targetEdition: TomlValue | undefined = undefined,
    ) => {
      if (path === undefined || targetName === undefined) return;
      const root = p.join(doc.dir, path);
      if (!paths.has(root) || roots.some((r) => r.root === root)) return;
      const deps = new Map(kind === "build" ? maps.build : maps.normal);
      if (kind !== "lib" && kind !== "build" && libName !== undefined)
        deps.set(libName, doc.path);
      roots.push({
        root,
        name: targetName.replace(/-/g, "_"),
        kind,
        manifest: doc.path,
        workspace: workspace.known ? (workspace.doc?.path ?? null) : null,
        edition:
          targetEdition === undefined ? pkgEdition : edition(targetEdition),
        dependencyGraphKnown: known,
        libraryDependencyGraphKnown: libraryKnown,
        ...(kind === "lib" && lib?.["proc-macro"] === true
          ? { procMacro: true }
          : {}),
        deps,
        dependencies: [
          ...edges
            .filter((e) =>
              kind === "build" ? e.kind === "build" : e.kind !== "build",
            )
            .map((e) => ({
              ...e,
              conditions: [
                ...e.conditions,
                ...(e.kind === "dev" &&
                !["test", "example", "bench"].includes(kind)
                  ? ["test"]
                  : []),
              ],
            })),
          ...(kind !== "lib" && kind !== "build" && libName !== undefined
            ? [
                {
                  name: libName,
                  manifest: doc.path,
                  kind: "normal" as const,
                  conditions: [],
                },
              ]
            : []),
        ],
      });
    };
    if (
      value.lib !== undefined
        ? !!lib
        : pkg.autolib === undefined || pkg.autolib === true
    )
      add(libPath, libName, "lib", lib?.edition);
    const explicit = new Set<string>();
    const unknownTargets = new Set<string>();
    for (const kind of ["bin", "example", "test", "bench"] as const) {
      const entries = value[kind];
      if (
        entries !== undefined &&
        (!Array.isArray(entries) || entries.some((x) => !table(x)))
      ) {
        known = false;
        unknownTargets.add(kind);
        continue;
      }
      for (const v of (entries as TomlValue[] | undefined) ?? []) {
        const t = table(v)!,
          targetName = defaultString(t, "name", kind === "bin" ? name : "");
        const dir = {
          bin: "src/bin",
          example: "examples",
          test: "tests",
          bench: "benches",
        }[kind];
        const path = targetName
          ? defaultString(
              t,
              "path",
              kind === "bin" && targetName === name
                ? "src/main.rs"
                : `${dir}/${targetName}.rs`,
            )
          : undefined;
        if (path) explicit.add(p.join(doc.dir, path));
        if (path === undefined || targetName === undefined) {
          known = false;
          unknownTargets.add(kind);
        }
        add(path, targetName || undefined, kind, t.edition);
      }
    }
    for (const [dir, kind, flag] of [
      ["src/bin", "bin", "autobins"],
      ["examples", "example", "autoexamples"],
      ["tests", "test", "autotests"],
      ["benches", "bench", "autobenches"],
    ] as const) {
      if (
        unknownTargets.has(kind) ||
        (pkg[flag] !== undefined && pkg[flag] !== true)
      )
        continue;
      if (kind === "bin" && !explicit.has(p.join(doc.dir, "src/main.rs")))
        add("src/main.rs", name, "bin");
      const prefix = p.join(doc.dir, dir) + "/";
      for (const path of paths)
        if (path.startsWith(prefix) && !explicit.has(path)) {
          const relative = path.slice(prefix.length);
          if (/^[^/]+\.rs$/.test(relative))
            add(p.relative(doc.dir, path), relative.slice(0, -3), kind);
          else if (/^[^/]+\/main\.rs$/.test(relative))
            add(p.relative(doc.dir, path), relative.split("/")[0]!, kind);
        }
    }
    if (pkg.build === undefined || pkg.build === true)
      add("build.rs", "build_script_build", "build");
    else if (typeof pkg.build === "string")
      add(pkg.build, "build_script_build", "build");
    // Late target-shape uncertainty is crate-wide metadata, not a fabricated
    // target. Existing roots remain usable only for facts independent of it.
    for (const crate of roots.filter((c) => c.manifest === doc.path))
      crate.dependencyGraphKnown = known;
  }
  return roots;
}
