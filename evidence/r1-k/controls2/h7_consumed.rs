fn helper()->u8 { println!("called"); 1 }
macro_rules! s {($($t:tt)*)=>{ stringify!($($t)*) }}
macro_rules! c {($($t:tt)*)=>{ concat!("x") }}
fn main(){ println!("{} {}", s!(helper()), c!(helper())); if cfg!(any()) { helper(); } }
