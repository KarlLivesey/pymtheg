fn helper() -> u8 { 1 }
fn other() { macro_rules! println { ($($t:tt)*) => {} } println!("x"); }
fn main() { other(); println!("{}", helper()); }
