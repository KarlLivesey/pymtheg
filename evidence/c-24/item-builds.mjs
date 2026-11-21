// SPDX-License-Identifier: MIT
// C-24: derive the per-item measurement builds from a copy of the full C-24
// build by switching later items off in its compiled Rust module:
//   items-1   determinism only (items 2 and 3 off)
//   items-12  determinism and unlocked registry facades (item 3 off)
// Every replacement must match exactly once, or the script fails.
// Usage: node item-builds.mjs FULL_BUILD_DIR OUT_DIR {items-1|items-12}
import {
  cpSync,
  existsSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const [full, out, variant] = process.argv.slice(2);
const rust = (dir) => join(resolve(dir), "dist/graph/languages/rust");
cpSync(join(full, "dist"), join(out, "dist"), { recursive: true });
cpSync(join(full, "grammars"), join(out, "grammars"), { recursive: true });
cpSync(join(full, "package.json"), join(out, "package.json"));
if (!existsSync(join(out, "node_modules")))
  symlinkSync(resolve(full, "node_modules"), join(out, "node_modules"));

function patch(file, from, to) {
  const path = join(rust(out), file);
  const text = readFileSync(path, "utf8");
  const count = text.split(from).length - 1;
  if (count !== 1) throw Error(`${file}: expected one match, found ${count}`);
  writeFileSync(path, text.replace(from, to));
}
// Item 3 off: every unplaced inherent impl in reach stays possible.
patch(
  "resolve.js",
  '[...(unknownInherent.get(m.id) ?? ["*"])].some((r) => r === "*" || typeRoots.has(r))',
  "true",
);
if (variant === "items-1") {
  // Item 2 off: no unlocked registry route, and the macro link needs the
  // implementing crate's source as on main.
  patch("cargo.js", "...(unlockedSourcesFixed && libraryKnown", "...(false");
  patch(
    "resolve.js",
    "!cargoMacroFacadeKnown(path))\n                return refuseLibrary(\"macro facade source unverified\");",
    '!cargoMacroSourceKnown(path))\n                return refuseLibrary("macro implementation source unverified");',
  );
} else if (variant !== "items-12") throw Error("Unknown variant " + variant);
console.log(out, variant, "ready");
