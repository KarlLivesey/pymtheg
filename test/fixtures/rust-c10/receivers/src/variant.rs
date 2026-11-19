// A struct literal can name an imported struct-like variant.
pub enum E {
    V { x: u8 },
}

impl E {
    pub fn m(&self) -> u8 {
        1
    }
}

pub struct V {
    pub x: u8,
}

impl V {
    pub fn m(&self) -> u16 {
        2
    }
}

pub mod user {
    use super::E::V;

    // `V` here is `E::V`: rustc selects `E::m`, which returns `u8`.
    pub fn through_let() -> u8 {
        let e = V { x: 1 };
        e.m()
    }

    pub fn direct() -> u8 {
        V { x: 2 }.m()
    }

    // A path to the struct still types the literal.
    pub fn the_struct() -> u16 {
        let s = super::V { x: 3 };
        s.m()
    }
}

// A unit struct used as a value.
pub struct Unit;

impl Unit {
    pub fn size(&self) -> usize {
        4
    }
}

pub fn unit_value() -> usize {
    let a = Unit;
    a.size()
}

// A generic receiver type is not a library type.
pub fn generic_receiver<T: Clone>(t: T) -> T {
    let u = t;
    u.clone()
}
