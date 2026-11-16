fn helper()->u8 { 1 }
macro_rules! note {()=>{ eprintln!("note"); }}
macro_rules! m {($($t:tt)*)=>{{
    note!(); println!($($t)*); println!("{}",helper());
}}}
fn main(){m!("{}",helper());}
