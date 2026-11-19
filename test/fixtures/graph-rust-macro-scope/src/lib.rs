#![allow(dead_code)]

fn outside() -> u8 { 0 }

macro_rules! item { ($name:ident) => { struct $name; }; }
macro_rules! forwarded { ($name:ident) => { item!($name); }; }
macro_rules! literal { () => { fn outside() -> bool { true } }; }

fn unrelated() {
    forwarded!(Other);
    let _: u8 = outside(); // unrelated checkout
    let _: Option<u8> = None; // unrelated library
}

fn generated_type() {
    forwarded!(Option);
    let _: Option = Option; // generated type
}

fn generated_function() {
    literal!();
    let _: bool = outside(); // generated function
}

fn generated_keyword() {
    macro_rules! item_with_keyword { ($keyword:ident) => { $keyword Option; }; }
    item_with_keyword!(struct);
    let _: Option = Option; // generated keyword
}

fn omitted_repetition() {
    macro_rules! optional_name { ($($name:ident)?) => { struct $($name)? Option; }; }
    optional_name!();
    let _: Option = Option; // omitted repetition
}

fn foreign_expansion() {
    macro_rules! foreign_function { () => { fn outside() -> bool; }; }
    macro_rules! foreign_block { () => { unsafe extern "C" { foreign_function!(); } }; }
    foreign_block!();
    let _: bool = unsafe { outside() }; // foreign declaration
}

mod absolute_include {
    macro_rules! load {
        () => { ::core::include!("option.rs"); };
    }
    load!();
    fn use_generated_type() -> Option { Option } // absolute include
}

static LAZY: u8 = 0;

fn absolute_thread_local() {
    macro_rules! wrap {
        ($name:ident) => { ::std::thread_local! { static $name: u8 = 0; } };
    }
    wrap!(LAZY);
    let _: &::std::thread::LocalKey<u8> = &LAZY; // wrapped thread-local
    let _: Option<u8> = None; // unrelated thread-local
}

fn direct_thread_local() {
    ::std::thread_local! { static LAZY: u8 = 0; }
    let _: &::std::thread::LocalKey<u8> = &LAZY; // direct thread-local
    let _: Option<u8> = None; // unrelated direct
}

#[macro_export]
macro_rules! scoped_item {
    ($name:ident) => { struct $name; };
}

fn dollar_crate() {
    macro_rules! wrap {
        () => { $crate::scoped_item!(Other); };
    }
    wrap!();
    let _: Option<u8> = None; // explicit defining crate
}

fn empty_loader() {
    macro_rules! load {
        () => { struct Option; };
    }
    load!();
    let _: Option = Option;
}
