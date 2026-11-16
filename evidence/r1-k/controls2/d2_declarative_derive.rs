#[macro_use] mod macros {
    macro_rules! Debug { derive() ($($t:tt)*) => { impl X { fn f() {} } }; }
}
#[derive(Debug)] struct X;
fn main(){}
