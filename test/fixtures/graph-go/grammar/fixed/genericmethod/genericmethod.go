// Go 1.27: methods with their own type parameters.
package genericmethod

// U is a package-level type with the same name as a method's type parameter.
type U struct{}

func (U) Close() {}

type C struct{}

func (C) Close() {}

type T struct{}

func (T) Map[U interface{ Close() }](u U) U {
	u.Close()
	return u
}

func (t *T) Get[V any](v V) V { return v }

func Use(t T, p *T) int {
	_ = t.Map(C{})
	_ = t.Map[C](C{})
	return p.Get(1)
}
