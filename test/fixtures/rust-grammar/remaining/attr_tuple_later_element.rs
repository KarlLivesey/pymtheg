// edition 2024. Still rejected by the vendored grammar: attribute on a later element of a tuple expression (zerovec, sqlx `match (…)` shape)
pub fn f(v: Option<u8>) -> (u8, u8) {
    (
        1,
        #[allow(clippy::unwrap_used)]
        v.unwrap(),
    )
}
