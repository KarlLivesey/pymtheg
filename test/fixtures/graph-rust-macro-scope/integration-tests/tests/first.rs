#[macro_export]
macro_rules! helper {
    () => {};
}

mod common;
mod single_owner;

const _: fn() -> std::option::Option<u8> = common::selected;
const _: fn() -> std::option::Option<u8> = single_owner::selected;
