// edition 2024. Read since patch 0008: `safe fn` / `unsafe fn` / `safe static` in an unsafe extern block
unsafe extern "C" {
    pub safe fn abs(x: i32) -> i32;
    pub unsafe fn strlen(p: *const u8) -> usize;
    pub safe static errno: i32;
}
