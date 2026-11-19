use std::{env, fs, path::PathBuf};

fn main() {
    let output = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    fs::write(output.join("pkg.rs"), "pub struct Option;").unwrap();
}
