// SPDX-License-Identifier: MIT
// C-19: checks of rustpath.mjs on the toolchain's rust-src: pairs that must
// resolve to the same definition, and pairs that must not.
// Usage: node rustpath-check.mjs SYSROOT [CARGO_HOME]
import { join } from "node:path";
import { createResolver } from "./rustpath.mjs";

const [sysroot, cargoHome] = process.argv.slice(2);
const r = createResolver({ registries: cargoHome ? [join(cargoHome, "registry/src")] : [], sysroot });
const key = (x) => (x.error ? `ERROR ${x.error}` : x.module ? `module ${x.module.file}:${x.module.start}` : `${x.def.kind} ${x.def.name} ${x.def.file.split("/").slice(-3).join("/")}:${x.def.offset} rest=${(x.rest ?? []).join("::")}`);
const same = [
  [["std", ["option", "Option", "None"]], ["core", ["option", "Option", "None"]]],
  [["std", ["collections", "HashMap"]], ["std", ["collections", "hash", "map", "HashMap"]]],
  [["std", ["vec", "Vec"]], ["alloc", ["vec", "Vec"]]],
  [["std", ["string", "String"]], ["alloc", ["string", "String"]]],
  [["std", ["println"], true], ["std", ["macros", "println"], true]],
  [["std", ["assert_eq"], true], ["core", ["macros", "assert_eq"], true]],
  [["std", ["format"], true], ["alloc", ["macros", "format"], true]],
  [["std", ["fmt", "Display"]], ["core", ["fmt", "Display"]]],
  [["std", ["path", "Path", "join"]], ["std", ["path", "Path", "join"]]],
  [["std", ["env", "var"]], ["std", ["env", "var"]]],
  [["std", ["sync", "Arc"]], ["alloc", ["sync", "Arc"]]],
  [["std", ["io", "Read"]], ["std", ["io", "Read"]]],
  [["std", ["ffi", "OsString"]], ["std", ["ffi", "os_str", "OsString"]]],
  [["std", ["error", "Error"]], ["core", ["error", "Error"]]],
];
const different = [
  [["std", ["fmt", "Display"]], ["core", ["fmt", "Debug"]]],
  [["std", ["collections", "HashMap"]], ["std", ["collections", "hash", "set", "HashSet"]]],
  [["std", ["io", "Error"]], ["core", ["error", "Error"]]],
];
let fails = 0;
for (const [label, pairs, want] of [["same", same, true], ["different", different, false]])
  for (const [[ac, ap, am], [bc, bp, bm]] of pairs) {
    const a = r.resolveItem(ac, null, ap, am);
    const b = r.resolveItem(bc, null, bp, bm);
    const eq = !a.error && !b.error && key(a) === key(b);
    const ok = a.error || b.error ? false : eq === want;
    if (!ok) fails++;
    console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${ac}::${ap.join("::")} = ${key(a)} | ${bc}::${bp.join("::")} = ${key(b)}`);
  }
process.exit(fails ? 1 : 0);
