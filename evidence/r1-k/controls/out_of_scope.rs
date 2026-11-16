mod doc { macro_rules! writeln { ($($tt:tt)*) => { fn helper() {} } } pub fn f(){} }
fn helper() -> u8 { 1 }
fn run(s: &mut String) { use std::fmt::Write; writeln!(s, "x").unwrap(); helper(); }
fn main(){ run(&mut String::new()); doc::f() }
