pub mod builder;
pub mod db;
pub mod negative;

pub struct Inner {
    count: u32,
}

impl Inner {
    pub fn tick(&mut self) {
        self.count += 1;
    }
    pub fn peek(&self) -> u32 {
        self.count
    }
}

pub struct Outer {
    inner: Inner,
    pub label: Label,
}

pub struct Label(pub String);

impl Label {
    pub fn width(&self) -> usize {
        self.0.len()
    }
}

impl Outer {
    pub fn new() -> Self {
        Outer {
            inner: Inner { count: 0 },
            label: Label(String::new()),
        }
    }
    pub fn run(&mut self) -> u32 {
        self.inner.tick();
        self.inner.peek()
    }
    pub fn inner(&self) -> &Inner {
        &self.inner
    }
}

pub struct Client;

impl Client {
    pub async fn connect() -> Client {
        Client
    }
    pub fn ping(&self) -> bool {
        true
    }
}

pub async fn use_client() -> bool {
    let client = Client::connect().await;
    client.ping()
}

pub fn fields() -> usize {
    let mut outer = Outer::new();
    outer.run();
    let width = outer.label.width();
    width + outer.inner().peek() as usize
}

pub struct Config {
    pub name: String,
}

impl Config {
    pub fn load(&self) -> usize {
        self.name.len()
    }
}

pub fn make_config() -> Config {
    Config {
        name: String::new(),
    }
}

pub fn configs() -> usize {
    let literal = Config {
        name: String::from("a"),
    };
    let typed: Config = make_config();
    let text = literal.name.clone();
    literal.load() + typed.load() + text.len()
}
