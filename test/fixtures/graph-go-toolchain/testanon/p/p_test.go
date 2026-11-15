package p

import "testing"

func TestUse(t *testing.T) {
	// In the test binary, x.C in Use reaches (c).C through this value.
	Use(struct {
		r
		c
	}{})
}
