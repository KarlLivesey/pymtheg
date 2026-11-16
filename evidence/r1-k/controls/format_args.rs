struct S; impl S { fn name(&self) -> u8 { 1 } }
fn helper() -> u8 { 1 }
fn run(s: &S) {
    println!("{} {}", helper(), s.name());
    let _x = format!("{v}", v = crate::helper());
    assert_eq!(helper(), 1, "{}", helper());
    let _v = vec![helper(); 2];
}
fn main(){ run(&S) }
