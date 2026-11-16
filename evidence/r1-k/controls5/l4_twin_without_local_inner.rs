// Twin: without local_inner_macros the bare `inner!` is looked up at the call
// site, where app's `inner!` calls helper.
macro_rules! inner { () => { helper(); } }
fn helper() { std::println!("HELPER"); }
fn main() { m::outer!(); std::println!("END"); }
