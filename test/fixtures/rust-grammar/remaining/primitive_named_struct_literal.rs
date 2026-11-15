// edition 2024. Still rejected by the vendored grammar: struct literal of a type named like a primitive (`u128 { hi, lo }`, ring shape)
#[allow(non_camel_case_types)]
pub struct u128 { pub hi: u64, pub lo: u64 }
pub fn f() -> u128 { u128 { hi: 0, lo: 0 } }
