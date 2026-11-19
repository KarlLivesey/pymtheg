// Shape of fd's tests/testenv/mod.rs.
use std::path::PathBuf;
use std::process;

pub struct TestEnv {
    root: PathBuf,
}

impl TestEnv {
    pub fn new(directories: &[&str], files: &[&str]) -> TestEnv {
        let mut root = PathBuf::from("/tmp");
        root.push(directories.len().to_string());
        root.push(files.len().to_string());
        TestEnv { root }
    }

    pub fn assert_success_and_get_output(&self, args: &[&str]) -> process::Output {
        process::Command::new("true")
            .current_dir(&self.root)
            .args(args)
            .output()
            .expect("command")
    }

    pub fn assert_output(&self, args: &[&str], expected: &str) {
        let output = self.assert_success_and_get_output(args);
        assert_eq!(String::from_utf8_lossy(&output.stdout), expected);
    }
}
