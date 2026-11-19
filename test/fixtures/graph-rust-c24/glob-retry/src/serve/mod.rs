// The shape of dioxus `packages/dx/src/serve/mod.rs` (97adf79): the parent
// globs its children and a child imports from the parent.
mod runner;
mod server;
pub(crate) use runner::*;
pub(crate) use server::*;
