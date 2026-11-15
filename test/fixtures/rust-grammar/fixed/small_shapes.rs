// The other shapes the patches close: a unit struct with a where clause
// (static-assert idiom, syn/darling), `~` in macro token trees (anyhow),
// `<=` after a cast to a named type (C-translated code), `_` in a unicode
// escape, and foreign types in a cfg'd-out extern block (wasm-bindgen input).
#![allow(non_camel_case_types)]

pub struct AssertSend
where
    u8: Send;

macro_rules! approx {
    ($a:ident ~ $b:ident) => {
        $a == $b
    };
}

pub type size_t = usize;

pub fn fits(a: u32, len: usize) -> bool {
    a as size_t <= len
}

pub fn same(a: u8, b: u8) -> bool {
    approx!(a ~ b)
}

pub const N: &str = "\u{4_e}";

#[cfg(any())]
unsafe extern "C" {
    pub type Opaque;
}
