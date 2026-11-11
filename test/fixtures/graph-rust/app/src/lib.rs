// café 😀 before declarations
mod flat;
mod tree;
#[path = "other.rs"]
mod renamed;
mod inline { pub fn inside() { self::local(); } fn local() {} }
use crate::{flat::{private, Thing as Alias}, tree::branch};
use crate::tree::*;
use helper::outside as foreign;
pub struct A;
pub struct B;
pub struct Wrap<T>(T);
pub enum Choice { One, Two(A) }
pub trait Speak { fn speak(&self) {} }
impl A { pub fn new() -> Self { A } pub fn own(&self) {} }
impl B { pub fn new() -> Self { B } }
impl Speak for A { fn speak(&self) {} }
impl Speak for B { fn speak(&self) {} }
impl<T> Wrap<T> { pub fn new(value: T) -> Self { Wrap(value) } }
type Renamed = A;
const COUNT: usize = 1;
static FLAG: bool = true;
macro_rules! local_macro { () => { private() }; }
fn generic<T>(value: T) -> T { value }
fn run(a: A, unknown: &dyn Speak) {
    private(); branch(); globbed(); foreign();
    A::new(); B::new(); Alias::new(); a.own(); unknown.speak();
    inline::inside(); renamed::special();
    local_macro!(); external_macro!(); std::mem::drop(a);
    generic::<A>(A);
    let private = || {};
    private();
}
#[cfg(test)]
mod tests { fn check() { super::run(super::A, &super::B); } }
mod left { pub fn collision() {} }
mod right { pub fn collision() {} }
use crate::left::*;
use crate::right::*;
fn ambiguous() { collision(); }
fn before_macro() { later!(); }
macro_rules! later { () => {}; }
