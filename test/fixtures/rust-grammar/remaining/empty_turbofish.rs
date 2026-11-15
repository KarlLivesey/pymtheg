// edition 2024. Still rejected by the vendored grammar: empty turbofish `f::<>()` (lalrpop-generated parsers)
fn g() -> u8 { 1 }
pub fn f() -> u8 { g::<>() }
