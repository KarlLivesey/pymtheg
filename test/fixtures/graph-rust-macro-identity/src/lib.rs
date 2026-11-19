#![allow(dead_code, unused_imports, unused_macros, non_snake_case)]
#![cfg_attr(feature = "no-std", no_std)]

#[cfg(feature = "no-std")]
mod core_prelude {
    #[derive(Debug)]
    struct Item;
    fn as_debug(item: Item) -> impl core::fmt::Debug { item }

    #[test]
    fn built_in_test() {}
}

mod separate_namespaces {
    struct Debug;
    fn test() {}
    macro_rules! Debug { () => {} }
    macro_rules! test { () => {} }

    #[derive(Debug)]
    struct Item;
    fn render(item: Item) -> impl core::fmt::Debug { item }

    #[test]
    fn built_in_test() {}
}

mod type_imports {
    mod export { pub struct Debug; }
    use export::Debug;
    #[derive(Debug)]
    struct Item;
    fn render(item: Item) -> impl core::fmt::Debug { item }
}

#[cfg(not(feature = "no-std"))]
mod std_reexport {
    use std::fmt::Debug;

    #[derive(Debug)]
    struct Item;
    fn render(item: Item) -> impl Debug { item }
}

mod explicit_derive {
    use facade::Debug;

    #[derive(Debug)]
    struct Item;
    fn from_external() -> FromDerive { FromDerive }
}

mod explicit_test {
    use facade::test;
    #[test]
    fn external_test() {}
    fn from_external() -> FromAttribute { FromAttribute }
}

mod qualified {
    mod example { pub struct Debug; }
    use example::*;

    fn nested() {
        #[derive(::facade::Debug)]
        struct Item;
        let _: Option<u8> = None;
        let _ = FromDerive;
    }
    #[facade::test]
    fn external_test() {}
    fn from_external() -> FromAttribute { FromAttribute }
}

mod tool_attribute {
    use super::separate_namespaces::*;
    macro_rules! bounded { () => { const OTHER: u8 = 0; } }
    bounded!();
    #[diagnostic::do_not_recommend]
    impl From<u8> for Local { fn from(_: u8) -> Self { Local } }
    #[rustfmt::skip]
    struct Local;
}

mod shadowed_tool_attribute {
    use facade as rustfmt;
    #[rustfmt::skip]
    fn external_test() {}
    fn from_external() -> FromAttribute { FromAttribute }
}

#[cfg(feature = "glob-derive")]
mod glob_derive {
    mod exports { pub use facade::Debug; }
    use exports::*;
    #[derive(Debug)]
    struct Item;
}

#[cfg(feature = "glob-test")]
mod glob_test {
    mod exports { pub use facade::test; }
    use exports::*;
    #[test]
    fn external_test() {}
}

#[cfg(feature = "glob-derive-attribute")]
mod glob_derive_attribute {
    mod exports { pub use facade::derive; }
    use exports::*;
    #[derive(Debug)]
    struct Item;
}

#[cfg(feature = "glob-tool")]
mod glob_tool {
    mod exports { pub use facade as rustfmt; }
    use exports::*;
    #[rustfmt::test]
    fn external_test() {}
    fn from_external() -> FromAttribute { FromAttribute }
}

#[cfg(feature = "glob-qualified")]
mod glob_qualified {
    mod exports {
        pub mod facade { pub use ::facade::Debug; }
    }
    use exports::*;
    #[derive(facade::Debug)]
    struct Item;
    fn from_external() -> FromDerive { FromDerive }
}

#[cfg(feature = "explicit-inline")]
mod explicit_inline {
    use facade::inline;
    #[inline]
    fn external_inline() {}
}

#[cfg(feature = "macro-use-test")]
#[macro_use(test)]
extern crate facade;

#[cfg(feature = "macro-use-test")]
mod macro_use_test {
    #[test]
    fn external_test() {}
    fn from_external() -> FromAttribute { FromAttribute }
}

#[cfg(feature = "macro-use-derive")]
#[macro_use(Debug)]
extern crate facade;

#[cfg(feature = "macro-use-derive")]
mod macro_use_derive {
    #[derive(Debug)]
    struct Item;
    fn from_external() -> FromDerive { FromDerive }
}

#[cfg(feature = "macro-use-bang")]
#[macro_use]
extern crate bangs;

#[cfg(feature = "expanded-rebinding")]
mod expanded_rebinding {
    macro_rules! rebind { () => { use facade::Debug; } }
    rebind!();
    #[derive(Debug)]
    struct Item;
}

#[cfg(feature = "expanded-macro-use")]
macro_rules! rebind { () => { #[macro_use] extern crate facade; } }

#[cfg(feature = "expanded-macro-use")]
rebind!();

#[cfg(feature = "no-prelude")]
#[no_implicit_prelude]
mod no_prelude {
    #[cfg(feature = "no-prelude-glob")]
    mod exports { pub use ::facade::{test, Debug}; }
    #[cfg(feature = "no-prelude-glob")]
    use self::exports::*;

    #[derive(Debug)]
    struct Item;
    #[test]
    fn built_in_test() {}

    #[cfg(feature = "no-prelude-glob")]
    fn external() -> (FromDerive, FromAttribute) { (FromDerive, FromAttribute) }
}
