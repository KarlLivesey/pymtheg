fn helper()->u8 {println!("CALLED");1}
macro_rules! println {($($t:tt)*)=>{}}
macro_rules! m {()=>{{println!("{}",helper());}}}
fn main(){m!();std::println!("end");}
