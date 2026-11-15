// edition 2024. Patch 0008: the `safe` qualifier on items of an `unsafe
// extern` block (edition 2024 FFI), and `safe` as an ordinary identifier
// (parameter, field, local, function and macro names), which upstream PR #256
// would have broken by reserving the word.
use core::ffi::c_int;

unsafe extern "C" {
    pub safe fn abs(x: c_int) -> c_int;
    pub unsafe fn strlen(p: *const u8) -> usize;
    pub safe static timezone: c_int;
}

pub struct Options {
    pub safe: bool,
}

macro_rules! safe {
    ($e:expr) => {
        $e
    };
}

fn safe(x: c_int) -> c_int {
    safe!(x)
}

pub fn magnitude(x: c_int, safe: bool) -> c_int {
    let opts = Options { safe };
    if opts.safe { abs(x) } else { self::safe(x) }
}

pub fn zone() -> c_int {
    timezone
}
