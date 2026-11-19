// Shape of fd's tests/tests.rs around line 2811.
mod testenv;

use std::io::Write;

use crate::testenv::TestEnv;

static DEFAULT_DIRS: &[&str] = &["one", "two"];
static DEFAULT_FILES: &[&str] = &["a.foo"];

#[test]
fn test_output() {
    let te = TestEnv::new(DEFAULT_DIRS, DEFAULT_FILES);
    te.assert_output(&["a.foo"], "");
    let output = te.assert_success_and_get_output(&["--print0"]);
    let mut sink = Vec::new();
    sink.write_all(&output.stdout).unwrap();
}
