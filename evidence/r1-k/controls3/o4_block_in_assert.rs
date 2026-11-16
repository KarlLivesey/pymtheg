fn helper()->i32{1}
macro_rules! def{()=>{fn helper()->i32{2}}}
fn main(){ assert!({ def!(); helper() } == 2); println!("ok"); }
