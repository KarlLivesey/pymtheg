#[macro_export] macro_rules! println { ($($t:tt)*) => {} }
#[macro_export(local_inner_macros)]
macro_rules! outer { ($($t:tt)*) => { println!($($t)*); } }
