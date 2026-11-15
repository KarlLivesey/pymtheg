// edition 2024. Still rejected by the vendored grammar: closure whose body is a range-to `|e| ..=e` (quickcheck shape)
pub fn f() -> impl Fn(u8) -> std::ops::RangeToInclusive<u8> {
    |end| ..=end
}
