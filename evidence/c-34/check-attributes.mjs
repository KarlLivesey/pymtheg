// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const root = mkdtempSync(join(process.env.PYM_SCRATCH, "rust-attributes-"));
const fixture = join(root, "fixture");
cpSync("test/fixtures/graph-rust-c34-attributes", fixture, { recursive: true });
const manifest = join(fixture, "Cargo.toml");
const original = readFileSync(manifest, "utf8");
const source = join(fixture, "src/lib.rs");

function cargo(label, args, expected, env = {}) {
  const result = spawnSync(
    "cargo",
    [...args, "--offline", "--manifest-path", manifest],
    {
      encoding: "utf8",
      env: { ...process.env, CARGO_TARGET_DIR: join(root, "target"), ...env },
    },
  );
  if (expected) {
    assert.notEqual(result.status, 0, label);
    assert.match(result.stderr, expected, label);
  } else {
    assert.equal(result.status, 0, `${label}\n${result.stderr}`);
  }
  console.log(label + (expected ? " rejected by rustc" : " accepted by rustc"));
}

cargo("Local cfg and language-prelude witnesses", ["test"]);
cargo("Live macro-use and explicit imports", ["test", "--features", "foreign"]);

function check(label, text, expected, options = {}) {
  writeFileSync(
    manifest,
    original.replace(
      'edition = "2021"',
      `edition = "${options.edition ?? "2021"}"`,
    ),
  );
  writeFileSync(source, text + "\n");
  cargo(label, ["check", "--all-targets"], expected, options.env);
}

check(
  "External glob can supply the derive",
  "use competing::*; #[derive(Debug)] struct Item;",
  /E0659.*Debug.*ambiguous/,
);
check(
  "Captured glob of a type named Debug",
  "mod types { pub struct Debug; } use types::*; #[derive(Debug)] struct Item;",
);
check(
  "Glob can supply the active test attribute",
  "mod exported { pub use competing::foreign_test as test; } use exported::*; #[test] fn sample() {}",
  /E0659.*test.*ambiguous/,
);
check(
  "Named macro-use re-export remains active in edition 2015",
  `#![no_implicit_prelude]
#[macro_use(Debug)] extern crate competing;
#[derive(Debug)] struct Item;
fn probe() -> u8 { outside() }`,
  undefined,
  { edition: "2015" },
);
check(
  "Missing tool registration",
  "#[unregistered::skip] fn sample() {}",
  /E0433.*unregistered/,
);
check(
  "Tool prelude disabled",
  "#![no_implicit_prelude] #[rustfmt::skip] fn sample() {}",
  /E0433.*rustfmt/,
);
check(
  "A written module can supply a tool-shaped proc macro",
  "mod diagnostic { pub use competing::foreign_test as on_unimplemented; } #[diagnostic::on_unimplemented] trait Sample {} fn probe() -> u8 { outside() }",
);
check(
  "No sysroot for derive output",
  "#![feature(no_core)] #![no_core] #[derive(Debug)] struct Item;",
  /cannot find attribute `derive`/,
  { env: { RUSTC_BOOTSTRAP: "1" } },
);
for (const [name, suffix, item] of [
  ["inline", "", "fn f() {}"],
  ["allow", "(dead_code)", "fn f() {}"],
  ["doc", ' = "comment"', "fn f() {}"],
  ["repr", "(C)", "struct Item { n: u8 }"],
  ["must_use", "", "fn f() -> u8 { 1 }"],
  ["cfg", "(all())", "fn f() {}"],
]) {
  check(
    `Inert or conditional builtin ${name}`,
    `use competing::foreign_test as ${name}; #[${name}${suffix}] ${item}`,
    /(?:E0659.*ambiguous|reserved in attribute namespace)/,
  );
}

const facade = join(fixture, "facade");
mkdirSync(join(facade, "src"), { recursive: true });
writeFileSync(
  join(facade, "Cargo.toml"),
  `[package]
name = "facade"
version = "0.0.0"
edition = "2021"
[dependencies]
competing = { path = "../competing" }
`,
);
writeFileSync(join(facade, "src/lib.rs"), "pub use competing::Debug;\n");
writeFileSync(manifest, original + 'facade = { path = "facade" }\n');
writeFileSync(
  source,
  `#[macro_use] extern crate facade;
#[derive(Debug)] struct Item;
#[test] fn reexported_derive() { assert_eq!(outside(), 2); }
`,
);
cargo("A library can re-export a derive into the macro-use prelude", ["test"]);
