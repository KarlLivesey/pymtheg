mod explicit {
    use std::collections::HashMap;

    macro_rules! items {
        () => { fn unrelated() {} };
    }
    items!();

    #[cfg(feature = "conflict")]
    macro_rules! conflict {
        () => { struct HashMap; };
    }
    #[cfg(feature = "conflict")]
    conflict!();

    pub fn accept(_: HashMap<String, String>) {}
}

#[cfg(feature = "prefix-conflict")]
mod prefix {
    macro_rules! items {
        () => { mod std { pub mod collections { pub struct HashMap<K, V>(K, V); } } };
    }
    items!();
    use std::collections::HashMap;
    fn accept(_: HashMap<(), ()>) {}
}

fn main() {
    explicit::accept(std::collections::HashMap::new());
}
