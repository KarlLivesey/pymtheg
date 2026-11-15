// edition 2024. Still rejected by the vendored grammar: attribute on a closure parameter
pub fn f() {
    let c = |#[allow(unused)] x: u8| ();
    c(1);
}
