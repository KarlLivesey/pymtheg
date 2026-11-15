// edition 2024. Still rejected by the vendored grammar: empty bound list `where T: ,` (combine/bon shape)
pub fn f<T>(_: T)
where
    T:,
{
}
