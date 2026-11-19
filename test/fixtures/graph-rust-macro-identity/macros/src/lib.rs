#![allow(non_snake_case)]
extern crate proc_macro;
use proc_macro::TokenStream;

#[proc_macro_derive(Debug)]
pub fn derive_debug(_: TokenStream) -> TokenStream {
    "struct FromDerive;".parse().unwrap()
}

#[proc_macro_attribute]
pub fn test(_: TokenStream, item: TokenStream) -> TokenStream {
    let mut result = item;
    result.extend("struct FromAttribute;".parse::<TokenStream>().unwrap());
    result
}

#[proc_macro_attribute]
pub fn inline(_: TokenStream, item: TokenStream) -> TokenStream {
    test(TokenStream::new(), item)
}

#[proc_macro_attribute]
pub fn derive(_: TokenStream, item: TokenStream) -> TokenStream {
    test(TokenStream::new(), item)
}

#[proc_macro_attribute]
pub fn skip(_: TokenStream, item: TokenStream) -> TokenStream {
    test(TokenStream::new(), item)
}
