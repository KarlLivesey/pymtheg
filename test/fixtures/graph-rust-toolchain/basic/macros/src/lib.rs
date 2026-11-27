//! A proc-macro crate with no dependencies: rust-analyzer runs it.
use proc_macro::TokenStream;

/// Adds `fn hello(&self) -> &'static str` to the type it derives on.
#[proc_macro_derive(Hello)]
pub fn derive_hello(input: TokenStream) -> TokenStream {
    let text = input.to_string();
    let name = text
        .split_whitespace()
        .skip_while(|word| *word != "struct")
        .nth(1)
        .unwrap_or(helper_name())
        .trim_end_matches(';')
        .to_string();
    format!("impl {name} {{ pub fn hello(&self) -> &'static str {{ \"hello\" }} }}")
        .parse()
        .unwrap()
}

/// A helper the macro crate keeps to itself (a proc-macro crate exports only macros).
fn helper_name() -> &'static str {
    "macros"
}
