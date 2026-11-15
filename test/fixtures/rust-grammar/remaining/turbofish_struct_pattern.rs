// edition 2024. Still rejected by the vendored grammar: turbofish in a struct pattern (`let Range::<T> { start, end } = r`, serde_with shape)
use std::ops::Range;
pub fn f(r: Range<u8>) -> u8 {
    let Range::<u8> { start, end } = r;
    start + end
}
