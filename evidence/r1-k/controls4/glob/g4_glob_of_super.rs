mod outer {
    macro_rules! println { ($($t:tt)*) => {} }
    pub(crate) use println;
    pub mod inner { use super::*; pub fn go() { println!("x"); } }
}
fn main() { outer::inner::go(); }
