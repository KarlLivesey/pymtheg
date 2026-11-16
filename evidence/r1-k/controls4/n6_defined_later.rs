fn helper() -> u8 { 1 }
fn main() { println!("{}", helper()); }
macro_rules! println { ($($t:tt)*) => {} }
