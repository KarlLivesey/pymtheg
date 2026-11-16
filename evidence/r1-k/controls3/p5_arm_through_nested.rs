fn helper(){println!("called")}
macro_rules! n {()=>{helper();}}
macro_rules! m {()=>{ n!(); }; (x)=>{}}
fn main(){m!(x);println!("end");}
