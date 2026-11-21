#![allow(dead_code)]

mod impls {
    use std::ops::Range;

    trait Sealed {}
    trait KeyRange<K> {
        fn key(&self) -> &K;
    }

    // The generic impl headers follow redb's impl_key_range!.
    macro_rules! impl_key_range {
        ($range:ident) => {
            impl<K> Sealed for $range<K> {}

            impl<K> KeyRange<K> for $range<K> {
                fn key(&self) -> &K {
                    &self.start
                }
            }
        };
    }

    impl_key_range!(Range);

    fn outside() -> Option<u8> { None } // generic impls
}

mod tuple_impls {
    trait ServiceFactory {
        fn register(self);
    }

    // Actix Web's service_tuple! repeats the generic parameters and allows
    // their upper-case spellings as tuple bindings.
    macro_rules! service_tuple {
        ($($T:ident)+) => {
            impl<$($T: ServiceFactory),+> ServiceFactory for ($($T,)+) {
                #[inline]
                #[allow(non_snake_case)]
                fn register(self) {
                    let ($($T,)*) = self;
                    $($T.register();)+
                }

                #[cfg(any())]
                fn removed_by_cfg() {}
            }
        };
    }

    service_tuple! { A B }

    fn outside() -> Option<u8> { None } // tuple impl
}

mod named_sibling {
    struct Subject;
    macro_rules! generate {
        ($name:ident) => { impl Subject {} struct $name; };
    }
    generate!(Option);
    fn name() -> Option { Option } // named sibling
}

mod injected_header {
    struct Subject;
    macro_rules! generate {
        ($($header:tt)*) => { impl $($header)* {} };
    }
    generate!(Subject {} struct Option; impl Subject);
    fn name() -> Option { Option } // injected sibling
}

mod punctuation {
    trait Tag {}
    macro_rules! generate {
        ($($param:ident)+) => {
            impl<$($param: Copy)!*> Tag for ($($param,)+) {}
        };
    }
    generate!(T);
    fn outside() -> Option<u8> { None } // opaque separator
}

mod nested {
    struct Subject;
    trait Test { fn run(); }
    macro_rules! export {
        () => {
            #[macro_export]
            macro_rules! c34_exported {
                () => { struct Option; };
            }
        };
    }
    macro_rules! generate {
        ($ty:ident) => {
            impl Test for $ty {
                fn run() { export!(); }
            }
        };
    }
    generate!(Subject);
    fn outside() -> Option<u8> { None } // nested export
}

c34_exported!();
fn name() -> Option { Option } // exported macro
