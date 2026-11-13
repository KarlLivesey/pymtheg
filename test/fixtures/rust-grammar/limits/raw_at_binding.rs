// edition 2024. Known regression from v0.24.x (read by npm 0.24.0, rejected now): `raw @ pattern` binding
pub fn f(x: u8) -> u8 {
    match x {
        raw @ (1 | 2) => raw,
        _ => 0,
    }
}
