// SPDX-License-Identifier: MIT
// C-19: a small text-level resolver for Rust item paths in crate sources, to
// check that two names denote the same declaration. It follows `mod`
// declarations (files, `#[path]`, inline modules) and `use` re-exports
// (renames, lists, nested lists, globs) across crates, from the downloaded
// registry sources and the toolchain's `rust-src`. It does not evaluate cfg,
// macros or `include!`: a path it cannot follow is "unresolved", never a
// guess; a glob that reaches several different items is "ambiguous".
//
// resolveItem(crate, version|null, ["a","b","C","m"]) ->
//   { def: { file, offset, name, kind }, rest: ["m"] }  (rest: members of an
//   item such as variants, methods, associated items, compared by name)
//   or { error }.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const STD = new Set(["std", "core", "alloc", "proc_macro", "test"]);

// Mask comments, strings and char literals with spaces (offsets unchanged).
function mask(text) {
  const out = text.split("");
  let i = 0;
  const n = text.length;
  const blank = (a, b) => {
    for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < n) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      const e = text.indexOf("\n", i);
      const end = e < 0 ? n : e;
      blank(i, end);
      i = end;
    } else if (c === "/" && text[i + 1] === "*") {
      let depth = 1;
      let k = i + 2;
      while (k < n && depth) {
        if (text[k] === "/" && text[k + 1] === "*") depth++, (k += 2);
        else if (text[k] === "*" && text[k + 1] === "/") depth--, (k += 2);
        else k++;
      }
      blank(i, k);
      i = k;
    } else if (c === "r" && /^r#*"/.test(text.slice(i, i + 10)) && !/[\w]/.test(text[i - 1] ?? "")) {
      const m = text.slice(i).match(/^r(#*)"/);
      const close = '"' + m[1];
      const e = text.indexOf(close, i + m[0].length);
      const end = e < 0 ? n : e + close.length;
      blank(i, end);
      i = end;
    } else if (c === '"') {
      let k = i + 1;
      while (k < n && text[k] !== '"') k += text[k] === "\\" ? 2 : 1;
      blank(i, k + 1);
      i = k + 1;
    } else if (c === "'" && /^'(\\.|[^\\'])'/.test(text.slice(i, i + 4))) {
      const m = text.slice(i).match(/^'(\\u\{[0-9a-fA-F]+\}|\\.|[^\\'])'/);
      const len = m ? m[0].length : 1;
      blank(i, i + len);
      i += len;
    } else i++;
  }
  return out.join("");
}

const fileCache = new Map();
function load(file) {
  if (!fileCache.has(file)) {
    let text = null;
    try {
      text = readFileSync(file, "utf8");
    } catch {}
    let masked = null;
    let depth = null;
    if (text !== null) {
      masked = mask(text);
      depth = new Int32Array(masked.length + 1);
      let d = 0;
      for (let k = 0; k < masked.length; k++) {
        depth[k] = d;
        if (masked[k] === "{") d++;
        else if (masked[k] === "}") d--;
      }
      depth[masked.length] = d;
    }
    fileCache.set(file, { text, masked, depth });
  }
  return fileCache.get(file);
}

export function createResolver({ registries, sysroot }) {
  const crateDirs = new Map(); // package name -> [{version, dir}]
  for (const reg of registries) {
    let indexes = [];
    try {
      indexes = readdirSync(reg);
    } catch {}
    for (const idx of indexes)
      for (const d of readdirSync(join(reg, idx))) {
        const m = d.match(/^(.*)-(\d+\.\d+\.\d+.*)$/);
        if (!m) continue;
        const list = crateDirs.get(m[1]) ?? [];
        if (!list.some((x) => x.version === m[2])) list.push({ version: m[2], dir: join(reg, idx, d) });
        crateDirs.set(m[1], list);
      }
  }
  const crateRoots = new Map();
  function crateRoot(name, version) {
    const key = `${name} ${version ?? ""}`;
    if (crateRoots.has(key)) return crateRoots.get(key);
    let result;
    if (STD.has(name)) {
      const f = join(sysroot, "lib/rustlib/src/rust/library", name, "src/lib.rs");
      result = existsSync(f) ? { file: f, crate: name, version: "std" } : { error: `no rust-src for ${name}` };
    } else {
      let list = crateDirs.get(name) ?? crateDirs.get(name.replace(/_/g, "-")) ?? [];
      if (version) list = list.filter((x) => x.version === version);
      if (list.length === 0) result = { error: `crate ${name} ${version ?? ""} not downloaded` };
      else if (list.length > 1) result = { error: `crate ${name}: ${list.length} versions` };
      else {
        const dir = list[0].dir;
        let lib = join(dir, "src/lib.rs");
        try {
          const toml = readFileSync(join(dir, "Cargo.toml"), "utf8");
          const m = toml.match(/\[lib\][^[]*?\bpath\s*=\s*"([^"]+)"/);
          if (m) lib = join(dir, m[1]);
        } catch {}
        result = existsSync(lib) ? { file: lib, crate: name, version: list[0].version, dir } : { error: `no lib.rs for ${name}` };
      }
    }
    crateRoots.set(key, result);
    return result;
  }
  const procMacro = new Map();
  function isProcMacroCrate(name, version) {
    const key = `${name} ${version}`;
    if (!procMacro.has(key)) {
      const list = (crateDirs.get(name) ?? []).filter((x) => x.version === version);
      let yes = false;
      for (const x of list) {
        try {
          yes ||= /\bproc[-_]macro\s*=\s*true/.test(readFileSync(join(x.dir, "Cargo.toml"), "utf8"));
        } catch {}
      }
      procMacro.set(key, yes);
    }
    return procMacro.get(key);
  }

  // A module: a file, or an inline `mod x { }` span in a file.
  const rootModule = (root) => ({ file: root.file, start: 0, end: Infinity, inline: false, isRoot: true, crate: root, parent: null, ownsDir: true });
  function moduleDepth(mod) {
    const { depth } = load(mod.file);
    return mod.inline ? depth[mod.start] + 1 : 0;
  }
  function childModule(mod, name) {
    const { masked, text, depth } = load(mod.file);
    if (!masked) return null;
    const md = moduleDepth(mod);
    const re = new RegExp(`(^|[^\\w])mod\\s+(r#)?${name}\\s*([;{])`, "g");
    let m;
    while ((m = re.exec(masked))) {
      const at = m.index + m[1].length;
      if (at < mod.start || at >= mod.end || depth[at] !== md) continue;
      if (m[3] === "{") {
        const open = m.index + m[0].length - 1;
        let k = open + 1;
        while (k < masked.length && depth[k + 1] > depth[open]) k++;
        return { file: mod.file, start: open, end: k + 1, inline: true, crate: mod.crate, parent: mod, name, dir: join(modDir(mod), name) };
      }
      // `#[path = "..."]` just before
      const before = text.slice(Math.max(0, at - 200), at);
      const pm = before.match(/#\[path\s*=\s*"([^"]+)"\]\s*(pub(\([^)]*\))?\s*)?$/);
      const base = modDir(mod);
      const cands = pm ? [join(mod.inline ? base : dirname(mod.file), pm[1])] : [join(base, `${name}.rs`), join(base, name, "mod.rs")];
      for (const f of cands) if (existsSync(f)) return { file: f, start: 0, end: Infinity, inline: false, crate: mod.crate, parent: mod, name, dir: null };
      return null;
    }
    return null;
  }
  // Directory where a module's child module files live.
  function modDir(mod) {
    if (mod.inline) return mod.dir;
    const f = mod.file;
    const base = f.split("/").pop();
    if (mod.isRoot || base === "mod.rs" || base === "lib.rs" || base === "main.rs") return dirname(f);
    return join(dirname(f), base.replace(/\.rs$/, ""));
  }

  // Parse the `use` trees at a module's top level: [{ path, alias, glob }].
  const useCache = new Map();
  function usesWithAlias(mod, pubOnly) {
    const key = `A:${mod.file}:${mod.start}:${pubOnly}`;
    if (useCache.has(key)) return useCache.get(key);
    const { masked, depth } = load(mod.file);
    const out = [];
    if (masked) {
      const md = moduleDepth(mod);
      const re = /(^|[;{}\]\s])((pub(\([^)]*\))?\s+)?)use\s+([^;]+);/g;
      let m;
      while ((m = re.exec(masked))) {
        const at = m.index + m[1].length;
        if (at < mod.start || at >= mod.end || depth[at] !== md) continue;
        if (pubOnly && !m[2]) continue;
        const tree = m[5].replace(/\s+as\s+/g, " as ").replace(/\s+/g, (w) => (w === " " ? " " : "")).replace(/\s*(::|,|\{|\})\s*/g, "$1");
        expand2(tree.trim(), [], out);
      }
    }
    useCache.set(key, out);
    return out;
  }
  function expand2(tree, prefix, out) {
    const brace = tree.indexOf("{");
    if (brace < 0) {
      const [pathText, alias] = tree.split(" as ");
      const parts = pathText.split("::").filter((x) => x !== "");
      if (parts[parts.length - 1] === "*") out.push({ path: [...prefix, ...parts.slice(0, -1)], glob: true });
      else if (parts.length) {
        const full = [...prefix, ...parts];
        if (full[full.length - 1] === "self") full.pop();
        out.push({ path: full, alias: alias ?? null });
      }
      return;
    }
    const head = tree.slice(0, brace).split("::").filter((x) => x !== "");
    const inner = tree.slice(brace + 1, tree.lastIndexOf("}"));
    let d = 0;
    let s = 0;
    for (let k = 0; k <= inner.length; k++) {
      const c = inner[k];
      if (c === "{") d++;
      else if (c === "}") d--;
      if ((c === "," && d === 0) || k === inner.length) {
        const part = inner.slice(s, k).trim();
        if (part) expand2(part, [...prefix, ...head], out);
        s = k + 1;
      }
    }
  }

  const ITEM = "(struct|enum|union|trait|type|fn|const|static|macro_rules!|macro)";
  function definitionIn(mod, name, wantMacro) {
    const { masked, depth } = load(mod.file);
    if (!masked) return null;
    const md = moduleDepth(mod);
    const re = new RegExp(`(^|[^\\w!])${ITEM}\\s+(r#)?${name}(?![\\w])`, "g");
    let m;
    const found = [];
    while ((m = re.exec(masked))) {
      const at = m.index + m[1].length;
      if (at < mod.start || at >= mod.end || depth[at] !== md) continue;
      const kind = m[2];
      const isMacro = kind === "macro_rules!" || kind === "macro";
      if (Boolean(wantMacro) !== isMacro) continue;
      found.push({ file: mod.file, offset: m.index + m[0].length - name.length, name, kind });
    }
    if (wantMacro && mod.isRoot) {
      // a proc-macro crate declares its macros as functions at its root:
      // #[proc_macro_derive(Name, ...)], #[proc_macro_attribute] fn name,
      // #[proc_macro] fn name
      const { text } = load(mod.file);
      const derive = new RegExp(`#\\[proc_macro_derive\\(\\s*${name}\\b`, "g");
      while ((m = derive.exec(text))) found.push({ file: mod.file, offset: m.index, name, kind: "proc_macro_derive" });
      const fnMacro = new RegExp(`#\\[proc_macro(_attribute)?\\]\\s*(#\\[[^\\]]*\\]\\s*)*pub\\s+fn\\s+${name}\\b`, "g");
      while ((m = fnMacro.exec(text))) found.push({ file: mod.file, offset: m.index, name, kind: "proc_macro" });
    }
    return found;
  }
  // #[macro_export] macro_rules! anywhere in the crate (they live at the root).
  const macroIndex = new Map(); // crate root file -> name -> [defs]
  function exportedMacro(root, name) {
    if (!macroIndex.has(root.file)) macroIndex.set(root.file, buildMacroIndex(root));
    return macroIndex.get(root.file).get(name) ?? [];
  }
  function buildMacroIndex(root) {
    const seen = new Set();
    const stack = [rootModule(root)];
    const files = [];
    // walk every module file reachable through `mod` declarations
    while (stack.length) {
      const mod = stack.pop();
      const k = `${mod.file}:${mod.start}`;
      if (seen.has(k)) continue;
      seen.add(k);
      files.push(mod);
      const { masked, depth } = load(mod.file);
      if (!masked) continue;
      const md = moduleDepth(mod);
      const re = /(^|[^\w])mod\s+(r#)?(\w+)\s*[;{]/g;
      let m;
      while ((m = re.exec(masked))) {
        const at = m.index + m[1].length;
        if (at < mod.start || at >= mod.end || depth[at] !== md) continue;
        const child = childModule(mod, m[3]);
        if (child) stack.push(child);
      }
    }
    const index = new Map();
    const seenFiles = new Set();
    for (const mod of files) {
      if (seenFiles.has(mod.file)) continue; // inline modules share their file
      seenFiles.add(mod.file);
      const { text, masked } = load(mod.file);
      if (!masked) continue;
      const re = /macro_rules!\s+(\w+)\b/g;
      let m;
      while ((m = re.exec(masked))) {
        const before = text.slice(Math.max(0, m.index - 300), m.index);
        if (!/#\[macro_export[^\]]*\][^;{}]*$/.test(before)) continue;
        const name = m[1];
        if (!index.has(name)) index.set(name, []);
        index.get(name).push({ file: mod.file, offset: m.index + m[0].length - name.length, name, kind: "macro_rules!" });
      }
    }
    return index;
  }

  // Look `name` up in module `mod` in namespace `ns`: "module" (a path's
  // middle segment), "item" (its last segment: a type, value or function;
  // a module only when nothing else has the name) or "macro". `allowPrivate`:
  // the module's private imports count (only for the first segment of a path
  // written inside that module); from outside only `pub` re-exports do.
  // Returns { def, rest? } | { module } | { error }.
  const lookupCache = new Map();
  function lookup(mod, name, ns, budget, allowPrivate) {
    const key = `${mod.file}:${mod.start}:${name}:${ns}:${allowPrivate ? 1 : 0}`;
    if (lookupCache.has(key)) return lookupCache.get(key);
    lookupCache.set(key, { error: `cycle at ${name}` }); // a re-export cycle ends here
    const result = lookupUncached(mod, name, ns, budget, allowPrivate);
    lookupCache.set(key, result);
    return result;
  }
  function lookupUncached(mod, name, ns, budget, allowPrivate) {
    if (budget <= 0) return { error: "re-export chain too long" };
    const modules = [];
    const defs = [];
    const take = (r) => {
      if (r.error) return;
      if (r.module) modules.push(r);
      else defs.push(r);
    };
    if (ns !== "macro") {
      const child = childModule(mod, name);
      if (child) modules.push({ module: child });
    }
    for (const d of definitionIn(mod, name, ns === "macro") ?? []) defs.push({ def: d });
    if (ns === "macro" && mod.isRoot) for (const d of exportedMacro(mod.crate, name)) defs.push({ def: d });
    const imports = usesWithAlias(mod, !allowPrivate);
    for (const u of imports) {
      if (u.glob) continue;
      if ((u.alias ?? u.path[u.path.length - 1]) !== name) continue;
      take(resolveFrom(mod, u.path, ns === "macro", budget - 1, ns));
    }
    // globs: when nothing is found, or when an item is wanted and only a
    // module of that name is (`pub(crate) mod compress; pub use compress::*;`)
    if (defs.length === 0 && (modules.length === 0 || ns !== "module")) {
      for (const u of imports) {
        if (!u.glob) continue;
        const target = resolveFrom(mod, u.path, false, budget - 1, "module");
        if (target.module) take(lookup(target.module, name, ns, budget - 1, false));
      }
    }
    const pick = ns === "module" ? (modules.length ? modules : defs) : ns === "item" ? (defs.length ? defs : modules) : defs;
    if (pick.length === 0) return { error: `${name} not found in ${mod.file}` };
    const keys = new Set(pick.map((r) => (r.module ? `M${r.module.file}:${r.module.start}` : `D${r.def.file}:${r.def.offset}:${(r.rest ?? []).join("::")}`)));
    if (keys.size > 1) return { error: `${name} ambiguous in ${mod.file}` };
    return pick[0];
  }

  // An extern crate from crate `from`. With several versions downloaded, the
  // one `from`'s manifest requires (same major, or same minor below 1.0).
  function externCrate(name, from) {
    const any = crateRoot(name, null);
    if (!any.error || !/versions/.test(any.error) || !from?.dir) return any;
    let toml = "";
    try {
      toml = readFileSync(join(from.dir, "Cargo.toml"), "utf8");
    } catch {
      return any;
    }
    let req = null;
    for (const key of [name, name.replace(/_/g, "-")]) {
      const esc = key.replace(/[-]/g, "\\-");
      req ??= toml.match(new RegExp(`^\\s*"?${esc}"?\\s*=\\s*"([^"]+)"`, "m"))?.[1];
      req ??= toml.match(new RegExp(`^\\s*"?${esc}"?\\s*=\\s*\\{[^}]*\\bversion\\s*=\\s*"([^"]+)"`, "m"))?.[1];
      req ??= toml.match(new RegExp(`^\\[[\\w.-]*dependencies\\.${esc}\\](?:(?!\\n\\[)[\\s\\S])*?\\bversion\\s*=\\s*"([^"]+)"`, "m"))?.[1];
    }
    if (!req) return any;
    const want = req.replace(/^[=^~<>\s]+/, "").split(".").map(Number);
    const compatible = (v) => {
      const have = v.split(".").map((x) => Number.parseInt(x, 10));
      return want[0] > 0 ? have[0] === want[0] : have[0] === 0 && have[1] === want[1];
    };
    const list = (crateDirs.get(name) ?? crateDirs.get(name.replace(/_/g, "-")) ?? []).filter((x) => compatible(x.version));
    return list.length === 1 ? crateRoot(name, list[0].version) : any;
  }
  // A renamed dependency in the crate's manifest:
  // `tree-sitter = { package = "tree-house-bindings", ... }` or a
  // `[dependencies.tree-sitter]` table with `package = "..."`.
  function depPackage(root, name) {
    if (!root.dir) return name;
    let toml = "";
    try {
      toml = readFileSync(join(root.dir, "Cargo.toml"), "utf8");
    } catch {
      return name;
    }
    for (const key of [name, name.replace(/_/g, "-")]) {
      const esc = key.replace(/[-]/g, "\\-");
      const inline = toml.match(new RegExp(`^\\s*"?${esc}"?\\s*=\\s*\\{[^}]*\\bpackage\\s*=\\s*"([^"]+)"`, "m"));
      if (inline) return inline[1];
      const table = toml.match(new RegExp(`^\\[[\\w.-]*dependencies\\.${esc}\\](?:(?!\\n\\[)[\\s\\S])*?\\bpackage\\s*=\\s*"([^"]+)"`, "m"));
      if (table) return table[1];
    }
    return name;
  }
  // `extern crate alloc as alloc_crate;` at a crate root names a crate.
  function externAlias(root, name) {
    const { masked } = load(root.file);
    if (!masked) return name;
    const re = /\bextern\s+crate\s+(\w+)\s+as\s+(\w+)\s*;/g;
    let m;
    while ((m = re.exec(masked))) if (m[2] === name) return m[1];
    return name;
  }

  // Resolve a path written in module `mod`; `lastNs` is the namespace of the
  // last segment ("item", "macro" or "module").
  function resolveFrom(mod, path, wantMacro, budget, lastNs) {
    if (budget <= 0) return { error: "re-export chain too long" };
    const nsAt = (i) => (i === path.length - 1 ? (wantMacro ? "macro" : (lastNs ?? "item")) : "module");
    let cur = null;
    let i = 0;
    const first = path[0];
    if (first === "crate" || first === "$crate") (cur = rootOf(mod)), (i = 1);
    else if (first === "self") (cur = mod), (i = 1);
    else if (first === "super") {
      cur = mod;
      while (path[i] === "super") (cur = cur.parent ?? cur), i++;
    } else if (first === "") i = 1;
    if (!cur) {
      // a name in scope (private imports count here), else an extern crate
      const local = lookup(mod, first, nsAt(0), budget - 1, true);
      if (!local.error && local.module) {
        if (path.length === 1) return local;
        cur = local.module;
        i = 1;
      } else if (!local.error && local.def) return { def: local.def, rest: [...(local.rest ?? []), ...path.slice(1)] };
      else {
        const root = externCrate(depPackage(rootOf(mod).crate, externAlias(rootOf(mod), first)), rootOf(mod).crate);
        if (root.error) return { error: `cannot resolve ${path.join("::")}: ${root.error}` };
        cur = rootModule(root);
        i = 1;
      }
    }
    if (i >= path.length) return { module: cur };
    for (; i < path.length; i++) {
      const r = lookup(cur, path[i], nsAt(i), budget - 1, false);
      if (r.error) return r;
      if (r.module) {
        cur = r.module;
        continue;
      }
      return { def: r.def, rest: [...(r.rest ?? []), ...path.slice(i + 1)] };
    }
    return { module: cur };
  }
  function rootOf(mod) {
    let m = mod;
    while (m.parent) m = m.parent;
    return m;
  }

  /** Resolve `segments` from the root of crate `name` (version may be null). */
  function resolveItem(name, version, segments, wantMacro) {
    const root = crateRoot(name, version);
    if (root.error) return { error: root.error };
    if (segments.length === 0) return { module: rootModule(root) };
    // segments are relative to the crate root (never an extern crate name)
    return resolveFrom(rootModule(root), ["self", ...segments], wantMacro, 40);
  }
  return { resolveItem, isProcMacroCrate, crateDirs };
}
