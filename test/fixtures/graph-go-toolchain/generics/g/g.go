// Package g: one generic interface, two instantiations with different
// implementers.
package g

type Getter[T any] interface{ Get() T }

type IntImpl struct{}

func (IntImpl) Get() int { return 1 }

type StrImpl struct{}

func (StrImpl) Get() string { return "s" }

func UseInt(x Getter[int]) int { return x.Get() }

func UseStr(x Getter[string]) string { return x.Get() }

func Run() (int, string) { return UseInt(IntImpl{}), UseStr(StrImpl{}) }
