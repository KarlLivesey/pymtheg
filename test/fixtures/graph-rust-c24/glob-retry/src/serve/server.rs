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
