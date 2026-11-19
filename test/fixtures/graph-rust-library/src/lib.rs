#![allow(dead_code)]

mod actix_shape {
    use std::path::{Path, PathBuf};

    // From the SW-3 Actix audit: the receiver's type is not the method owner.
    pub fn receiver(path: &Path) -> PathBuf {
        path.into()
    }

    trait IntoPath {
        fn into(path: &Self) -> PathBuf;
    }

    impl IntoPath for Path {
        fn into(path: &Self) -> PathBuf {
            path.to_path_buf()
        }
    }

    pub fn select(path: &std::path::Path) -> std::path::PathBuf {
        std::path::Path::into(path)
    }
}

mod keccak_shape {
    // State1600 is an array alias. `iter` belongs to the slice.
    pub fn receiver(state: &keccak::State1600) -> std::slice::Iter<'_, u64> {
        state.iter()
    }

    trait StateIterator {
        fn iter(state: &Self) -> std::slice::Iter<'_, u64>;
    }

    impl StateIterator for keccak::State1600 {
        fn iter(state: &Self) -> std::slice::Iter<'_, u64> {
            state.as_slice().iter()
        }
    }

    pub fn select(state: &keccak::State1600) -> std::slice::Iter<'_, u64> {
        keccak::State1600::iter(state)
    }
}

mod helix_shape {
    use ropey::RopeSlice;

    // Helix extends RopeSlice with methods in a checkout trait.
    trait RopeSliceExt {
        fn starts_with(self, expected: char) -> bool;
    }

    impl RopeSliceExt for RopeSlice<'_> {
        fn starts_with(self, expected: char) -> bool {
            self.chars().next() == Some(expected)
        }
    }

    pub fn select(slice: RopeSlice<'_>) -> bool {
        RopeSlice::starts_with(slice, 'a')
    }
}

mod error_shape {
    use thiserror::Error;

    #[derive(Debug, Error)]
    pub enum Error {
        #[error("missing")]
        Missing,
    }

    pub fn select() -> Error {
        Error::Missing
    }
}

mod competing_import {
    use std::env::var as query;

    pub fn select() -> Result<String, std::env::VarError> {
        #[allow(unused_imports)]
        use thiserror::Error as query;
        query("HOME")
    }
}
