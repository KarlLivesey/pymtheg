// edition 2024. Still rejected by the vendored grammar: trailing `+` in a where-clause bound
pub fn f<T>(_: T) where T: Copy + {}
