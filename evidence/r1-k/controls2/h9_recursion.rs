fn helper()->u8 { 1 }
macro_rules! r { () => {}; ($h:tt $($t:tt)*) => { r!($($t)*) } }
fn main(){ r!(helper()); println!("no call"); }
