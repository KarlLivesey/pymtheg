// edition 2024. Patch 0011: attributes on closure parameters (turborepo api-client, tauri file-associations); the attribute's names bind nothing
pub struct Client;
impl Client {
    pub fn native(&self) -> u8 {
        1
    }
}
pub fn unused_variables() -> u8 {
    2
}
pub fn build(client: Client) -> u8 {
    let make = |#[allow(unused_variables)] use_native: bool, redirects: u8| {
        unused_variables() + redirects
    };
    let typed = |#[allow(unused)] #[cfg(all())] c: Client| c.native();
    make(true, 3) + typed(client)
}
