// edition 2015. Still rejected by the vendored grammar: `try!(…)` in an edition-2015 crate (autocfg, slog, vcpkg shape)
pub fn f(r: Result<u8, ()>) -> Result<u8, ()> {
    let x = try!(r);
    Ok(x)
}
