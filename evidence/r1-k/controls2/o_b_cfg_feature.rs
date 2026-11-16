pub fn emit(s: &str) { println!("emit {s}"); }
macro_rules! trace { () => { #[cfg(feature = "trace")] $crate::emit("x"); } }
fn main() { trace!(); println!("end"); }
