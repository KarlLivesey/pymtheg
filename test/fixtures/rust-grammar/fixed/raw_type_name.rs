// edition 2024. Read since patch 0007 (was a v0.24.x regression): `raw` as a type name (`Option<raw>`, `parse::<raw>()`; syn custom-keyword shape)
#[allow(non_camel_case_types)]
#[derive(Default)]
pub struct raw;
pub fn p<T: Default>() -> T { T::default() }
pub fn f() -> Option<raw> {
    let _x = p::<raw>();
    None
}
