// edition 2024. Still rejected by the vendored grammar: `safe fn` / `unsafe fn` / `safe static` in an unsafe extern block
unsafe extern "C" {
    pub safe fn abs(x: i32) -> i32;
    pub unsafe fn strlen(p: *const u8) -> usize;
    pub safe static errno: i32;
}
