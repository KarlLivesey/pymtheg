// A user-declared func named new, called with values.
package usernew

type T struct{}

func (*T) Close() {}

func new(n int, name string) *T { return &T{} }

var V = new(1, "a")

func Use(name string) {
	t := new(2, name+"x")
	t.Close()
}
