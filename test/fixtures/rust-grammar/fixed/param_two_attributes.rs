// edition 2024. Patch 0011: two stacked attributes on one parameter (alacritty display/window.rs `#[rustfmt::skip] #[cfg(…)]`, Vector rstest `#[files] #[exclude]`)
pub struct Visual {
    pub depth: u8,
}
pub fn depth_of(v: &Visual) -> u8 {
    v.depth
}
pub fn f(
    #[rustfmt::skip]
    #[cfg(all())]
    visual: Visual,
    #[allow(unused_variables)] #[allow(unused_mut)] mut extra: u8,
) -> u8 {
    depth_of(&visual) + extra
}
