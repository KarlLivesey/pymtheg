// A project writeln! is in textual scope where `outer` is DEFINED, not where
// it is invoked. The expansion uses std's writeln! (prints [x]).
use std::fmt::Write;
mod a {
    macro_rules! writeln { ($($t:tt)*) => { Ok::<(), std::fmt::Error>(()) } }
    #[macro_export] macro_rules! outer { ($s:expr) => { { let mut s = String::new(); let _ = writeln!(s, "{}", $s); s } } }
}
fn main() { println!("[{}]", crate::outer!("x").trim()); }
