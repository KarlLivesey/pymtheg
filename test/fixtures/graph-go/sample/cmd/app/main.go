package main

import (
	"fmt"

	g "example.com/shapes/geom"
	"example.com/shapes/geom/internal/calc"
	. "example.com/shapes/internal/store"
)

type printer struct{}

func (printer) Println(v string) {}

func main() {
	sq := g.NewSquare(2)
	fmt.Println(sq.Area())
	var c g.Circle
	_ = c.Name()
	_ = Save("x")
	area := (*g.Square).Area
	_ = area(sq)
	name := c.Name
	_ = name()
	var s g.Shape = c
	_ = s.Name()
	ints := g.Map[int, string]([]int{1}, show)
	st := &g.Stack[int]{}
	st.Push(len(ints))
	_ = calc.Double(1)
	describe(nil)
	missing()
}

func show(v int) string { return fmt.Sprint(v) }

func describe(items []interface{ Name() string }) {
	fmt := printer{}
	for _, item := range items {
		fmt.Println(item.Name())
	}
}
