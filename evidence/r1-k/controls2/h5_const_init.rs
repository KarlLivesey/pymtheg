fn helper()->u8 { 1 }
macro_rules! k {($e:expr)=>{{ const fn helper()->u8 { 3 } const X: u8 = $e; X }}}
fn main(){ println!("{}", k!(helper())); }
