fn helper(){println!("called")}
macro_rules! n {()=>{helper();}}
macro_rules! m {()=>{ macro_rules! g { () => { n!(); } } }}
m!();
fn main(){println!("end");}
