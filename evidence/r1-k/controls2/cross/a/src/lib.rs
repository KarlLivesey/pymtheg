pub fn f() -> &'static str { "a" }
#[macro_export] macro_rules! m { () => { println!("crate:{} dollar:{}", crate::f(), $crate::f()); } }
