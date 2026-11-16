mod macros { macro_rules! format { ($($t:tt)*) => { 0 } } pub(crate) use format; }
fn main() { use crate::macros::*; let s = format!("{}", 1); println!("{:?}", s); }
