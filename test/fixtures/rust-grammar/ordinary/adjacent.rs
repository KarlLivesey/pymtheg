// edition 2024. Ordinary Rust next to each C-21 patch: these trees must not change.
use std::fmt::Display;

pub struct Pair<T> {
    pub a: T,
    pub b: T,
}
pub struct Wrap(pub u8);
pub enum Shape {
    Unit,
    Boxed(Box<Pair<u8>>),
    Named { side: u8 },
}

macro_rules! twice {
    ($e:expr) => {
        $e * 2
    };
}

// Macros with ordinary names, paths and primitive types inside token trees.
pub fn macros(x: u8) -> String {
    let n = twice!(x);
    let v: Vec<u8> = vec![n, 1u8];
    std::format!("{} {} {}", n, v.len(), stringify!(str u8 bool))
}

// Trait objects: trait first, lifetime after, several bounds, `impl 'a + T`.
pub fn objects<'a>(
    a: &'a dyn Display,
    b: Box<dyn Display + 'a>,
    c: Box<dyn Display + Send + Sync + 'a>,
    d: Box<dyn for<'b> Fn(&'b u8) -> u8 + 'a>,
) -> impl 'a + Display {
    let _ = (b, c, d);
    a.to_string()
}

// One attribute on a parameter; closures without attributes.
pub fn params(#[allow(unused_variables)] x: u8, y: &str) -> usize {
    let f = |a: u8, b| a as usize + b;
    let g = |(p, q): (u8, u8)| p + q;
    let h = move |Wrap(w)| w;
    f(x, y.len()) + g((1, 2)) as usize + h(Wrap(3)) as usize
}

// Patterns: tuple-struct turbofish, struct patterns, references, boxes as values.
pub fn patterns(s: Shape, p: Pair<u8>, r: &Wrap) -> u8 {
    let Pair { a, b } = p;
    let &Wrap(w) = r;
    let boxed = Box::new(a);
    let total = match s {
        Shape::Unit => 0,
        Shape::Boxed(inner) => inner.a,
        Shape::Named { side } => side,
    };
    let Some::<u8>(z) = Some(b) else { return 0 };
    total + w + *boxed + z
}

// Where clauses with the left-hand types upstream already reads.
pub fn bounds<T, U>(t: T, u: &U) -> usize
where
    T: Display + Clone,
    for<'a> &'a U: IntoIterator,
    [u8; 2]: Copy,
    u8: Into<u32>,
{
    let _ = t.clone();
    u.into_iter().count()
}

// Casts and comparisons next to primitive names.
pub fn casts(x: u32, y: u8) -> bool {
    let n = x as u8;
    let m = usize::from(y);
    (n as u32 <= x) && m < 10 && y as usize > 2
}
