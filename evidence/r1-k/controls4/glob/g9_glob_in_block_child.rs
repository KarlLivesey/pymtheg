mod macros { macro_rules! write { ($($t:tt)*) => { Ok::<(), std::fmt::Error>(()) } } pub(crate) use write; }
mod inner { pub fn go() -> String { use std::fmt::Write as _; use crate::macros::*; let mut s = String::new(); let _ = write!(s, "x"); s } }
fn main() { std::println!("[{}]", inner::go()); }
