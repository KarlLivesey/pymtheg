import { posix as p } from "node:path";
import type { ContextFile } from "../../types.js";

export interface Crate {
  root: string;
  kind: "lib" | "bin" | "example" | "test" | "bench" | "build";
  name: string;
  manifest: string;
  deps: Map<string, string>;
  workspace: string | null;
  dependencyGraphKnown?: boolean;
}
/** Deliberately bounded TOML context reader: literal strings, arrays and inline
 * dependency tables. No evaluation, filesystem reads or Cargo execution. */
export function crates(
  contexts: readonly ContextFile[],
  paths: Set<string>,
): Crate[] {
  const docs = contexts
    .filter((c) => c.status === "clean")
    .map((c) => {
      const sections = new Map<string, Record<string, string>>();
      let section = "";
      const statements =
        c.text
          .replace(/#[^\n]*(?=(?:[^"\n]*"[^"\n]*")*[^"\n]*$)/gm, "")
          .match(
            /\[\[?[^\n]+|[\w.-]+\s*=\s*(?:\[[\s\S]*?\]|\{[^}]*\}|[^\n]*)/g,
          ) ?? [];
      const targetCounts = new Map<string, number>();
      for (const statement of statements) {
        if (statement.startsWith("[")) {
          section = statement.trim().replace(/^\[+|\]+$/g, "");
          const target = /^\[\[(bin|example|test|bench)\]\]/.exec(
            statement,
          )?.[1];
          if (target) {
            const ordinal = targetCounts.get(target) ?? 0;
            targetCounts.set(target, ordinal + 1);
            section = `${target}.${ordinal}`;
          }
          sections.set(section, sections.get(section) ?? {});
        } else {
          const m = /^([\w.-]+)\s*=\s*([\s\S]*)/.exec(statement);
          if (m) {
            const obj = sections.get(section) ?? {};
            obj[m[1]!] = m[2]!.trim();
            sections.set(section, obj);
          }
        }
      }
      for (const [name, values] of [...sections]) {
        const match =
          /^(.*(?:^|\.)(?:dependencies|dev-dependencies|build-dependencies))\.([\w-]+)$/.exec(
            name,
          );
        if (match) {
          const section = sections.get(match[1]!) ?? {};
          section[match[2]!] = `{ ${Object.entries(values)
            .map(([k, v]) => `${k} = ${v}`)
            .join(", ")} }`;
          sections.set(match[1]!, section);
        }
      }
      return { path: c.path, dir: p.dirname(c.path), sections };
    });
  const literal = (s = "") =>
    /^(?:"([^"\n]*)"|'([^'\n]*)')$/
      .exec(s)
      ?.slice(1)
      .find((x) => x !== undefined);
  const workspaceFor = (dir: string) =>
    docs
      .filter((d) => {
        const workspace = d.sections.get("workspace");
        if (!workspace) return false;
        const relative = p.relative(d.dir, dir);
        if (!relative) return true;
        const matches = (raw = "") =>
          [...raw.matchAll(/["']([^"']+)["']/g)].some((m) => {
            const expression = m[1]!
              .split("*")
              .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
              .join("[^/]*");
            return new RegExp(`^${expression}$`).test(relative);
          });
        return matches(workspace.members) && !matches(workspace.exclude);
      })
      .sort((a, b) => b.dir.length - a.dir.length)[0];
  const docsByPath = new Map(docs.map((d) => [d.path, d]));
  const automaticPaths = new Map<string, string[]>();
  for (const path of paths) {
    const dirs = [
      p.dirname(path),
      ...(p.basename(path) === "main.rs" ? [p.dirname(p.dirname(path))] : []),
    ];
    for (const dir of dirs) {
      const list = automaticPaths.get(dir) ?? [];
      list.push(path);
      automaticPaths.set(dir, list);
    }
  }
  const graphKnown = new Map<string, boolean>();
  const roots: Crate[] = [];
  for (const doc of docs) {
    const pkg = doc.sections.get("package");
    const workspace = workspaceFor(doc.dir);
    const name =
      literal(pkg?.name) ??
      (pkg?.["name.workspace"] === "true"
        ? literal(workspace?.sections.get("workspace.package")?.name)
        : undefined);
    if (!name) continue;
    graphKnown.set(
      doc.path,
      ![...doc.sections.keys()].some((s) => /^(patch|replace)(\.|$)/.test(s)),
    );
    const workspacePath = workspace?.path ?? null;
    const deps = new Map<string, string>();
    const buildDeps = new Map<string, string>();
    let dependencyMap = deps;
    const dependency = (alias: string, path: string, renamed: boolean) => {
      const target = docsByPath.get(path);
      if (
        (path && !target) ||
        (dependencyMap.has(alias) && dependencyMap.get(alias) !== path)
      )
        graphKnown.set(doc.path, false);
      if (target && !renamed)
        alias =
          literal(target.sections.get("lib")?.name) ??
          literal(target.sections.get("package")?.name) ??
          alias;
      alias = alias.replace(/-/g, "_");
      const previous = dependencyMap.get(alias);
      if (previous !== undefined && previous !== path)
        graphKnown.set(doc.path, false);
      dependencyMap.set(
        alias,
        previous === undefined || previous === path ? path : "",
      );
    };
    for (const [section, values] of doc.sections) {
      if (
        section.startsWith("workspace.") ||
        !/(^|\.)(dependencies|dev-dependencies|build-dependencies)$/.test(
          section,
        )
      )
        continue;
      dependencyMap = section.endsWith("build-dependencies") ? buildDeps : deps;
      const entries: [string, string][] = Object.entries(values).map(
        ([alias, raw]) =>
          alias.endsWith(".workspace") && raw === "true"
            ? [alias.slice(0, -10), "{ workspace = true }"]
            : [alias, raw],
      );
      for (const [alias, raw] of entries) {
        let value = raw;
        if (/workspace\s*=\s*true/.test(raw)) {
          value =
            workspace?.sections.get("workspace.dependencies")?.[alias] ?? "";
          if (!value) graphKnown.set(doc.path, false);
          const depPath = /path\s*=\s*["']([^"']+)["']/.exec(value)?.[1];
          dependency(
            alias,
            workspace && depPath
              ? p.join(workspace.dir, depPath, "Cargo.toml")
              : "",
            /package\s*=/.test(value),
          );
        } else {
          const depPath = /path\s*=\s*["']([^"']+)["']/.exec(value)?.[1];
          dependency(
            alias,
            depPath ? p.join(doc.dir, depPath, "Cargo.toml") : "",
            /package\s*=/.test(value),
          );
        }
      }
    }
    const lib = doc.sections.get("lib");
    const libRoot = p.join(doc.dir, literal(lib?.path) ?? "src/lib.rs");
    const libName = (literal(lib?.name) ?? name).replace(/-/g, "_");
    if (paths.has(libRoot) && (lib || pkg?.autolib !== "false"))
      roots.push({
        root: libRoot,
        kind: "lib",
        name: libName,
        manifest: doc.path,
        deps,
        workspace: workspacePath,
      });
    const bins = [...doc.sections].filter(([s]) => s.startsWith("bin."));
    for (const [, bin] of bins) {
      const binName = literal(bin.name) ?? name;
      const root = p.join(
        doc.dir,
        literal(bin.path) ??
          (binName === name ? "src/main.rs" : `src/bin/${binName}.rs`),
      );
      if (paths.has(root))
        roots.push({
          kind: "bin",
          root,
          name: binName.replace(/-/g, "_"),
          manifest: doc.path,
          workspace: workspacePath,
          deps: new Map([...deps, [libName, doc.path]]),
        });
    }
    if (
      pkg?.autobins !== "false" &&
      paths.has(p.join(doc.dir, "src/main.rs")) &&
      !roots.some((r) => r.root === p.join(doc.dir, "src/main.rs"))
    )
      roots.push({
        root: p.join(doc.dir, "src/main.rs"),
        kind: "bin",
        name: name.replace(/-/g, "_"),
        manifest: doc.path,
        workspace: workspacePath,
        deps: new Map([...deps, [libName, doc.path]]),
      });
    const targetDeps = new Map([...deps, [libName, doc.path]]);
    const addTarget = (
      root: string,
      targetName: string,
      kind: Crate["kind"],
    ) => {
      if (paths.has(root) && !roots.some((c) => c.root === root))
        roots.push({
          root,
          name: targetName.replace(/-/g, "_"),
          kind,
          manifest: doc.path,
          workspace: workspacePath,
          deps: kind === "build" ? buildDeps : targetDeps,
        });
    };
    for (const kind of ["example", "test", "bench"] as const)
      for (const [section, values] of doc.sections) {
        if (!section.startsWith(kind + ".")) continue;
        const targetName = literal(values.name);
        const dir = { example: "examples", test: "tests", bench: "benches" }[
          kind
        ];
        if (targetName)
          addTarget(
            p.join(doc.dir, literal(values.path) ?? `${dir}/${targetName}.rs`),
            targetName,
            kind,
          );
      }
    for (const [dir, kind, flag] of [
      ["src/bin", "bin", "autobins"],
      ["examples", "example", "autoexamples"],
      ["tests", "test", "autotests"],
      ["benches", "bench", "autobenches"],
    ] as const) {
      if (pkg?.[flag] === "false") continue;
      const prefix = p.join(doc.dir, dir) + "/";
      for (const path of automaticPaths.get(p.join(doc.dir, dir)) ?? [])
        if (path.startsWith(prefix)) {
          const relative = path.slice(prefix.length);
          if (/^[^/]+\.rs$/.test(relative))
            addTarget(path, relative.slice(0, -3), kind);
          else if (/^[^/]+\/main\.rs$/.test(relative))
            addTarget(path, relative.split("/")[0]!, kind);
        }
    }
    if (pkg?.build !== "false")
      addTarget(
        p.join(doc.dir, literal(pkg?.build) ?? "build.rs"),
        "build_script_build",
        "build",
      );
  }
  return roots.map((c) => ({
    ...c,
    dependencyGraphKnown: graphKnown.get(c.manifest) ?? false,
  }));
}
