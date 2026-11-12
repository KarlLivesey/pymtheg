package geom

import "example.com/shapes/geom/internal/calc"

const Pi = 3.14

var registry []string

func scale(v float64) float64 { return calc.Double(v) / 2 }

func Total(shapes ...Shape) float64 {
	sum := 0.0
	for _, s := range shapes {
		sum += s.Area()
	}
	l := Labeled{Label: "x"}
	return sum + l.Area()
}

func Map[T any, U any](xs []T, f func(T) U) []U {
	out := make([]U, 0, len(xs))
	for _, x := range xs {
		out = append(out, f(x))
	}
	return out
}

type Stack[T any] struct {
	items []T
}

func (s *Stack[T]) Push(v T) { s.items = append(s.items, v) }
