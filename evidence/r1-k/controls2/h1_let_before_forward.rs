fn helper()->u8 { 1 }
macro_rules! m {($($t:tt)*)=>{{ let helper = || 2u8; let _ = helper(); println!($($t)*); }}}
fn main(){ m!("{}", helper()); }
