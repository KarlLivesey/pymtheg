fn helper()->u8 { 1 }
macro_rules! c {($($t:tt)*)=>{{ let f = || println!($($t)*); f(); }}}
macro_rules! l {($($t:tt)*)=>{{ for helper in 0..1u8 { let _ = helper; println!($($t)*); } }}}
fn main(){ c!("{}", helper()); l!("{}", helper()); }
