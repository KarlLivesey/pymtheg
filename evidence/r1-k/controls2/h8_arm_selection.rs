fn helper()->u8 { 1 }
fn other()->u8 { 2 }
macro_rules! m { (x) => { println!("{}", other()) }; ($($t:tt)*) => { println!($($t)*) } }
fn main(){ m!(x); m!("{}", helper()); }
