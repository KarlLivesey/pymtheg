// Forwarding: the bare `quiet!` is m::quiet!, which drops the tokens; the
// call-site `quiet!` that would evaluate them is never used.
macro_rules! quiet { ($($t:tt)*) => { std::println!($($t)*); } }
fn helper() -> u8 { std::println!("HELPER"); 1 }
fn main() { m::outer!("{}", helper()); std::println!("END"); }
