// SPDX-License-Identifier: MIT
pub trait Shape {
    fn area(&self) -> f64;
}

pub struct Circle {
    r: f64,
}

impl Circle {
    pub fn new(r: f64) -> Self {
        Circle { r }
    }
    pub fn radius(&self) -> f64 {
        self.r
    }
    pub fn diameter(&self) -> f64 {
        2.0 * self.r
    }
}

impl Shape for Circle {
    fn area(&self) -> f64 {
        3.0 * self.r * self.r
    }
}

pub struct Square {
    s: f64,
}

impl Square {
    pub fn new(s: f64) -> Self {
        Square { s }
    }
    pub fn side(&self) -> f64 {
        self.s
    }
}

impl Shape for Square {
    fn area(&self) -> f64 {
        self.s * self.s
    }
}
