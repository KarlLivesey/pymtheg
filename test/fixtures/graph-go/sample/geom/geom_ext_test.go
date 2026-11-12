package geom_test

import (
	"testing"

	"example.com/shapes/geom"
)

func TestTotal(t *testing.T) {
	c := geom.Circle{R: 1}
	_ = geom.Total(c)
	t.Log(c.Area())
}
