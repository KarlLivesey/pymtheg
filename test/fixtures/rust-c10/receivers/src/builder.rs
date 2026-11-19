// A `just`-style test builder whose methods take and return `Self`.
pub struct Test {
    args: Vec<String>,
    stdout: String,
}

pub struct Output {
    pub status: i32,
}

impl Output {
    pub fn failure(&self) -> bool {
        self.status != 0
    }
}

impl Test {
    pub fn new() -> Self {
        Test {
            args: Vec::new(),
            stdout: String::new(),
        }
    }
    pub fn arg(mut self, arg: &str) -> Self {
        self.args.push(arg.to_owned());
        self
    }
    pub fn stdout(mut self, stdout: &str) -> Self {
        self.stdout = stdout.to_owned();
        self
    }
    pub fn run(self) -> Output {
        Output {
            status: self.args.len() as i32,
        }
    }
}

pub fn chain() -> bool {
    Test::new().arg("--list").stdout("x").run().failure()
}
