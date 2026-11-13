// Go 1.26: the builtin new takes an expression as well as a type.
package newexpr

type S int

func (S) M() {}

var P = new(42)

func Greet(s string) *string { return new(s + "!") }

func Conv(v int) *S { return new(S(v)) }

func Typed() *S { return new(S) }

func Use(v int) {
	p := new(S(v))
	p.M()
	q := new(S)
	q.M()
}
