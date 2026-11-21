use proc_macro::TokenStream;

#[proc_macro_derive(Debug)]
pub fn debug(_: TokenStream) -> TokenStream {
    "fn outside() -> u8 { 2 }".parse().unwrap()
}

#[proc_macro_attribute]
pub fn foreign_test(_: TokenStream, mut item: TokenStream) -> TokenStream {
    item.extend("fn outside() -> u8 { 2 }".parse::<TokenStream>().unwrap());
    item
}
