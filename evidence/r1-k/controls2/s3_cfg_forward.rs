fn helper()->u8 { println!("called"); 1 }
macro_rules! m {($($t:tt)*)=>{{ #[cfg(any())] println!($($t)*); }}}
fn main(){m!("{}",helper()); println!("end");}
