// edition 2024. Still rejected by the vendored grammar: negative literal as a const generic argument (`RangedI8<-5, 5>`, time/deranged shape)
pub struct R<const A: i8, const B: i8>;
pub type H = R<-25, 25>;
pub fn f() -> R<-1, 1> { R::<-1, 1> }
