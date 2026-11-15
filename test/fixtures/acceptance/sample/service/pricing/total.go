package pricing

// ComputeTotal sums item prices in cents and adds tax.
func ComputeTotal(items []int) int {
	sum := 0
	for _, item := range items {
		sum += item
	}
	return sum + taxFor(sum)
}
