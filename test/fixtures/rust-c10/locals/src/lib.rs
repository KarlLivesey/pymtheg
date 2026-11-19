pub fn helper(x: u32) -> u32 {
    x
}

pub fn locals(input: u32) -> u32 {
    let total = input + 1;
    let total = helper(total);
    let check = |v: u32| v > total;
    if check(total) {
        return total;
    }
    match Some(total) {
        Some(found) => found,
        None => input,
    }
}

macro_rules! make {
    ($name:ident) => {
        let $name = 5u32;
    };
}

pub fn from_macro() -> u32 {
    make!(made);
    made
}

macro_rules! nothing {
    () => {};
}

pub fn after_macro() -> u32 {
    let kept = 2;
    nothing!();
    kept
}

pub fn gated() -> u32 {
    #[cfg(feature = "x")]
    let chosen = 1;
    #[cfg(not(feature = "x"))]
    let chosen = 2;
    chosen
}

pub struct Wrapper<T> {
    pub inner: T,
}

impl<T: Clone> Wrapper<T> {
    pub fn get(&self) -> T {
        self.inner.clone()
    }
}

pub const LIMIT: u32 = 3;

// Identifiers naming a constant or a unit variant are path patterns.
pub fn path_patterns(v: Option<u32>, n: u32) -> Option<u32> {
    let limited = match n {
        LIMIT => LIMIT,
        _ => 0,
    };
    match v {
        None => None,
        Some(x) => Some(x + limited),
    }
}

pub struct Counter;

impl Counter {
    pub fn me(&self) -> &Self {
        self
    }
}

pub fn ident<U>(value: U) -> U {
    value
}

pub struct V;

#[allow(non_camel_case_types)]
pub fn outer<V>(v: V) -> V {
    fn inner(x: crate::V) -> crate::V {
        x
    }
    let _ = inner(crate::V);
    v
}

pub fn sized<const N: usize>() -> [u8; N] {
    [0; N]
}

pub trait Source {
    type Item;
}

pub fn items<S: Source>(item: S::Item) -> S::Item {
    item
}

// A macro in pattern position may bind a name or none.
macro_rules! ignore {
    ($x:ident) => {
        _
    };
}

macro_rules! bind {
    ($x:ident) => {
        $x
    };
}

pub fn macro_patterns(v: u32, outer: u32) -> u32 {
    let first = match v {
        ignore!(outer) => outer,
    };
    let second = match v {
        bind!(inner) => inner,
    };
    first + second
}

// Generic parameters answer only their own namespace.
pub mod namespaces {
    pub struct T;

    #[allow(dead_code)]
    pub fn value_use<T>() -> crate::namespaces::T {
        T
    }

    pub struct N;

    #[allow(dead_code)]
    pub fn typ<const N: usize>() -> N {
        N {}
    }
}
