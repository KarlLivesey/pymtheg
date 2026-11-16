// `$crate::name!` is a path at the defining crate's root.
mod m { #[macro_export] macro_rules! inner { () => { "ROOT" } } }
macro_rules! outer { () => { $crate::inner!() } }
mod n { macro_rules! inner { () => { "LOCAL" } } pub fn go() -> &'static str { outer!() } }
fn main() { println!("{}", n::go()); }
