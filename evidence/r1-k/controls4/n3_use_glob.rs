fn helper() -> u8 { std::println!("CALLED"); 1 }
mod macros { macro_rules! println { ($($t:tt)*) => {} } pub(crate) use println; }
mod site { use crate::macros::*; pub fn go() { println!("{}", super::helper()); } }
fn main() { site::go(); std::println!("end"); }
