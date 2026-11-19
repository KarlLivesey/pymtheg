pub fn leaf_rust() {}
pub fn mid_rust() { leaf_rust(); }
pub fn Shared() {}
pub struct Engine;
impl Engine { pub fn new() -> Self { Engine } pub fn step(&self) {} }
pub fn possible_caller(v: Option<Engine>) { if let Some(e) = v { e.step(); } }
