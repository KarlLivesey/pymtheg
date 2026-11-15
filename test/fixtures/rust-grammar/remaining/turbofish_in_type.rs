// edition 2024. Still rejected by the vendored grammar: turbofish inside a type (`Option<NonNull::<u8>>`, `-> HashMap::<K, V>`)
use std::collections::HashMap;
use std::ptr::NonNull;
pub fn f() -> Option<NonNull::<u8>> { None }
pub fn g() -> HashMap::<u8, u8> { HashMap::new() }
