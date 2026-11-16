mod macros { macro_rules! println { ($($t:tt)*) => {} } pub(crate) use println; }
mod inner { use crate::macros::*; pub fn go() { println!("x"); } }
fn main() { inner::go(); std::println!("end"); }
