#[macro_use] extern crate m;
fn helper() -> u8 { std::println!("CALLED"); 1 }
fn main() { println!("{}", helper()); std::println!("end"); }
