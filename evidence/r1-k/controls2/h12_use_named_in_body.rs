mod other { pub fn helper()->u8 { 2 } }
fn helper()->u8 { 1 }
macro_rules! m {($($t:tt)*)=>{{ use crate::other::helper; println!($($t)*); }}}
fn main(){ m!("{}", helper()); }
