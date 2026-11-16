fn helper()->u8 {std::println!("CALLED");1}
macro_rules! println {($($t:tt)*)=>{}}
macro_rules! m {($($t:tt)*)=>{{println!($($t)*);}}}
fn main(){m!("{}",helper());std::println!("end");}
