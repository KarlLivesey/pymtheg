macro_rules! m { ($e:expr) => { if let Some(_v) = $e { eprintln!("x"); } } }
fn helper() -> u8 { 1 }
fn run() { m!(Some(1)); helper(); }
fn main(){ run() }
