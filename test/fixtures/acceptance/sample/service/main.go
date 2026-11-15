package main

import (
	"fmt"

	"example.com/shop/pricing"
)

func main() {
	fmt.Println(pricing.ComputeTotal([]int{250, 125}))
}
