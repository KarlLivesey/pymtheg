fn helper()->i32{1}
fn main(){ println!("{}", { helper() }); println!("{}", if true { helper() } else { 0 }); }
