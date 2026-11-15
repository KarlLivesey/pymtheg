// `#[cfg]` on struct-pattern fields (Vector config builder; quinn, hickory,
// redis, mongodb, async-task): in `let`, in a match arm, `field: pattern`,
// and in a function-parameter pattern.
pub struct Config {
    pub name: String,
    #[cfg(feature = "api")]
    pub api: u16,
    pub retries: u8,
}

pub enum Event {
    Open {
        id: u32,
        #[cfg(feature = "trace")]
        trace: u64,
    },
}

fn count(name: &str) -> usize {
    name.len()
}

pub fn summary(config: Config) -> usize {
    let Config {
        name,
        #[cfg(feature = "api")]
        api,
        retries,
    } = config;
    count(&name) + retries as usize
}

pub fn id(event: Event) -> u32 {
    match event {
        Event::Open {
            id,
            #[cfg(feature = "trace")]
                trace: _,
        } => id,
    }
}

pub fn retries(
    Config {
        retries,
        #[cfg(feature = "api")]
        api,
        ..
    }: Config,
) -> u8 {
    retries
}
