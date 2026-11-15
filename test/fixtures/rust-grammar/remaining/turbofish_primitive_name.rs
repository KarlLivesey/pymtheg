// edition 2024. Still rejected by the vendored grammar: turbofish on a function named like a primitive (`char::<_, E>`)
pub fn char<T, E>(t: T) -> Result<T, E> { Ok(t) }
pub fn f() -> Result<u8, ()> {
    char::<_, ()>(1u8)
}
