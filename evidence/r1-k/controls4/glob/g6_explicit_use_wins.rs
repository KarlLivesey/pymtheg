// Contrast: an explicit `use` (not a glob) does rebind the std name.
mod macros { macro_rules! vec { ($($t:tt)*) => { 0 } } pub(crate) use vec; }
use crate::macros::vec;
fn main() { let v = vec![1, 2]; println!("{:?}", v); }
