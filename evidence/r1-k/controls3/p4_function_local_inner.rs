fn helper()->u8 {1}
macro_rules! m {()=>{ println!("{}", n!()) }}
fn main(){
    let helper = || 2u8;
    macro_rules! n {()=>{ helper() }}
    m!();
}
