macro_rules! m { () => { fn helper() -> u8 { 2 } } }
fn helper() -> u8 { 1 }
fn run() -> u8 { m!(); helper() }
fn main(){ println!("{}", run()) }
