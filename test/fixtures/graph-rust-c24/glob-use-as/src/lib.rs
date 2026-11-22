// A `pub(super)` re-export behind a `pub` glob stays visible in `outer`
// only, so `String` in `user` is the standard prelude's, not `Real7`.
pub mod outer {
    pub struct Real7;
    mod child {
        pub(super) use super::Real7 as String;
    }
    pub use child::*;
}

pub mod user {
    use crate::outer::*;
    pub fn f() -> String {
        String::new()
    }
    pub fn g() -> Real7 {
        Real7
    }
}
