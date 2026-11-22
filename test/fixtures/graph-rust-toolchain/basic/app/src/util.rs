pub fn helper() {}

/// Builds a value with the function it is given.
pub fn make<T>(build: impl Fn(f64) -> T) -> T {
    build(2.0)
}
