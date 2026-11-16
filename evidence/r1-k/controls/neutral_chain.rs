#[macro_use]
mod messages {
macro_rules! eprintln_locked {
    ($($tt:tt)*) => {{
        {
            use std::io::Write;
            let mut stderr = std::io::stderr().lock();
            if let Err(err) = writeln!(stderr, $($tt)*) {
                if err.kind() == std::io::ErrorKind::BrokenPipe { std::process::exit(0); }
            }
        }
    }}
}
macro_rules! message {
    ($($tt:tt)*) => { if crate::messages::messages() { eprintln_locked!($($tt)*); } }
}
macro_rules! err_message {
    ($($tt:tt)*) => { crate::messages::set_errored(); message!($($tt)*); }
}
pub(crate) fn messages() -> bool { true }
pub(crate) fn set_errored() {}
}
fn eprint_nothing_searched() {}
fn search() -> u8 { err_message!("{}", 1); eprint_nothing_searched(); 0 }
fn main(){ search(); }
