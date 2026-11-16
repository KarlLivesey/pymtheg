use std::fmt::Write as _;
fn helper() -> u8 { 1 }
mod doc { macro_rules! write { ($($t:tt)*) => { Ok::<(), std::fmt::Error>(()) } } pub fn f() { let _ = write!(String::new(), "x"); } }
fn main() { let mut s = String::new(); let _ = write!(s, "{}", helper()); doc::f(); println!("[{}]", s); }
