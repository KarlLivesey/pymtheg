// edition 2024. Read since patch 0007 (was a v0.24.x regression): `raw @ pattern` binding
pub fn f(x: u8) -> u8 {
    match x {
        raw @ (1 | 2) => raw,
        _ => 0,
    }
}
