//! Calls that need types the source-only route does not infer, a derive
//! from a proc macro and code a build script generates.
pub mod shapes;
mod util;

use shapes::{Circle, Shape, Square};

include!(concat!(env!("OUT_DIR"), "/generated.rs"));

#[derive(macros::Hello)]
pub struct Greeter;

pub fn run() -> f64 {
    util::helper();
    let greeting = Greeter.hello();
    let _ = (greeting, generated());
    // Closure parameters typed through the standard library's iterators.
    let circles = vec![Circle::new(1.0), Circle::new(2.0)];
    let total: f64 = circles.iter().map(|c| c.area()).sum();
    let largest = circles
        .into_iter()
        .max_by(|a, b| a.radius().total_cmp(&b.radius()))
        .map(|c| c.diameter());
    // A value whose type comes from a generic function's return.
    let square = util::make(Square::new);
    let side = square.side();
    // Dispatch on a trait object: one declaration, many impls.
    let shapes: Vec<Box<dyn Shape>> = vec![Box::new(Circle::new(3.0))];
    let sum: f64 = shapes.iter().map(|s| s.area()).sum();
    total + largest.unwrap_or(0.0) + side + sum
}

#[cfg(has_generated)]
pub fn conditional() -> u32 {
    generated()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs() {
        assert!(run() > 0.0);
        assert_eq!(conditional(), 7);
    }
}
