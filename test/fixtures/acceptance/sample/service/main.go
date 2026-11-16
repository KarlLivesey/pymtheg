package main

import (
	"fmt"

	"example.com/shop/pricing"
)

func main() {
	cart := pricing.NewCart().Add(250).Add(125)
	// Calls whose receivers come from a generic result, a type assertion and a
	// multi-value assignment: the Go toolchain opt-in decides these.
	pricing.First([]*pricing.Cart{cart}).Add(5)
	var anyCart any = cart
	anyCart.(*pricing.Cart).Add(1)
	loaded, _ := pricing.Load()
	loaded.Add(2)
	fmt.Println(pricing.ComputeTotal(cart.Items()))
}
