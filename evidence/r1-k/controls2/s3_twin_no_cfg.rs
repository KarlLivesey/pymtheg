fn helper() { println!("called"); }
macro_rules! m {()=>{{ helper(); }}}
fn main(){m!();}
