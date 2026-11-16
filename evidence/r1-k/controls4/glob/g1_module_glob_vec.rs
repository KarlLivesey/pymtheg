mod macros { macro_rules! vec { ($($t:tt)*) => { 0 } } pub(crate) use vec; }
use crate::macros::*;
fn main() { let v = vec![1, 2]; println!("{:?}", v); }
