#![allow(dead_code)]

#[cfg(feature = "foreign")]
#[macro_use]
extern crate competing;

fn outside() -> u8 { 1 }

#[cfg(not(feature = "foreign"))]
fn inactive_import() -> u8 {
    #[derive(Debug)]
    struct Item;
    outside() // inactive macro-use
}

#[cfg(feature = "foreign")]
fn active_import() -> u8 {
    #[derive(Debug)]
    struct Item;
    outside() // active macro-use
}

#[no_implicit_prelude]
mod without_prelude {
    fn outside() -> u8 { 1 }

    pub(super) fn compiler_derive() -> u8 {
        macro_rules! Debug { () => {} }
        #[derive(Debug)]
        struct Item;
        outside() // language prelude
    }

    #[cfg(feature = "foreign")]
    pub(super) fn explicit_derive() -> u8 {
        extern crate competing;
        use competing::Debug;
        #[derive(Debug)]
        struct Item;
        outside() // explicit derive
    }
}

mod selectors {
    fn outside() -> u8 { 1 }

    #[cfg(not(feature = "foreign"))]
    pub(super) fn compiler_test() -> u8 {
        #[test]
        fn sample() {}
        outside() // builtin test
    }

    #[cfg(feature = "foreign")]
    pub(super) fn imported_test() -> u8 {
        use competing::foreign_test as test;
        #[test]
        fn sample() {}
        outside() // explicit test
    }

    #[rustfmt::skip]
    #[clippy::version]
    #[inline]
    #[allow(unused_variables)]
    #[must_use]
    fn inert_attributes() -> u8 { outside() }

    #[doc = "Metadata"]
    #[repr(C)]
    struct Layout { byte: u8 }
}

#[cfg(not(feature = "foreign"))]
#[no_implicit_prelude]
mod variant {
    fn outside() -> u8 { 1 }

    pub(super) fn call() -> u8 {
        #[derive(Debug)]
        struct Item;
        outside()
    }
}

#[cfg(feature = "foreign")]
mod variant {
    fn outside() -> u8 { 1 }

    pub(super) fn call() -> u8 {
        #[derive(Debug)]
        struct Item;
        outside() // active macro-use in the other declaration
    }
}

#[test]
fn compiler_selects_the_declared_bindings() {
    assert_eq!(without_prelude::compiler_derive(), 1);
    #[cfg(not(feature = "foreign"))]
    {
        assert_eq!(inactive_import(), 1);
        assert_eq!(selectors::compiler_test(), 1);
        assert_eq!(variant::call(), 1);
    }
    #[cfg(feature = "foreign")]
    {
        assert_eq!(active_import(), 2);
        assert_eq!(without_prelude::explicit_derive(), 2);
        assert_eq!(selectors::imported_test(), 2);
        assert_eq!(variant::call(), 2);
    }
}
