package pricing

// Cart collects item prices. Its chained methods are called on values
// returned by other calls, which source-only linking cannot type; the Go
// toolchain opt-in can.
type Cart struct {
	items []int
}

func NewCart() *Cart {
	return &Cart{}
}

func (c *Cart) Add(cents int) *Cart {
	c.items = append(c.items, cents)
	return c
}

func (c *Cart) Items() []int {
	return c.items
}
