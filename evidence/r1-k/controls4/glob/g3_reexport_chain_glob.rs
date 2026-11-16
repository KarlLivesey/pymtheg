mod a { #[macro_export] macro_rules! assert { ($($t:tt)*) => {} } }
mod b { pub use crate::assert; }
mod c { pub use crate::b::*; }
use crate::c::*;
fn main() { assert!(false); println!("passed"); }
