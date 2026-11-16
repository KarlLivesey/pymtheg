fn helper()->u8 {1}
#[macro_export] macro_rules! other {
    ($($t:tt)*)=>{{fn helper()->u8 {2} std::println!($($t)*);}}
}
macro_rules! m {
    ($($t:tt)*)=>{{use crate::other as println; println!($($t)*);}}
}
fn main(){m!("{}",helper());}
