// edition 2024. Still rejected by the vendored grammar: two stacked attributes on one parameter (Vector rstest `#[files] #[exclude]` shape)
pub fn f(
    #[allow(unused_variables)]
    #[cfg(all())]
    x: u8,
) {}
