#[macro_export]
macro_rules! inner {
    () => {};
}

mod shared;
mod single_owner;

const _: fn() -> std::option::Option<u8> = shared::selected;
const _: fn() -> std::option::Option<u8> = single_owner::selected;
