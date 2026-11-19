// edition 2024. Still rejected by the vendored grammar: a trait object with `+` on the left of a where predicate (`where dyn Sel + Send: Marker`; rustc's trivial-bounds-object.rs has `where dyn A + 'static: A`)
pub trait Sel {}
pub trait Marker {}
impl Marker for dyn Sel + Send {}
pub fn bounded() -> u8
where
    dyn Sel + Send: Marker,
{
    2
}
