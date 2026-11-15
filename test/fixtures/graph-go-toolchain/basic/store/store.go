// Package store: types whose methods the source-only route cannot pin down.
package store

// Writer is implemented by *File; Logger has a Write with the same counts
// but other types, so it does not implement Writer.
type Writer interface{ Write(p []byte) (int, error) }

type File struct{}

func (f *File) Write(p []byte) (int, error) { return len(p), nil }

type Logger struct{}

func (Logger) Write(s string) (int, error) { return len(s), nil }

// Box is a generic container; Get returns its type argument.
type Box[T any] struct{ v T }

func (b Box[T]) Get() T { return b.v }

func NewBox[T any](v T) Box[T] { return Box[T]{v} }

func First[T any](xs []T) T { return xs[0] }

// Conn embeds *Base: Close is promoted.
type Base struct{}

func (*Base) Close() error { return nil }

type Conn struct{ *Base }

func Open() *Conn { return &Conn{&Base{}} }
