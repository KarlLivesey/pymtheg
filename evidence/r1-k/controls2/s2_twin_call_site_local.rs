fn helper()->u8 { 1 }
macro_rules! m {()=>{println!("{}",helper());}}
fn main() { let helper=||2; let _ = helper(); m!(); }
