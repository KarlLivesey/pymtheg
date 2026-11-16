fn helper() { println!("called"); }
macro_rules! m {()=>{{#[cfg(any())] helper();}}}
fn main(){m!(); println!("end");}
