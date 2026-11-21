// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
const receiver = {
  owned: /^(?:mut )?self$/,
  shared: /^&self$/,
  mutable: /^&mut self$/,
};
const names = new Set();
for (const [owner, form, since, arity, methods] of groups)
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
        [owner, name, file, line + 1, "1." + since, form, arity].join("\t"),
      );
    }
  }
const unsigned = ["u8", "u16", "u32", "u64", "u128", "usize"];
const signed = ["i8", "i16", "i32", "i64", "i128", "isize"];
const owners = {
  int: [...unsigned, ...signed],
  uint: unsigned,
  sint: signed,
  float: ["f32", "f64"],
  str: ["str"],
  char: ["char"],
  "option::Option": ["Option"],
  "result::Result": ["Result"],
};
const argumentsFor = {
  str: {
    zero: [],
    one: ["'x'"],
    two: ["1", "'x'"],
    is_char_boundary: ["0"],
    split_at: ["0"],
  },
  Option: {
    and: ["Some(2u8)"],
    and_then: ["|x| Some(x)"],
    expect: ['"value"'],
    map: ["|x| x"],
    ok_or: ["()"],
    ok_or_else: ["|| ()"],
    or: ["Some(2u8)"],
    or_else: ["|| Some(2u8)"],
    unwrap_or: ["2"],
    unwrap_or_else: ["|| 2"],
  },
  Result: {
    and: ["Ok(2u8)"],
    and_then: ["|x| Ok(x)"],
    expect: ['"value"'],
    expect_err: ['"error"'],
    map: ["|x| x"],
    map_err: ["|x| x"],
    or: ["Ok::<u8, ()>(2)"],
    or_else: ["|_| Ok::<u8, ()>(2)"],
    unwrap_or: ["2"],
    unwrap_or_else: ["|_| 2"],
  },
};
function statement(owner, form, method, arity) {
  let value = {
    str: '"x"',
    char: "'x'",
    Option: "Some(1u8)",
    Result: "Ok::<u8, ()>(1)",
  }[owner];
  value ??= owner.startsWith("f") ? `1.0${owner}` : `1${owner}`;
  if (form === "shared" && owner !== "str") value = "&" + value;
  if (form === "mutable") value = "&mut " + value;
  const inputs =
    argumentsFor[owner]?.[method] ??
    argumentsFor[owner]?.[["zero", "one", "two"][arity]] ??
    (arity === 0 ? [] : [/^f\d/.test(owner) ? "2.0" : "2"]);
  assert.equal(inputs.length, arity, owner + "::" + method);
  const name = method === "parse" ? "parse::<u8>" : method;
  return `let _ = ${owner}::${name}(${[value, ...inputs].join(", ")});`;
}

const scratch = mkdtempSync(join(process.env.PYM_SCRATCH, "core-catalog-"));
function compile(minor, edition, label, source, expectedError) {
  const file = join(scratch, label + ".rs");
  writeFileSync(file, source + "\n");
  const result = spawnSync(
    "rustc",
    [
      `+1.${minor}.0`,
      "--edition",
      edition,
      "--crate-type",
      "lib",
      "--emit",
      "metadata",
      "--out-dir",
      scratch,
      file,
    ],
    { encoding: "utf8" },
  );
  if (result.error) throw result.error;
  if (expectedError) {
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, expectedError);
  } else assert.equal(result.status, 0, result.stderr);
}
for (const [edition, minor] of [
  ["2015", 31],
  ["2018", 31],
  ["2021", 56],
  ["2021", 83],
  ["2024", 85],
]) {
  const cases = ["let _ = 1f32.max(2.0);", "let _ = 1f64.max(2.0);"];
  for (const [family, form, since, arity, methods] of groups)
    if (since <= minor)
      for (const owner of owners[family])
        for (const name of methods.split(" "))
          cases.push(statement(owner, form, name, arity));
  compile(
    minor,
    edition,
    `edition_${edition}_rust_${minor}`,
    `#![no_std]\npub fn catalog() {\n${cases.join("\n")}\n}`,
  );
  console.error(
    `Rust 1.${minor}.0, edition ${edition}: ${cases.length} no_std calls compiled`,
  );
}
for (const minor of [56, 83]) {
  const methods =
    "pub fn probe(a: f32, b: f64) { let _: f32 = a.abs(); let _: f64 = b.signum(); }";
  compile(
    minor,
    "2021",
    `absent_${minor}`,
    "#![no_std]\n" + methods,
    /error\[E0599\]/,
  );
  compile(minor, "2021", `std_${minor}`, methods);
  compile(
    minor,
    "2021",
    `extension_${minor}`,
    `#![no_std]
    trait FloatExtension { fn abs(self) -> bool; fn signum(self) -> bool; }
    impl FloatExtension for f32 { fn abs(self) -> bool { true } fn signum(self) -> bool { true } }
    impl FloatExtension for f64 { fn abs(self) -> bool { true } fn signum(self) -> bool { true } }
    pub fn probe(a: f32, b: f64) {
      let _: bool = a.abs(); let _: bool = a.signum();
      let _: bool = b.abs(); let _: bool = b.signum();
    }`,
  );
  console.error(
    `Rust 1.${minor}.0: float std and no_std extension controls passed`,
  );
}
console.error(names.size + " catalog entries checked");
