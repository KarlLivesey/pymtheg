fn helper()->u8 { println!("called"); 1 }
macro_rules! d {($($t:tt)*)=>{{ println!($($t)*); println!($($t)*); }}}
fn main(){ d!("{}", helper()); }
