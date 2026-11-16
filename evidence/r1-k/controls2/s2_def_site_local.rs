fn helper()->u8 { 1 }
fn main() {
    let helper=||2;
    macro_rules! m {()=>{println!("{}",helper());}}
    m!();
}
