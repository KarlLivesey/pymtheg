// Shapes whose method target must not become definite.
use std::io::Read;

pub struct Celsius(pub f64);

impl Celsius {
    pub fn new() -> Celsius {
        Celsius(1.0)
    }
    // `Into::into` takes `self` by value and is found before this method.
    pub fn into(&self) -> f64 {
        self.0
    }
}

pub fn blanket() -> Celsius {
    let c = Celsius::new();
    let same: Celsius = c.into();
    same
}

pub struct Src;

impl Src {
    pub fn new() -> Src {
        Src
    }
    // `Read::bytes(self)` is in scope and found first.
    pub fn bytes(&self) -> usize {
        0
    }
    pub fn size(&self) -> usize {
        1
    }
}

impl Read for Src {
    fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
        Ok(0)
    }
}

pub fn imported() -> usize {
    let s = Src::new();
    let _proof: std::io::Bytes<Src> = s.bytes();
    let t = Src::new();
    t.size()
}

pub struct Meter;

pub trait Consume {
    fn measure(self) -> u64;
}

impl Consume for Meter {
    fn measure(self) -> u64 {
        2
    }
}

impl Meter {
    pub fn new() -> Meter {
        Meter
    }
    pub fn measure(&self) -> u32 {
        1
    }
}

pub fn checkout_trait() -> u64 {
    let m = Meter::new();
    // `Consume::measure(self)` is found before the `&self` inherent method.
    m.measure()
}

#[derive(Default)]
pub struct Other;

impl Other {
    pub fn new() -> Other {
        Other
    }
    pub fn other(&self) -> u32 {
        3
    }
}

pub fn shadowed() -> u32 {
    let m = Meter::new();
    let m = Other::new();
    m.other()
}

#[cfg(feature = "alt")]
pub fn make() -> Meter {
    Meter
}

#[cfg(not(feature = "alt"))]
pub fn make() -> Other {
    Other
}

pub fn configured() -> u32 {
    let made = make();
    made.other_or_measure()
}

pub trait Either {
    fn other_or_measure(&self) -> u32;
}

impl Either for Meter {
    fn other_or_measure(&self) -> u32 {
        1
    }
}

impl Either for Other {
    fn other_or_measure(&self) -> u32 {
        2
    }
}

pub fn generic<T: Default>() -> T {
    T::default()
}

pub fn generic_return() -> u32 {
    let g = generic::<Other>();
    let boxed = Box::new(Other::new());
    g.other() + boxed.other()
}
