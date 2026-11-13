// A user-declared func named make, and a parameter named make, called with values.
package usermake

type X struct{ next *X }

func (*X) Len() int { return 0 }

func make(a, b int) int { return a + b }

var V = make(1, 2)

func Build(make func(int) *X, n int) *X { return &X{make(n - 1)} }
