// The shape of embassy-nrf `src/ppi/mod.rs` (embassy 41d7b34): two
// cfg-alternative files for one module, glob-imported back by the parent
// and each importing from it.
#[cfg_attr(feature = "_dppi", path = "dppi.rs")]
#[cfg_attr(feature = "_ppi", path = "ppi.rs")]
mod _version;

#[allow(unused_imports)]
pub(crate) use _version::*;

pub struct Event;
pub struct Task;
pub struct ChannelNumber;

pub fn use_it() {
    configure();
}
