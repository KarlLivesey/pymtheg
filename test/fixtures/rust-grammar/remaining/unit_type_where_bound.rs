// edition 2024. Still rejected by the vendored grammar: where-clause on a non-path type `(): Trait<…>` (typenum/zerocopy shape)
pub trait Tr<T> {}
impl<T> Tr<T> for () {}
pub fn f<T>()
where
    (): Tr<T>,
{
}
