pub fn leaf_rust() {}
pub fn mid_rust() { leaf_rust(); }
pub fn Shared() {}
pub struct Engine;
impl Engine { pub fn new() -> Self { Engine } pub fn step(&self) {} }
pub fn possible_caller() { let e = Engine::new(); e.step(); }
