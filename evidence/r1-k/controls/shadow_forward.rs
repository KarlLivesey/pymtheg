macro_rules! sh { ($($t:tt)*) => {{ fn helper() -> u8 { 2 } println!($($t)*) }} }
fn helper() -> u8 { 1 }
fn run() { sh!("{}", helper()); }
fn main(){ run() }
