package g

type Runner interface { Run() }
type A struct{}
type B struct{}
func (A) Run() {}
func (B) Run() {}
func LeafGo() {}
func MidGo() { LeafGo() }
func TopGo() { MidGo() }
func DispatchGo(r Runner) { r.Run() }
func UnknownGo(callback func()) { callback() }
func Shared() {}
