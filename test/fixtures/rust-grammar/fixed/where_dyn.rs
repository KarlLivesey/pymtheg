// edition 2024. Patch 0013: `where dyn Trait: Bound` (rustls server/hs.rs)
pub trait Selector {}
pub trait VersionSelector<T> {
    fn pick(&self) -> Option<T>;
}
pub fn choose(n: u8) -> u8 {
    n
}
pub fn select<T>(selector: &'static dyn Selector) -> u8
where
    dyn Selector: VersionSelector<T>,
{
    let _ = selector.pick();
    choose(1)
}
