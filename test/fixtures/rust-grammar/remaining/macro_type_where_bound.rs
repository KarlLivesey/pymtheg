// edition 2024. Still rejected by the vendored grammar: macro call in where-clause type position `mac!(Self): Send`
macro_rules! mac { ($t:ty) => { $t }; }
pub trait Tr where mac!(Self): Send {}
