// Edition 2024 FFI: `unsafe extern` blocks (required in 2024), with
// `#[link]` on the block and variadic declarations.
use core::ffi::{c_char, c_int};

#[link(name = "c")]
unsafe extern "C" {
    pub fn printf(fmt: *const c_char, ...) -> c_int;
    pub fn strlen(s: *const c_char) -> usize;
    pub static mut errno: c_int;
}

#[cfg_attr(target_os = "linux", link(name = "m"))]
unsafe extern "C" {
    pub fn cos(x: f64) -> f64;
}

pub fn length(s: &core::ffi::CStr) -> usize {
    unsafe { strlen(s.as_ptr()) }
}

pub fn shout(s: &core::ffi::CStr) -> c_int {
    unsafe { printf(c"%s\n".as_ptr(), s.as_ptr()) }
}

pub fn cosine(x: f64) -> f64 {
    unsafe { cos(x) }
}
