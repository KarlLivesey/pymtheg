export function LeafTs() {}
export function MidTs() { LeafTs(); }
export function Shared() {}
export function UnknownTs(callback: () => void) { callback(); }
