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
