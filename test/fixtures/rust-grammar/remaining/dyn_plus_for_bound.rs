// edition 2024. Still rejected by the vendored grammar: `dyn A + for<'a> B<'a>`
pub trait B<'a> {}
pub fn f(_: &(dyn Send + for<'a> B<'a>)) {}
