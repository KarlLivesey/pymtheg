#![allow(dead_code)]

// The receiver shape in turborepo-setup/src/go_discovery/tests.rs:195.
fn read(_: &[u8]) -> Option<Option<u8>> {
    Some(None)
}

type ReadResult<T> = core::result::Result<T, ()>;
fn write() -> ReadResult<u8> {
    Ok(3)
}

fn standard(text: &str, count: u32, borrowed: &Option<u8>) {
    let _: Option<u8> = read(&[]).unwrap();
    let _: u8 = write().unwrap();
    let _: bool = borrowed.is_some();
    let _: usize = text.len();
    let _: &[u8] = r"words".as_bytes();
    let _: bool = 'a'.is_alphabetic();
    let _: u32 = 2u32.pow(3);
    let _: [u8; 4] = count.to_le_bytes();
    let _: usize = text.parse().unwrap();
    let _: String = "words".to_string();
    let _: u32 = 1.max(2);
}

mod other_literals {
    trait ByteExt { fn is_alphabetic(self) -> bool; }
    impl ByteExt for u8 {
        fn is_alphabetic(self) -> bool { true }
    }
    fn check() {
        let _: usize = b"words".len();
        let _: usize = br"words".len();
        let _: *const core::ffi::c_char = c"words".as_ptr();
        let _: bool = b'a'.is_alphabetic();
    }
}

mod shadowed {
    struct MyOption<T>(T);
    impl<T> MyOption<T> {
        fn unwrap(self) -> T { self.0 }
    }
    type Option<T> = MyOption<T>;
    fn shadow(custom: Option<bool>) {
        let _: bool = custom.unwrap();
    }

    fn macro_shadow() {
        macro_rules! define {
            () => {
                struct Local;
                impl Local { fn len(&self) -> bool { true } }
                #[allow(non_camel_case_types)]
                type str = Local;
            };
        }
        define!();
        let changed: &str = &Local;
        let _: bool = changed.len();
    }
}

mod without_prelude {
    #![no_implicit_prelude]

    extern crate core;
    fn explicit(value: core::option::Option<u8>) {
        let _: u8 = value.unwrap();
        let _: usize = "core".len();
    }
}

struct Probe;
impl Probe {
    fn choose(&mut self) -> u32 { 0 }
    fn single(self) -> u32 { 0 }
    fn blanketed(&self) -> u32 { 0 }
}
trait Shared {
    fn choose(&self) -> bool;
}
impl Shared for Probe {
    fn choose(&self) -> bool { true }
}
trait Reference {
    fn single(self) -> bool;
}
impl Reference for &Probe {
    fn single(self) -> bool { true }
}
trait Blanket {
    fn blanketed(self) -> bool;
}
impl<T> Blanket for T {
    fn blanketed(self) -> bool { true }
}

mod dereference {
    struct Inner;
    impl Inner {
        fn selected(&self) -> u32 { 0 }
        fn earlier(&self) -> u32 { 0 }
    }
    struct Wrapper(Inner);
    impl core::ops::Deref for Wrapper {
        type Target = Inner;
        fn deref(&self) -> &Inner { &self.0 }
    }
    trait Local {
        fn selected(&self) -> bool;
        fn earlier(&self) -> bool;
    }
    impl Local for Inner {
        fn selected(&self) -> bool { false }
        fn earlier(&self) -> bool { false }
    }
    struct Other(Inner);
    impl core::ops::Deref for Other {
        type Target = Inner;
        fn deref(&self) -> &Inner { &self.0 }
    }
    impl Local for Other {
        fn selected(&self) -> bool { true }
        fn earlier(&self) -> bool { true }
    }
    fn check(wrapped: Wrapper, other: Other) {
        let _: u32 = wrapped.selected();
        let _: bool = other.earlier();
    }
}

mod traits {
    struct Local;
    trait First { fn choose(self) -> bool; }
    trait Second { fn choose(self) -> u32; }
    #[cfg(not(feature = "alternate"))]
    impl First for Local { fn choose(self) -> bool { true } }
    #[cfg(feature = "alternate")]
    impl Second for Local { fn choose(self) -> u32 { 0 } }
    fn check(switching: Local) {
        #[cfg(not(feature = "alternate"))]
        let _ = switching.choose();
        #[cfg(feature = "alternate")]
        let _ = switching.choose();
    }
}

mod standard_competes {
    trait Extension { fn len(self) -> bool; }
    impl<T> Extension for T {
        fn len(self) -> bool { true }
    }
    trait Mutable {
        fn is_some(self) -> u32;
    }
    impl Mutable for &mut Option<u8> {
        fn is_some(self) -> u32 { 0 }
    }
    fn check(option: Option<u8>, mutable: &mut Option<u8>) {
        let _: usize = "standard".len();
        let _: bool = option.len();
        let _: u32 = mutable.is_some();
    }
}

fn traps(mut probe: Probe, reference: &Probe, blanket: Probe) {
    let _borrow = &mut probe;
    let _: bool = probe.choose();
    let _: bool = reference.single();
    let _: bool = blanket.blanketed();
}
