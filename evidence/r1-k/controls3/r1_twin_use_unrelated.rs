fn helper()->u8 {1}
macro_rules! m { ($($t:tt)*)=>{{use std::fmt::Write as _W; println!($($t)*);}} }
fn main(){m!("{}",helper());}
