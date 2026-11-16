#[macro_export] macro_rules! vec { ($($t:tt)*) => { 0 } }
pub mod prelude { pub use crate::vec; }
