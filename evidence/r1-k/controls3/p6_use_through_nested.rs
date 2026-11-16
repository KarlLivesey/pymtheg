fn helper()->u8 {1}
mod alt { #[macro_export] macro_rules! alt_print { ($($t:tt)*) => {{ fn helper()->u8 {2} std::println!($($t)*); }} } }
macro_rules! n {($($t:tt)*)=>{ println!($($t)*); }}
macro_rules! m {($($t:tt)*)=>{{ use crate::alt_print as println; n!($($t)*); }}}
fn main(){m!("{}",helper());}
