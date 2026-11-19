// edition 2024. Patch 0014: turbofish in a struct pattern (dioxus fullstack `let ErrorPayload::<serde_json::Value> { … }`)
pub struct Payload<T> {
    pub message: T,
    pub code: u16,
}
pub fn describe(code: u16) -> u16 {
    code + 1
}
pub fn f(p: Payload<u8>) -> u16 {
    let Payload::<u8> { message, code } = p;
    describe(code) + message as u16
}
