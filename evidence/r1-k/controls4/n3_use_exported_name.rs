fn helper() -> u8 { std::println!("CALLED"); 1 }
mod m { #[macro_export] macro_rules! println { ($($t:tt)*) => {} } }
mod site { use crate::println; pub fn go() { println!("{}", super::helper()); } }
fn main() { site::go(); std::println!("end"); }
