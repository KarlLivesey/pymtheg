// `&raw` where `raw` is an ordinary variable (Vector: 6 files). Since
// edition 2024 `&raw const x` / `&raw mut x` are raw borrows; `&raw` followed
// by anything else is a reference to a variable named `raw`.
pub struct Frame {
    pub len: usize,
}

fn checksum(bytes: &[u8]) -> u32 {
    bytes.iter().map(|b| *b as u32).sum()
}

pub fn decode(raw: Vec<u8>, offset: usize) -> u32 {
    let whole = checksum(&raw);
    let tail = checksum(&raw[offset..]);
    let r = &&raw;
    whole + tail + r.len() as u32
}

pub fn frame_len(raw: Frame) -> usize {
    let len = &raw.len;
    *len
}

pub fn text_len(raw: String) -> usize {
    let s: &str = &raw.as_str();
    s.len()
}

pub fn borrows() -> (*const u8, *mut u8) {
    let mut x = 1u8;
    (&raw const x, &raw mut x)
}
