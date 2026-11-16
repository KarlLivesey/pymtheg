#[macro_export] macro_rules! quiet { ($($t:tt)*) => {} }
#[macro_export(local_inner_macros)]
macro_rules! outer { ($($t:tt)*) => { quiet!($($t)*); } }
