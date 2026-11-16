mod inner { use ext::prelude::*; pub fn go() -> Vec<u8> { vec![1] } }
fn main() { println!("{:?}", inner::go()); }
