mod outer {
    pub fn helper() -> i32 { 1 }
    fn local() -> i32 { 2 }
    macro_rules! gen { () => { mod g { pub fn run() -> i32 { super::helper() * 10 + self::local() } fn local() -> i32 { 3 } } } }
    pub mod site {
        pub fn helper() -> i32 { 4 }
        fn local() -> i32 { 5 }
        gen!();
        pub fn go() -> i32 { let _ = local(); g::run() }
    }
    pub fn x() -> i32 { local() + helper() }
}
fn main() { println!("{}", outer::site::go()); }
