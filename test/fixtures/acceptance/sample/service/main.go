package main

import (
	"fmt"

	"example.com/shop/pricing"
)

func main() {
	cart := pricing.NewCart().Add(250).Add(125)
	fmt.Println(pricing.ComputeTotal(cart.Items()))
}
