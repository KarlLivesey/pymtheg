#[macro_export]
macro_rules! inner {
    () => { pub struct Option<T>(T); };
}

mod shared;

const _: fn() -> shared::Option<u8> = shared::selected;

fn main() {}
