macro_rules! writeln { ($($tt:tt)*) => { std::writeln!($($tt)*).unwrap(); } }
fn helper() -> u8 { 1 }
fn run(s: &mut String) { use std::fmt::Write; writeln!(s, "{}", helper()); helper(); }
fn main(){ run(&mut String::new()) }
