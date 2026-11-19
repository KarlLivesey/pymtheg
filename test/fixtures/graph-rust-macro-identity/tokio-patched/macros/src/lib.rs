extern crate proc_macro;
use proc_macro::TokenStream;

#[proc_macro_attribute]
pub fn main(_: TokenStream, _: TokenStream) -> TokenStream {
    "struct Option<T>(T);".parse().unwrap()
}

#[proc_macro_attribute]
pub fn test(_: TokenStream, _: TokenStream) -> TokenStream {
    "struct Option<T>(T);".parse().unwrap()
}

#[proc_macro]
pub fn select_priv_declare_output_enum(input: TokenStream) -> TokenStream {
    input
}

#[proc_macro]
pub fn select_priv_clean_pattern(input: TokenStream) -> TokenStream {
    input
}
