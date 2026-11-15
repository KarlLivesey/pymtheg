// Package a: an unnamed struct composed of embedded named types implements
// ReadCloser; its Read comes from reader.
package a

type ReadCloser interface {
	Read() string
	Close() error
}

type reader struct{}

func (reader) Read() string { return "r" }

type closer struct{}

func (closer) Close() error { return nil }

type file struct{}

func (file) Read() string { return "f" }
func (file) Close() error { return nil }

func Use(rc ReadCloser) string { return rc.Read() }

func Run() string {
	return Use(struct {
		reader
		closer
	}{}) + Use(file{})
}
