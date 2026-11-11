// Package geom: 😀 unicode before the first declaration.
package geom

import "fmt"

// Shape is satisfied implicitly by Circle and *Square.
type Shape interface {
	Area() float64
	Name() string
}

type Circle struct {
	R float64
}

func (c Circle) Area() float64 { return scale(c.R * c.R * Pi) }

func (c Circle) Name() string { return fmt.Sprint("circle") }

func init() { registry = append(registry, "a") }

func init() { registry = append(registry, "b") }
