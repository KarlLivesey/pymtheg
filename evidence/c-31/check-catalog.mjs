// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rustc = (...args) =>
  execFileSync("rustc", args, { encoding: "utf8" }).trim();
assert.match(rustc("--version"), /^rustc 1\.98\.1 \(48a229cea /);
const source = join(
  rustc("--print", "sysroot"),
  "lib/rustlib/src/rust/library/core/src",
);
const table = readFileSync("src/graph/languages/rust/core-methods.ts", "utf8");
const groups = Function(
  "return " + table.split("const groups = ")[1].split(" as const")[0],
)();
const files = {
  str: ["str/mod.rs"],
  char: ["char/methods.rs"],
  int: ["num/uint_macros.rs", "num/int_macros.rs"],
  uint: ["num/uint_macros.rs"],
  sint: ["num/int_macros.rs"],
  float: ["num/f32.rs", "num/f64.rs"],
  "option::Option": ["option.rs"],
  "result::Result": ["result.rs"],
};
const editionFloor = { 2015: 0, 2018: 31, 2021: 56, 2024: 85 };
const receiver = {
  owned: /^(?:mut )?self$/,
  shared: /^&self$/,
  mutable: /^&mut self$/,
};
const names = new Set();
for (const [owner, form, edition, arity, methods] of groups)
  for (const file of files[owner]) {
    const lines = readFileSync(join(source, file), "utf8").split("\n");
    for (const name of methods.split(" ")) {
      const pattern = new RegExp(
        "^\\s*pub\\s+(?:const\\s+)?fn\\s+" + name + "(?:<|\\()",
      );
      const line = lines.findIndex((line) => pattern.test(line));
      assert.ok(line >= 0, file + " " + name);
      assert.equal(
        lines.findIndex((text, i) => i > line && pattern.test(text)),
        -1,
      );
      const before = lines.slice(line - 15, line).join(" ");
      const stability = [
        ...before.matchAll(/#\[stable\([^\]]*since = "1\.(\d+)\.\d+"/g),
      ].at(-1);
      assert.ok(
        stability && Number(stability[1]) <= editionFloor[edition],
        file + " " + name,
      );
      const declaration = lines
        .slice(line, line + 6)
        .join(" ")
        .replace(/\s+/g, " ");
      const args = /\(((?:mut )?self|&mut self|&self)([^)]*)\)/.exec(
        declaration,
      );
      assert.match(args?.[1] ?? "", receiver[form], file + " " + name);
      const parameters = args[2].replace(/<[^<>]*>/g, "");
      assert.equal(
        parameters
          .split(",")
          .slice(1)
          .filter((arg) => arg.trim()).length,
        arity,
        file + " " + name,
      );
      names.add(owner + "::" + name);
      console.log(
        [owner, name, file, line + 1, "1." + stability[1], form, arity].join(
          "\t",
        ),
      );
    }
  }
console.error(names.size + " catalog entries checked");
