#[macro_export] macro_rules! inner { () => {{}} }
#[macro_export(local_inner_macros)]
macro_rules! outer { () => { inner!(); } }
