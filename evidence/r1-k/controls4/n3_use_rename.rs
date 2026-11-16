fn helper() -> u8 { println!("CALLED"); 1 }
mod m { #[macro_export] macro_rules! quiet { ($($t:tt)*) => {} } }
use crate::quiet as println;
fn main() { println!("{}", helper()); std::println!("end"); }
