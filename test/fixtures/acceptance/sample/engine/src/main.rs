mod discount;

fn main() {
    let price = discount::apply_discount(1000, 10);
    println!("{price}");
}
