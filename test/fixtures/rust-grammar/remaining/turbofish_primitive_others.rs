// edition 2024. Still rejected by the vendored grammar: turbofish on `u8::<T>()` / `str::<T>()` named fns (other primitive names)
#[allow(non_snake_case)]
pub fn u8<T: Default>() -> T { T::default() }
pub fn str<T: Default>() -> T { T::default() }
pub fn f() -> (i32, i64) {
    (u8::<i32>(), str::<i64>())
}
