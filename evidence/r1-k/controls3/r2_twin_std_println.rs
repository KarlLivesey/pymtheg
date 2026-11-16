fn helper()->u8 {println!("CALLED");1}
macro_rules! m {()=>{{println!("{}",helper());}}}
fn main(){m!();println!("end");}
