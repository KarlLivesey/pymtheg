// Sol's program: rustc binds m::inner!, so app::helper is never called.
macro_rules! inner { () => { helper(); } }
fn helper() { std::println!("HELPER"); }
fn main() { m::outer!(); std::println!("END"); }
