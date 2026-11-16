fn helper()->u8 { println!("called"); 1 }
fn main(){ #[cfg(any())] println!("{}", helper()); println!("end"); }
