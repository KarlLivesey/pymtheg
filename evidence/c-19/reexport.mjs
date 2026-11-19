// SPDX-License-Identifier: MIT
// C-19: does Pymtheg's library unit really re-export the name the toolchain
// says another crate declares? Looks in the unit's downloaded source (any
// version under CARGO_HOME/registry/src) for a re-export line naming it: a
// `pub use` / `pub type` / `pub extern crate` line, or a line of a multi-line
// `pub use {...}` list. Also accepts a re-export of the path's first module
// (`pub use usvg;` for `usvg::Tree`), and reports a glob-only re-export apart.
// A text check, not a resolver: it shows the re-export exists, nothing more.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const STD = new Set(["std", "core", "alloc", "proc_macro", "test"]);

function rsFiles(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) rsFiles(p, out);
    else if (e.endsWith(".rs")) out.push(p);
  }
  return out;
}

export function reexportChecker(cargoHome) {
  const registry = join(cargoHome, "registry/src");
  const crateDirs = [];
  for (const index of readdirSync(registry)) for (const d of readdirSync(join(registry, index))) crateDirs.push(join(registry, index, d));
  const sources = new Map();
  const unitLines = (unit) => {
    if (!sources.has(unit)) {
      const dirs = crateDirs.filter((d) => d.split("/").pop().replace(/-\d+\.\d+\.\d+.*$/, "") === unit);
      const lines = [];
      for (const d of dirs)
        for (const f of rsFiles(join(d, "src")))
          for (const l of readFileSync(f, "utf8").split("\n"))
            if (/^\s*pub(\([^)]*\))?\s+(use|type|extern crate)\b/.test(l) || /^\s*[\w:{}, ]+(\s+as\s+\w+)?\s*,?\s*$/.test(l)) lines.push(l);
      sources.set(unit, { found: dirs.length > 0, lines });
    }
    return sources.get(unit);
  };
  // pymtheg: "ECOSYSTEM UNIT SYMBOL (evidence)"
  return (pymtheg) => {
    const [eco, unit, symbol] = pymtheg.split(" ");
    const segments = symbol.replace(/^#\[/, "").replace(/\]$/, "").replace(/!$/, "").split("::");
    const name = segments[segments.length - 1];
    const head = segments[0];
    if (eco === "rust-std" || STD.has(unit)) return "std unit (not checked)";
    const u = unitLines(unit);
    if (!u.found) return "unit source not downloaded";
    if (u.lines.some((l) => new RegExp(`\\b${name}\\b`).test(l))) return "re-export of the name found";
    if (segments.length > 1 && u.lines.some((l) => new RegExp(`\\b${head}\\b`).test(l))) return "re-export of the path's module found";
    if (u.lines.some((l) => /pub\s+use\s+[\w:]+::\*/.test(l))) return "only a glob re-export (possible)";
    return "NOT found";
  };
}
