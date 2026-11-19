#![allow(dead_code, unused_imports)]

use bitflags::bitflags;
use renamed::{Deserialize, Serialize};
mod other { pub struct Extra; }
use other::*;

bitflags! {
    #[derive(Clone, Copy)]
    pub struct Modes: u8 { const ACTIVE = 1; }
}

#[derive(Deserialize, Serialize)]
#[serde(crate = "renamed")]
struct Imported;

fn outside() -> Option<u8> { None }

fn nested() {
    #[derive(::renamed::Serialize)]
    #[serde(crate = "renamed")]
    struct Item;
    let _: Option<u8> = None;

    #[runtime::test(crate = "runtime")]
    async fn example() {}
}

mod explicit_test {
    use runtime::test;

    #[test(crate = "runtime")]
    async fn example() {}
}
