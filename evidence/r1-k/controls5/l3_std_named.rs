// A bare `println!` in a local_inner_macros transcriber is $crate::println!
// (m's own, which drops the tokens), not the standard macro.
fn helper() -> u8 { std::println!("HELPER"); 1 }
fn main() { m::outer!("{}", helper()); std::println!("END"); }
