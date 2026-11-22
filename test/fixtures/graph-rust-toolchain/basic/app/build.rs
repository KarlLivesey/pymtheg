// SPDX-License-Identifier: MIT
// A build script: generates code into OUT_DIR and sets a cfg.
use std::{env, fs, path::Path};

fn main() {
    let out = env::var("OUT_DIR").unwrap();
    fs::write(
        Path::new(&out).join("generated.rs"),
        "pub fn generated() -> u32 { 7 }\n",
    )
    .unwrap();
    println!("cargo:rustc-check-cfg=cfg(has_generated)");
    println!("cargo:rustc-cfg=has_generated");
    println!("cargo:rerun-if-changed=build.rs");
}
