fn verbosity()->u8 { println!("verbosity"); 1 }
macro_rules! define { ($n:ident) => { macro_rules! $n { () => { verbosity() } } } }
define!(v);
fn main(){ println!("before"); let _ = v!(); }
