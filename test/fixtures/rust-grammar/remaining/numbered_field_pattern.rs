// edition 2024. Still rejected by the vendored grammar: a numbered field in a struct pattern (swc generated visitors `HexColor { 0: _field_0 }`)
pub struct Hex(pub u8);
pub fn f(h: Hex) -> u8 {
    let Hex { 0: value } = h;
    value
}
