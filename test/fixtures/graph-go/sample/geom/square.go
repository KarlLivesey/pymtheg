package geom

type Square struct {
	Side float64
}

func (s *Square) Area() float64 { return scale(s.Side * s.Side) }

func (s *Square) Name() string { return platform() }

func NewSquare(side float64) *Square { return &Square{Side: side} }

// Labeled embeds Circle and gains its methods.
type Labeled struct {
	Circle
	Label string
}

// Canvas reaches a method through a receiver field of known type.
type Canvas struct {
	main *Square
}

func (cv Canvas) Draw() float64 { return cv.main.Area() }
