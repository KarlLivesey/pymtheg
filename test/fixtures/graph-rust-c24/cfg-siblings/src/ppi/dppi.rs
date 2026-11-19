use super::{ChannelNumber, Event, Task};

pub(crate) fn configure() {}

impl Event {
    fn reg_val(&self) -> u32 { 1 }
}
fn f(_: ChannelNumber, _: Task) {}
