use super::A;
pub struct Thing;
impl Thing { pub fn new() -> Self { Thing } }
fn private() { self::local(); super::tree::branch(); }
fn local() {}
fn sibling(a: A) { super::tree::globbed(); a.own(); }
