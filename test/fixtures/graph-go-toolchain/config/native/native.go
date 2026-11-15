// Package native: one plain file, one cgo file and one Windows-only file.
package native

type Engine struct{}

func (Engine) Start() string { return "go" }

func Run() string { return Engine{}.Start() }
