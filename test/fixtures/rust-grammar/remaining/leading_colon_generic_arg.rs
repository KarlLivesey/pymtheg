// edition 2024. Still rejected by the vendored grammar: generic argument starting with `::` (`Result::<::std::vec::Vec<u8>, ()>`, aws-sdk shape)
pub fn f() -> Result<Vec<u8>, ()> {
    Result::<::std::vec::Vec::<u8>, ()>::Ok(vec![])
}
