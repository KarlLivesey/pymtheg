macro_rules! log_it { ($($t:tt)*) => { eprintln!($($t)*); } }
fn helper() -> u8 { 1 }
fn run() { log_it!("{}", helper()); }
fn main(){ run() }
