// Package p: RC is implemented by full, and (only in the test binary) by an
// unnamed struct of r and c written in p_test.go.
package p

type RC interface {
	R()
	C()
}

type r struct{}

func (r) R() {}

type c struct{}

func (c) C() {}

type full struct{}

func (full) R() {}
func (full) C() {}

func Use(x RC) { x.C() }

func Run() { Use(full{}) }
