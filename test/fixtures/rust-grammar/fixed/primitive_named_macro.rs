// edition 2024. Patch 0009: a macro named like a primitive, `str![…]` (snapbox snapshots: mdBook and clap tests), and `str<…>` as a type path in macro input
macro_rules! str {
    ($($t:tt)*) => {
        ""
    };
}
macro_rules! keep {
    ($($t:tt)*) => {};
}
pub fn expected() -> &'static str {
    str![[r#"
abc
"#]]
}
pub fn check(actual: &str) -> bool {
    actual == expected() && str!["x"].is_empty()
}
keep! {
    fn create_element_top(tag: &str<u8, el>) {}
}
