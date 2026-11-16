pub fn apply_discount(cents: u64, percent: u64) -> u64 {
    cents - percent_of(cents, percent)
}

fn percent_of(cents: u64, percent: u64) -> u64 {
    cents * percent / 100
}
