// Go 1.27: a method with its own type parameters never satisfies an interface
// method (Go: "wrong type for method Map"); a non-generic method on a generic
// type still does.
package genericiface

type Mapper interface{ Map(x int) string }

// Box's Map has its own type parameter: Box does not implement Mapper.
type Box struct{}

func (Box) Map[U any](x int) string { return "" }

// Gen is a generic type with a non-generic method: Gen[int] implements Mapper.
type Gen[T any] struct{ v T }

func (Gen[T]) Map(x int) string { return "" }

type Plain struct{}

func (Plain) Map(x int) string { return "" }

var (
	_ Mapper = Gen[int]{}
	_ Mapper = Plain{}
)

func Use(m Mapper) string { return m.Map(1) }

// A direct call on a Box value is fine for Go (explicit type argument).
func Direct(b Box) string { return b.Map[string](1) }
