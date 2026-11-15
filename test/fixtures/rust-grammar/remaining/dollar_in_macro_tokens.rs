// edition 2024. Still rejected by the vendored grammar: lone `$` and `$ name` with a space inside macro_rules (syn token.rs, icu, cfg_aliases shape)
macro_rules! dollar {
    [$] => { 1 };
}
macro_rules! spaced {
    ($ name : ty) => { 2 };
}
pub fn f() -> u8 { dollar!($) + spaced!(u8) }
