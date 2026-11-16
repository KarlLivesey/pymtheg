use std::fmt::Write as _;
fn helper() -> u8 { println!("CALLED"); 1 }
macro_rules! write { ($($t:tt)*) => { Ok::<(), std::fmt::Error>(()) } }
fn main() { let mut s = String::new(); let _ = write!(s, "{}", helper()); println!("end [{}]", s); }
