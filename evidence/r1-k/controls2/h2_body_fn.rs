fn helper()->u8 { 1 }
macro_rules! m {($($t:tt)*)=>{{ fn helper()->u8 { 2 } println!($($t)*); }}}
fn main(){ m!("{}", helper()); }
