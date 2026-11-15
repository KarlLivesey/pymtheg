// edition 2024. Still rejected by the vendored grammar: `impl A + for<'a> B<'a>`
pub trait B<'a> {}
impl<'a> B<'a> for u8 {}
pub fn f() -> impl Send + for<'a> B<'a> { 1u8 }
