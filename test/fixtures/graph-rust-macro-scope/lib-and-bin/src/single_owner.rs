macro_rules! wrapper {
    () => { $crate::inner!(); };
}

wrapper!();

pub fn selected() -> Option<u8> { unreachable!() } // observed
