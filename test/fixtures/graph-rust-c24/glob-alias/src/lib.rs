// A glob re-export never widens an item: `Result` is `pub(super)` (visible
// in `api` only), so `user`'s glob of `api` does not import it and `Result`
// there is the standard prelude's. `Error` is `pub` and comes through.
pub mod api {
    mod error {
        pub struct Error;
        pub(super) type Result<T> = std::result::Result<T, Error>;
    }
    pub use error::*;
}

pub mod user {
    use crate::api::*;
    pub fn f() -> Result<u8, Error> {
        Ok(1)
    }
}
