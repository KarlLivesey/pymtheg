#[macro_export] macro_rules! inner { () => {{}} }
#[macro_export]
macro_rules! outer { () => { inner!(); } }
