mod macros { macro_rules! concat { ($($t:tt)*) => { "PROJECT" } } pub(crate) use concat; }
use crate::macros::*;
fn main() { println!("{}", concat!("a", "b")); }
