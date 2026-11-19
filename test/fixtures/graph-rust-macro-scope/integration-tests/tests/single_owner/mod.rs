macro_rules! wrapper {
    () => { $crate::helper!(); };
}

wrapper!();

pub fn selected() -> Option<u8> { unreachable!() } // observed
