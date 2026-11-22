// Two globs in a chain (`use store::*` here, `pub use self::error::*` in
// `store`): `Result` is visible in `store` only, so it does not reach this
// module and `Result` here is the standard prelude's.
mod store;
use store::*;

pub fn g() -> Result<(), Error> {
    Ok(())
}
