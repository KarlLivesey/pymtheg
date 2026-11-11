import { posix as p } from "node:path";
import type { ContextFile } from "../../types.js";

export interface Crate {
  root: string;
  kind: "lib" | "bin";
  name: string;
  manifest: string;
  deps: Map<string, string>;
  workspace: string | null;
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
      let bin = 0;
      for (const statement of statements) {
        if (statement.startsWith("[")) {
          section = statement.trim().replace(/^\[+|\]+$/g, "");
          if (statement.startsWith("[[bin]]")) section = `bin.${bin++}`;
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
  const roots: Crate[] = [];
  for (const doc of docs) {
    const pkg = doc.sections.get("package");
    const name = literal(pkg?.name);
    if (!name) continue;
    const workspace = workspaceFor(doc.dir);
    const workspacePath = workspace?.path ?? null;
    const deps = new Map<string, string>();
    const dependency = (alias: string, path: string) => {
      alias = alias.replace(/-/g, "_");
      const previous = deps.get(alias);
      deps.set(alias, previous === undefined || previous === path ? path : "");
    };
    for (const [section, values] of doc.sections) {
      if (
        !/(^|\.)(dependencies|dev-dependencies|build-dependencies)$/.test(
          section,
        )
      )
        continue;
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
          const depPath = /path\s*=\s*["']([^"']+)["']/.exec(value)?.[1];
          dependency(
            alias,
            workspace && depPath
              ? p.join(workspace.dir, depPath, "Cargo.toml")
              : "",
          );
        } else {
          const depPath = /path\s*=\s*["']([^"']+)["']/.exec(value)?.[1];
          dependency(
            alias,
            depPath ? p.join(doc.dir, depPath, "Cargo.toml") : "",
          );
        }
      }
    }
    const lib = doc.sections.get("lib");
    const libRoot = p.join(doc.dir, literal(lib?.path) ?? "src/lib.rs");
    const libName = literal(lib?.name) ?? name.replace(/-/g, "_");
    if (paths.has(libRoot))
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
  }
  return roots;
}
