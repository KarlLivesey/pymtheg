#[macro_use] mod macros {
    macro_rules! Debug { attr() ($($t:tt)*) => { $($t)* }; }
}
#[derive(Debug)] struct X;
fn main(){ println!("{:?}", X); }
