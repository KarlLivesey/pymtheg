// edition 2024. Still rejected by the vendored grammar: macro named like a primitive, `str![…]` (snapbox snapshots in winnow/toml_parser)
macro_rules! str {
    ($($t:tt)*) => { "" };
}
pub fn f() -> &'static str {
    str![[r#"
abc
"#]]
}
