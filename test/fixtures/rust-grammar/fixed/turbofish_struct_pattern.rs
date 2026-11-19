// edition 2024. Patch 0014: turbofish in a struct pattern (dioxus fullstack `let ErrorPayload::<serde_json::Value> { … }`), also behind a path
pub struct Payload<T> {
    pub message: T,
    pub code: u16,
}
pub mod inner {
    pub struct S<T> {
        pub x: T,
    }
    pub struct W<T>(pub T);
}
pub enum E<T> {
    V { a: T },
}
pub enum En<T> {
    W(T),
}
pub fn describe(code: u16) -> u16 {
    code + 1
}
pub fn f(p: Payload<u8>) -> u16 {
    let Payload::<u8> { message, code } = p;
    describe(code) + message as u16
}
pub fn g(s: inner::S<u32>, e: E<u32>, w: inner::W<u32>) -> u32 {
    let inner::S::<u32> { x } = s;
    let E::V::<u32> { a } = e;
    let inner::W::<u32>(b) = w;
    let En::W::<u32>(c) = En::W(1);
    x + a + b + c
}
