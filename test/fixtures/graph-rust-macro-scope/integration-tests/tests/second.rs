#[macro_export]
macro_rules! helper {
    () => { pub struct Option<T>(T); };
}

mod common;

const _: fn() -> common::Option<u8> = common::selected;
