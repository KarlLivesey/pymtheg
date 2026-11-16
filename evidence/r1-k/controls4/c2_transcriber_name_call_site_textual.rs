// `outer` is defined where only std writeln! exists; invoked where a project
// writeln! is in textual scope. The project one is used (prints []).
use std::fmt::Write;
macro_rules! outer { ($s:expr) => { { let mut s = String::new(); let _ = writeln!(s, "{}", $s); s } } }
mod b {
    macro_rules! writeln { ($($t:tt)*) => { Ok::<(), std::fmt::Error>(()) } }
    pub fn go() -> String { outer!("x") }
}
fn main() { println!("[{}]", b::go().trim()); }
