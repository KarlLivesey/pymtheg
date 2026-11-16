fn helper(x:u8){println!("{x}")}
macro_rules! n {($x:expr)=>{helper($x);}}
macro_rules! m {($x:expr)=>{n!($x);}}
fn main(){m!(1);println!("end");}
