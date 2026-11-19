#![allow(dead_code)]

mod entry_point {
    #[runtime::main(crate = "runtime", flavor = "current_thread")]
    async fn entry() {}

    fn sibling() -> Option<u8> { Option(1) } // main by path
}

mod test_runner {
    use runtime::test;

    #[test(crate = "runtime")]
    async fn run() {}

    fn sibling() -> Option<u8> { Option(1) } // test by import
}

mod qualified_test {
    #[runtime::test(crate = "runtime")]
    async fn run() {}

    fn sibling() -> Option<u8> { Option(1) } // test by path
}
