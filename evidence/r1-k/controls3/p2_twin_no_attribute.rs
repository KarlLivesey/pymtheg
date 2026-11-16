fn helper(){println!("called")}
macro_rules! n {()=>{helper();}}
macro_rules! m {()=>{{ n!(); }}}
fn main(){m!();println!("end");}
