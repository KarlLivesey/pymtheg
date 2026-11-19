// edition 2024. Patch 0010: a lifetime first in dyn bounds (turborepo-wax encode.rs, swc, dioxus desktop config.rs)
pub trait Code {
    fn code(&self) -> u8;
}
pub struct Diagnostic;
impl Code for Diagnostic {
    fn code(&self) -> u8 {
        7
    }
}
pub fn boxed<'a>(d: &'a Diagnostic) -> Box<dyn 'a + Code> {
    Box::new(Diagnostic)
}
pub type Handler = Box<dyn 'static + for<'a> FnMut(&'a Diagnostic) -> u8>;
pub fn run(d: &Diagnostic, mut h: Handler) -> u8 {
    boxed(d).code() + h(d)
}
