fn helper()->u8 { 1 }
macro_rules! bind {()=>{fn helper()->u8 { 2 }}}
macro_rules! m {($($t:tt)*)=>{{
    bind!(); println!($($t)*); println!("{}",helper());
}}}
fn main(){m!("{}",helper());}
