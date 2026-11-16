fn helper() -> u8 { std::println!("CALLED"); 1 }
#[macro_use] mod macros { macro_rules! println { ($($t:tt)*) => {} } }
mod site { pub fn go() { println!("{}", super::helper()); } }
fn main() { site::go(); std::println!("end"); }
