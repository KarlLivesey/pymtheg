use super::AppServer;
impl WebServer {
    pub(crate) fn start(runner: &AppServer) -> Result<Self> {
        tracing::warn!("x");
        Ok(Self {})
    }
}
fn router(runner: &AppServer) {
    tracing::warn!("y");
}
// An item macro whose output is unknown (dioxus server.rs has several).
lazy_static::lazy_static! {
    static ref ROUTES: u8 = 0;
}
