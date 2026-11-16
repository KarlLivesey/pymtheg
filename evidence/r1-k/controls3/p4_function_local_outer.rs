fn helper()->u8 {1}
macro_rules! n {()=>{ helper() }}
fn main(){
    let helper = || 2u8; let _ = helper();
    macro_rules! m {()=>{ println!("{}", n!()) }}
    m!();
}
