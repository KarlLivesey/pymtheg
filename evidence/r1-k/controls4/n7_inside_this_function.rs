fn helper() -> u8 { std::println!("CALLED"); 1 }
fn main() { macro_rules! println { ($($t:tt)*) => {} } println!("{}", helper()); std::println!("end"); }
