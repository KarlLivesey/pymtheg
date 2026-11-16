// Imports named like std macros that bind no macro: a workspace fn, a
// workspace module, std modules. The std macros are still used (prints 1s).
mod util { pub fn write() -> u8 { 9 } }
mod formatting { pub fn f() {} }
mod site {
    use crate::util::write;
    use crate::formatting as format;
    use std::vec;
    use std::panic;
    fn helper() -> u8 { 1 }
    pub fn go() {
        use std::fmt::Write as _;
        let mut s = String::new(); let _ = write!(s, "{}", helper());
        let v = vec![helper()]; let f = format!("{}", helper());
        if v.is_empty() { panic!("{}", helper()); }
        format::f(); let _ = write(); let _ = panic::catch_unwind(|| ());
        println!("[{}] {:?} {}", s, v, f);
    }
}
fn main() { site::go(); }
