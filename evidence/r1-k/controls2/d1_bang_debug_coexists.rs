#[macro_use] mod macros { macro_rules! Debug {()=>{7}} }
#[derive(Debug)] struct X;
fn main(){println!("{} {:?}",Debug!(),X);}
