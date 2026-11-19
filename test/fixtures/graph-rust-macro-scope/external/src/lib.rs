#![allow(dead_code)]

mod loader {
    tonic::include_proto!("pkg");

    fn uses_generated_type() -> Option {
        Option
    }
}

struct ConfigBuilder;

fn derived_builder() {
    #[derive(derive_builder::Builder)]
    struct Config {
        value: u8,
    }
    let _: Config = ConfigBuilder::default().value(1).build().unwrap();
}
