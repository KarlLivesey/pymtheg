// Aliases that change the receiver's reference depth or default arguments.
pub struct A;

impl A {
    pub fn clone(&self) -> u8 {
        0
    }
    pub fn pick(&self) -> u8 {
        1
    }
}

pub type Ref<'a> = &'a A;

pub fn through_alias(x: Ref<'_>) -> u8 {
    // `x` is `&A`: the inherent `A::clone(&self)` is found first.
    let direct: u8 = x.clone();
    // `&x` is `&&A`: rustc selects `<&A as Clone>::clone`, returning `&A`.
    let doubled: &A = (&x).clone();
    direct + doubled.pick()
}

pub struct B;

impl B {
    pub fn pick(&self) -> u16 {
        2
    }
}

// The default `A` is the alias's own first parameter, not the struct `A`.
pub type R<A, T = A> = Result<T, A>;

pub fn make() -> R<B> {
    Ok(B)
}

pub fn default_names_parameter() -> Result<u16, B> {
    let picked: u16 = make()?.pick();
    Ok(picked)
}

#[derive(Debug)]
pub struct Error;

pub struct Config;

impl Config {
    pub fn get(&self) -> u32 {
        3
    }
}

// A plain default keeps working.
pub type Res<T, E = Error> = Result<T, E>;

pub fn load() -> Res<Config> {
    Ok(Config)
}

pub fn plain_default() -> Res<u32> {
    let value = load()?.get();
    Ok(value)
}
