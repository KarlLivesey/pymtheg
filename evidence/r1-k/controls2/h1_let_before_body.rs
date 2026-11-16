fn helper()->u8 { 1 }
macro_rules! m {()=>{{ let helper = || 2u8; println!("{}", helper()); }}}
fn main(){ m!(); }
