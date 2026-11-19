// edition 2024, nightly box_patterns. Patch 0012: box patterns (turborepo-cache multiplexer.rs, turborepo-lsp lib.rs)
#![feature(box_patterns)]
pub enum ApiError {
    CacheDisabled { status: u16 },
    Other,
}
pub enum CacheError {
    ApiClientError(Box<ApiError>, u8),
    Mismatch(Box<String>),
}
pub fn message() -> usize {
    0
}
pub fn report(n: usize) -> usize {
    n
}
pub fn handle(e: CacheError) -> usize {
    match e {
        CacheError::ApiClientError(box ApiError::CacheDisabled { .. }, ..) => report(1),
        CacheError::ApiClientError(box ApiError::Other, _) => message(),
        CacheError::Mismatch(box message) => report(message.len()),
    }
}
